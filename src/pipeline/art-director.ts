import * as agents from './agents'
import type { AgentResult, Ctx, Usage } from './ctx'
import { castViolations } from './cast'
import { lengthViolations } from './length'
import { addUsage, runTextAgent } from './llm'
import { scrubDeep } from './brand-safety'
import { clipSeconds } from '../lib/video'
import { MAX_SHOT_SEC, REEL } from '../lib/format'
import { expressionsOf } from '../lib/expressions'
import { attachStory } from './story-rules'
import { hydrateRecurring, emptyMemory } from './memory'
import { ShotsDraftSchema, type EpisodeStyle, type Idea, type Script, type ShotList } from './schemas'

/**
 * The Art Director (plan R3): the shot list by meaning. The model gives one shot per beat with a shot type, a camera angle, a keyframe prompt
 * and a motion prompt, and lists the beats that cannot be shown as one shot with only the cast (`unfilmable`). Everything it returns is
 * checked in code; a bad answer is asked for once more with the problems named, and if it is still bad the standard shot list is used, so an
 * episode never dies on a model's answer. A beat that cannot be filmed goes back to the Writer ONCE, before any image is paid for.
 */
type Shot = ShotList['shots'][number]
export type ShotPlan = { shots: ShotList; unfilmable: { beat: number; reason: string }[]; fallback: boolean; notes: string[] }

const MIN_SHOT = 1.5
const MAX_SHOT = MAX_SHOT_SEC

/**
 * Scales the shot lengths so they add up to the reel's length (the model's own numbers only set the proportions). No shot goes past
 * `maxShot`: a shot that would is held at it and the others take the rest. When every shot is at the limit the total is simply shorter. Pure.
 */
export function normalizeDurations(durations: number[], targetSec: number, maxShot = MAX_SHOT): number[] {
  const base = durations.map((d) => (Number.isFinite(d) ? Math.min(maxShot, Math.max(MIN_SHOT, d)) : Math.min(maxShot, targetSec / durations.length)))
  const out: number[] = base.map(() => 0)
  let free = base.map((_, i) => i)
  let remaining = targetSec
  for (let pass = 0; pass <= base.length && free.length; pass++) {
    const sum = free.reduce((n, i) => n + base[i], 0)
    const over = free.filter((i) => (base[i] * remaining) / sum > maxShot)
    if (!over.length) { for (const i of free) out[i] = (base[i] * remaining) / sum; free = []; break }
    for (const i of over) { out[i] = maxShot; remaining -= maxShot }
    free = free.filter((i) => !over.includes(i))
  }
  const rounded = out.map((d) => Math.round(d * 100) / 100)
  // put the rounding error on the last shot that is not held at the limit, so the total is exact
  const last = [...rounded.keys()].reverse().find((i) => rounded[i] < maxShot)
  if (last !== undefined) {
    const others = rounded.reduce((n, d, i) => (i === last ? n : n + d), 0)
    rounded[last] = Math.round((targetSec - others) * 100) / 100
  }
  return rounded
}

type Draft = ReturnType<typeof ShotsDraftSchema.parse>

/** Everything wrong with a draft shot list; empty means it can be used. Pure. */
export function shotPlanProblems(draft: Draft, script: Script, mainCast: string[]): string[] {
  const out: string[] = []
  const beats = script.beats.map((b) => b.n)
  if (draft.shots.length !== beats.length) out.push(`There must be exactly ${beats.length} shots, one per beat; you gave ${draft.shots.length}.`)
  draft.shots.forEach((s, i) => { if (beats[i] !== undefined && s.beat !== beats[i]) out.push(`Shot ${i + 1} must cover beat ${beats[i]}, not beat ${s.beat}.`) })
  const asList: ShotList = { shots: draft.shots.map((s, i) => ({ ...s, n: i + 1, durationSec: Math.max(0.5, s.durationSec), videoSeconds: s.videoSeconds })) }
  out.push(...castViolations(mainCast, script, asList))
  draft.shots.forEach((s, i) => {
    if (i > 0 && s.angle.trim().toLowerCase() === draft.shots[i - 1].angle.trim().toLowerCase()) out.push(`Shots ${i} and ${i + 1} use the same camera angle ("${s.angle}"); vary it.`)
    if (!s.keyframePrompt.trim() || !s.motionPrompt.trim()) out.push(`Shot ${i + 1} needs both a keyframe prompt and a motion prompt.`)
  })
  for (const u of draft.unfilmable) if (!beats.includes(u.beat)) out.push(`unfilmable names beat ${u.beat}, which does not exist.`)
  return out
}

/** The standard shot list (the one used in mock mode): types rotate, prompts are templated. Used when the model cannot give a usable plan. */
export function fallbackShots(ctx: Ctx, script: Script): ShotList {
  return agents.standardShots(ctx, script)
}

