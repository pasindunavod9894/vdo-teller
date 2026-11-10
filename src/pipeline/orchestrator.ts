import * as agents from './agents'
import type { AgentResult, Ctx, Usage } from './agents'
import type { Critique, EpisodeStyle, Idea, Script, ShotList } from './schemas'
import { APPROVE_SCORE, type StepKey } from './steps'
import { lipsyncCostUsd, videoCostUsd, DEFAULT_LIPSYNC_MODEL } from '../lib/video'
import { platformMetas } from './publish-meta'
import { BudgetError, PolicyError, spentOf } from './errors'
import { castViolations } from './cast'
import { avoidTitlesFrom, emptyMemory } from './memory'
import { storyBuilder } from './story-builder'
import { directArt } from './art-director'

/**
 * The Orchestrator (plan §3): splits the episode into steps, calls each agent, keeps the state, enforces the budget, and assembles the final
 * output. Agents never talk to each other; they only return their result here. Persistence is behind `Store`, so this runs the same in tests
 * and in production. The order is fixed: Creator → Story Builder → Style → Art Director → Editor → Publisher.
 */
export type Store = {
  stepStart(key: StepKey, note?: string): Promise<void>
  stepDone(key: StepKey, r: { summary: string; usage?: Usage }): Promise<void>
  stepFail(key: StepKey, message: string): Promise<void>
  episodePatch(patch: Record<string, unknown>): Promise<void>
  /** true while spent + extra stays under the series cost cap */
  budgetOk(extraUsd: number): Promise<boolean>
  addSpend(usd: number, videoSeconds?: number): Promise<void>
  /** called once when an episode has finished: the series memory is updated from its idea and script */
  episodeDone?(info: { idea: Idea; script: Script }): Promise<void>
}

export type RunOutcome = { status: 'done' | 'needs-review' | 'failed' | 'awaiting-approval'; reason?: string; costUsd: number }

/** Finished text steps of an earlier attempt that failed later (for example in the render): they are reused, not paid for again. */
export type Resume = { idea: Idea; script: Script }

/** What an episode that was paused for review already has: the approved idea, script, shots and keyframes (the media state is restored by the caller). */
export type ContinueState = { idea: Idea; script: Script; shots: ShotList; epStyle?: EpisodeStyle }

export type RunOptions = {
  /** pause after the script and the keyframes, before any video clip is paid for (the series' "Review before video" switch) */
  review?: boolean
  /** continue a paused episode from the Editor step */
  continueFrom?: ContinueState
  /** what the episode has already cost, so the episode ceiling and the total cover both parts */
  startingCostUsd?: number
}

