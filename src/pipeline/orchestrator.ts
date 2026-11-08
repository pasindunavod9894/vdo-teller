import * as agents from './agents'
import type { AgentResult, Ctx, Usage } from './agents'
import type { Critique, Idea, Script } from './schemas'
import { MAX_REVISION_ROUNDS, type StepKey } from './steps'
import { videoCostUsd } from '../lib/video'
import { platformMetas } from './publish-meta'

/**
 * The Orchestrator (plan §3): splits the episode into steps, calls each sub-agent, keeps the state, enforces the
 * revision cap and the budget, and assembles the final output. Sub-agents never talk to each other; they only
 * return their result here. Persistence is behind `Store`, so this runs the same in tests and in production.
 */
export type Store = {
  stepStart(key: StepKey, note?: string): Promise<void>
  stepDone(key: StepKey, r: { summary: string; usage?: Usage }): Promise<void>
  stepFail(key: StepKey, message: string): Promise<void>
  episodePatch(patch: Record<string, unknown>): Promise<void>
  /** true while spent + extra stays under the series cost cap */
  budgetOk(extraUsd: number): Promise<boolean>
  addSpend(usd: number, videoSeconds?: number): Promise<void>
}

export type RunOutcome = { status: 'done' | 'needs-review' | 'failed'; reason?: string; costUsd: number }

export async function runEpisode(baseCtx: Ctx, store: Store, previousTitles: string[]): Promise<RunOutcome> {
  // agents may ask whether more money can be spent before each paid call
  const ctx: Ctx = { ...baseCtx, canSpend: baseCtx.canSpend ?? ((usd) => store.budgetOk(usd)) }
  let cost = 0
  let downgradedVideo = false
  let current: StepKey = 'orchestrator-plan'

  // Runs one agent as a step: marks it running, saves its result, accumulates cost.
  async function step<T>(key: StepKey, note: string | undefined, fn: () => Promise<AgentResult<T>>): Promise<T> {
    current = key
    if (!(await store.budgetOk(ctx.mode === 'text' ? 0.05 : 0))) throw new BudgetError()
    await store.stepStart(key, note)
    const r = await fn()
    if (r.usage) { cost += r.usage.costUsd; await store.addSpend(r.usage.costUsd, r.usage.videoSeconds) }
    await store.stepDone(key, { summary: r.summary, usage: r.usage })
    return r.output
  }

  try {
    await step('orchestrator-plan', undefined, async () => ({
      output: null,
      summary: `Plan: ${ctx.profile.format}, ${ctx.profile.durationTargetSec}s, voice: ${ctx.profile.voiceMode}, mode: ${ctx.mode}`,
    }))

    const idea: Idea = await step('showrunner', undefined, () => agents.showrunner(ctx, previousTitles))
    await store.episodePatch({ title: idea.title, idea })

    // Writer <-> Critic loop, routed through the Orchestrator, capped (plan §3b).
    let script: Script | null = null
    let critique: Critique | null = null
    let notes: string[] = []
    for (let round = 1; round <= MAX_REVISION_ROUNDS; round++) {
      script = await step('writer', round > 1 ? `Round ${round}: revising from the Critic's notes` : undefined, () => agents.writer(ctx, idea, notes, script))
      await store.episodePatch({ script })
      critique = await step('critic', undefined, () => agents.critic(ctx, script as Script, round))
      if (critique.approved) break
      notes = critique.notes
    }
    if (!script || !critique) throw new Error('No script was produced')
    if (critique.policyRisk || critique.originalityRisk) {
      current = 'critic'
      await store.stepFail('critic', 'The script has a policy or originality risk and needs a human review.')
      await store.episodePatch({ status: 'needs-review', error: 'Policy or originality risk flagged by the Critic.' })
      return { status: 'needs-review', reason: 'policy/originality risk', costUsd: cost }
    }

    let shots = await step('art-director', undefined, () => agents.artDirector(ctx, script as Script))

    // Budget guard for real video: if the planned clips no longer fit under the cost cap, those shots fall back to the
    // free engine instead of overspending (plan §12). The episode carries on.
    const plannedUsd = shots.shots.reduce((n, s) => n + (s.render === 'video' ? videoCostUsd(ctx.video.model, s.videoSeconds) : 0), 0)
    if (plannedUsd > 0 && !(await store.budgetOk(plannedUsd))) {
      shots = { shots: shots.shots.map((s) => ({ ...s, render: 'engine' as const, videoSeconds: 0, motionPrompt: null })) }
      downgradedVideo = true
    }
    await store.episodePatch({ shots })

    const timeline = await step('animator', undefined, () => agents.animator(ctx, script as Script, shots))
    if (downgradedVideo) timeline.videoClips = []
    await store.episodePatch({ timeline, audio: timeline.audio, videoClips: timeline.videoClips })

    const qa = await step('editor-qa', undefined, () => agents.editorQa(ctx, timeline))
    if (!qa.passed) {
      await store.stepFail('editor-qa', 'Quality checks failed.')
      await store.episodePatch({ status: 'needs-review', error: 'Quality checks failed.' })
      return { status: 'needs-review', reason: 'qa failed', costUsd: cost }
    }

    const publish = await step('publisher', undefined, () => agents.publisher(ctx, script as Script))

    await step('orchestrator-final', undefined, async () => ({
      output: null,
      summary: `Episode ready · "${idea.title}" · $${cost.toFixed(3)}`,
    }))
    const videoUsd = timeline.videoClips.reduce((n, c) => n + c.costUsd, 0)
    // the Animator already reports its video spend in its usage, so `cost` includes it
    const master = ctx.media?.state.master
    await store.episodePatch({ status: 'done', files: { publish: { ...publish, platforms: platformMetas(publish) }, ...(master ? { master } : { mockRender: true }) }, costUsd: cost, videoCostUsd: videoUsd })
    return { status: 'done', costUsd: cost }
  } catch (e) {
    const message = e instanceof BudgetError ? 'Cost cap reached.' : e instanceof Error ? e.message : 'Unknown error'
    await store.stepFail(current, message).catch(() => {})
    const status = e instanceof BudgetError ? 'needs-review' : 'failed'
    await store.episodePatch({ status, error: message, costUsd: cost }).catch(() => {})
    return { status, reason: message, costUsd: cost }
  }
}

class BudgetError extends Error {}