export async function planShots(ctx: Ctx, script: Script, epStyle?: EpisodeStyle): Promise<AgentResult<ShotPlan>> {
  if (ctx.mode !== 'text') return { output: { shots: fallbackShots(ctx, script), unfilmable: [], fallback: false, notes: [] }, summary: 'standard shot list' }
  const mainCast = ctx.profile.cast.length ? ctx.profile.cast.map((c) => c.name) : ['the hero']
  const spec = REEL
  const usages: (Usage | undefined)[] = []
  const brief = (problems: string[]) => ({
    task: 'Plan the shots for this script.', script, reel: { seconds: spec.targetSec, shots: script.beats.length, secondsPerShot: Math.round((spec.targetSec / script.beats.length) * 10) / 10 },
    thisReelsStyle: epStyle ?? null, mainCharacters: mainCast, supportingCharacters: script.supportingCast.map((s) => s.name), ...(problems.length ? { fixThese: problems } : {}),
  })

  let problems: string[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (ctx.canSpend && !(await ctx.canSpend(0.05))) break
    const raw = await runTextAgent('artDirector', 'artDirector', ShotsDraftSchema, ctx, brief(problems))
    usages.push(raw.usage)
    const draft = scrubDeep(raw.output)
    problems = shotPlanProblems(draft, script, mainCast)
    if (!problems.length) {
      const durations = normalizeDurations(draft.shots.map((s) => s.durationSec), spec.targetSec)
      const shots: ShotList = {
        shots: draft.shots.map((s, i): Shot => ({
          n: i + 1, type: s.type, description: s.description, durationSec: durations[i], characters: s.characters, beat: s.beat,
          videoSeconds: clipSeconds(ctx.video.model, durations[i]), keyframePrompt: s.keyframePrompt, motionPrompt: s.motionPrompt, angle: s.angle,
        })),
      }
      return { output: { shots, unfilmable: draft.unfilmable, fallback: false, notes: attempt > 1 ? ['the first shot list had problems and was asked for again'] : [] }, usage: addUsage(usages), summary: `${shots.shots.length} shots planned${draft.unfilmable.length ? `, ${draft.unfilmable.length} beat(s) hard to film` : ''}` }
    }
  }
  // no usable answer: the standard shot list keeps the episode going
  return { output: { shots: fallbackShots(ctx, script), unfilmable: [], fallback: true, notes: [`the Art Director's shot list was not usable (${problems.slice(0, 2).join(' ')}), so the standard shot list was used`] }, usage: addUsage(usages), summary: 'standard shot list (the model\'s plan was not usable)' }
}

export type Direction = { shots: ShotList; script: Script }

/**
 * Plans the shots, sends an unfilmable beat back to the Writer once (before any image is made), then makes the keyframes. Returns the shot list
 * and the script it was made from (which may have had a beat rewritten).
 */
export async function directArt(ctx: Ctx, idea: Idea, script: Script, epStyle?: EpisodeStyle): Promise<AgentResult<Direction>> {
  const usages: (Usage | undefined)[] = []
  const notes: string[] = []
  const mainCast = ctx.profile.cast.length ? ctx.profile.cast.map((c) => c.name) : ['the hero']
  let plan = await planShots(ctx, script, epStyle)
  usages.push(plan.usage)
  notes.push(...plan.output.notes)

  if (plan.output.unfilmable.length) {
    const asks = plan.output.unfilmable.map((u) => `Beat ${u.beat} cannot be filmed as one shot with only the cast (${u.reason}). Rewrite that beat so it can, keeping the story.`)
    const w = await agents.writer(ctx, idea, asks, script)
    usages.push(w.usage)
    const revised = attachStory(hydrateRecurring(w.output, ctx.memory ?? emptyMemory(), mainCast), script.vibe, expressionsOf(ctx.profile.expressions))
    const bad = [...castViolations(mainCast, revised), ...lengthViolations(revised)]
    if (bad.length) {
      notes.push('the rewrite of the hard beat broke a rule, so the original script was kept')
    } else {
      script = revised
      plan = await planShots(ctx, script, epStyle)
      usages.push(plan.usage)
      notes.push(`${asks.length} beat(s) rewritten once to make them filmable`)
      if (plan.output.unfilmable.length) notes.push('some beats are still hard to film; kept as planned')
    }
  }

  const shots = await agents.artDirector(ctx, script, epStyle, plan.output.shots)
  usages.push(shots.usage)
  const summary = `${shots.summary}${notes.length ? ` · ${notes.join('; ')}` : ''}`
  return { output: { shots: shots.output, script }, summary, usage: addUsage(usages) }
}