export async function runEpisode(baseCtx: Ctx, store: Store, previousTitles: string[], resume: Resume | null = null, opts: RunOptions = {}): Promise<RunOutcome> {
  let cost = opts.startingCostUsd ?? 0
  // Agents ask before each paid call. Two limits apply: the series cost cap and this episode's own ceiling (plan §3b).
  const ceiling = baseCtx.episodeCeilingUsd ?? Infinity
  const ctx: Ctx = {
    ...baseCtx,
    canSpend: async (usd) => cost + usd <= ceiling && (await (baseCtx.canSpend ?? ((u: number) => store.budgetOk(u)))(usd)),
    // ideas that must not come back: what the series remembers, earlier episodes, and ideas the user turned down
    avoidTitles: avoidTitlesFrom(baseCtx.memory ?? emptyMemory(), [...previousTitles, ...(baseCtx.avoidTitles ?? [])]),
  }
  const mainCast = ctx.profile.cast.length ? ctx.profile.cast.map((c) => c.name) : ['the hero']
  let current: StepKey = 'orchestrator-plan'

  // Runs one agent as a step: marks it running, saves its result, accumulates cost.
  async function step<T>(key: StepKey, note: string | undefined, fn: () => Promise<AgentResult<T>>): Promise<T> {
    current = key
    if (cost >= ceiling) throw new BudgetError('Episode cost ceiling reached.')
    if (!(await store.budgetOk(ctx.mode === 'text' ? 0.05 : 0))) throw new BudgetError()
    await store.stepStart(key, note)
    const r = await fn()
    if (r.usage) { cost += r.usage.costUsd; await store.addSpend(r.usage.costUsd, r.usage.videoSeconds) }
    await store.stepDone(key, { summary: r.summary, usage: r.usage })
    return r.output
  }

  try {
    let idea: Idea
    let script: Script
    let shots: ShotList
    if (opts.continueFrom) {
      // the user approved the story and the keyframes: nothing before the Editor is made again or paid for again
      ;({ idea, script, shots } = opts.continueFrom)
    } else {
      await step('orchestrator-plan', undefined, async () => ({
        output: null,
        summary: `Plan: ${ctx.profile.durationTargetSec} s reel, voice: ${ctx.profile.voiceMode}, mode: ${ctx.mode}${opts.review ? ', review before video' : ''}`,
      }))

      let critique: Critique
      if (resume) {
        // Reuse the approved idea and script of the failed attempt: nothing is generated or paid for again.
        idea = resume.idea
        script = resume.script
        critique = { score: APPROVE_SCORE, approved: true, notes: [], originalityRisk: false, policyRisk: false }
        await store.stepStart('creator', 'Reused from the earlier attempt')
        await store.stepDone('creator', { summary: `Idea: "${idea.title}" (reused)` })
        await store.stepStart('story-builder', 'Reused from the earlier attempt')
        await store.stepDone('story-builder', { summary: `${script.beats.length} beats, approved earlier (reused)` })
        await store.episodePatch({ title: idea.title, idea, script, critique })
      } else {
        const ideas = await step('creator', undefined, () => agents.creator(ctx))
        await store.episodePatch({ ideas })
        const story = await step('story-builder', undefined, () => storyBuilder(ctx, ideas))
        idea = story.idea
        script = story.script
        critique = story.critique
        // kept so a later attempt can reuse the approved script
        await store.episodePatch({ title: idea.title, idea, script, critique })
      }
      if (critique.policyRisk || critique.originalityRisk) {
        current = 'story-builder'
        await store.stepFail('story-builder', 'The script has a policy or originality risk and needs a human review.')
        await store.episodePatch({ status: 'needs-review', error: 'Policy or originality risk flagged by the Critic or the content check.' })
        return { status: 'needs-review', reason: 'policy/originality risk', costUsd: cost }
      }

      const epStyle = await step('style', undefined, () => agents.styleNotes(ctx, script, idea.vibe))
      await store.episodePatch({ styleNotes: epStyle })

      // the Art Director plans the shots (a beat that cannot be filmed goes back to the Writer once), then the keyframes are made
      const art = await step('art-director', undefined, () => directArt(ctx, idea, script, epStyle))
      shots = art.shots
      if (art.script !== script) { script = art.script; await store.episodePatch({ script }) }
      // the cast rule again, now on the shot list: a shot may only show the main cast or a character the script declared
      const shotProblems = castViolations(mainCast, script, shots)
      if (shotProblems.length) throw new Error(`The shot list breaks the cast rule: ${shotProblems.slice(0, 3).join(' ')}`)
    }

    // Budget guard (plan §12): every shot is a video clip and there is no cheaper way to make one, so if the clips (and their
    // lip-sync) no longer fit under the cost cap or this episode's ceiling, the episode stops here for a human instead of overspending.
    const lipsyncUsd = shots.shots.filter((s) => s.type === 'dialogue').reduce((n, s) => n + lipsyncCostUsd(DEFAULT_LIPSYNC_MODEL, s.videoSeconds), 0)
    const plannedUsd = shots.shots.reduce((n, s) => n + videoCostUsd(ctx.video.model, s.videoSeconds), 0) + lipsyncUsd
    if (plannedUsd > 0 && (cost + plannedUsd > ceiling || !(await store.budgetOk(plannedUsd)))) {
      throw new BudgetError(`The ${shots.shots.length} video clips would cost about USD ${plannedUsd.toFixed(2)}, which is more than the cost cap allows.`)
    }
    await store.episodePatch({ shots })

    // "Review before video": stop here, having spent only text and images (the keyframes are saved with the episode), and wait for the user
    if (opts.review && !opts.continueFrom) {
      await store.episodePatch({ status: 'awaiting-approval', costUsd: cost })
      return { status: 'awaiting-approval', costUsd: cost }
    }

    const timeline = await step('editor-clips', undefined, () => agents.animator(ctx, script, shots))
    await store.episodePatch({ timeline, audio: timeline.audio, videoClips: timeline.videoClips })

    const qa = await step('editor-assemble', undefined, () => agents.editorQa(ctx, timeline))
    if (!qa.passed) {
      // say which checks failed so the dashboard shows the reason, not just "failed"
      const why = qa.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.note})`).join('; ')
      const message = why ? `Quality checks failed: ${why}` : 'Quality checks failed.'
      await store.stepFail('editor-assemble', message)
      await store.episodePatch({ status: 'needs-review', error: message })
      return { status: 'needs-review', reason: 'qa failed', costUsd: cost }
    }

    // shots the vision check wants a person to look at: saved with the video, never re-made automatically
    if (qa.flags?.length) await store.episodePatch({ qaFlags: qa.flags })

    const publish = await step('publisher', undefined, () => agents.publisher(ctx, script))

    await step('orchestrator-final', undefined, async () => ({
      output: null,
      summary: `Video ready · "${idea.title}" · USD ${cost.toFixed(3)}`,
    }))
    const videoUsd = timeline.videoClips.reduce((n, c) => n + c.costUsd, 0)
    // the Editor already reports its video spend in its usage, so `cost` includes it
    const master = ctx.media?.state.master
    await store.episodePatch({ status: 'done', files: { publish: { ...publish, platforms: platformMetas(publish) }, ...(master ? { master } : { mockRender: true }) }, costUsd: cost, videoCostUsd: videoUsd })
    await store.episodeDone?.({ idea, script }).catch((e) => console.error('[memory] could not update the series memory:', e instanceof Error ? e.message : e))
    return { status: 'done', costUsd: cost }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    // paid work of the failed step (images, clips) is still the episode's cost
    const spent = spentOf(e)
    if (spent.usd > 0) { cost += spent.usd; await store.addSpend(spent.usd, spent.videoSeconds).catch(() => {}) }
    await store.stepFail(current, message).catch(() => {})
    const status = e instanceof BudgetError || e instanceof PolicyError ? 'needs-review' : 'failed'
    await store.episodePatch({ status, error: message, costUsd: cost }).catch(() => {})
    return { status, reason: message, costUsd: cost }
  }
}
