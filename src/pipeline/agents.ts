import type { z } from 'zod'
import { tokenOptimization, webSearchEnabled } from '@/agents/optimization'
import type { SeriesProfile } from '@/agents/profile'
import {
  EpisodeStyleSchema, IdeasSchema, PublishSchema, RubricCritiqueSchema, ScriptSchema,
  type Critique, type EpisodeStyle, type Idea, type Publish, type QaReport, type Script, type ShotList, type Timeline, type VideoClip,
} from './schemas'
import { scrubDeep, cleanHashtags } from './brand-safety'
import { plannedVideoCostUsd, planShotClips, videoCostUsd } from '../lib/video'
import { MAX_SHOT_SEC, REEL } from '../lib/format'
import { expressionsOf } from '../lib/expressions'
import { allowedVibes, expressionPlan, pickVibes, recentVibes, VIBE_IDS, VIBES, vibeBrief, type VibeId } from '../lib/vibes'
import { ideaProblems } from './story-rules'
import { mergeScriptPatch, ScriptPatchSchema } from './script-patch'
import { animatorMedia, artDirectorMedia, editorQaMedia } from './media-agents'
import { emptyMemory, memoryBrief } from './memory'
import { moderateTexts } from './moderation'
import { PolicyError } from './errors'
import { addUsage, runTextAgent } from './llm'
import type { AgentResult, Ctx, Usage } from './ctx'

export type { Usage, AgentResult, Ctx, LlmRunner, LlmCall } from './ctx'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const voiced = (p: SeriesProfile) => p.voiceMode === 'character_voices' || p.voiceMode === 'narrator_and_characters'
const narrates = (p: SeriesProfile) => p.voiceMode === 'narrator' || p.voiceMode === 'narrator_and_characters'
const names = (p: SeriesProfile) => (p.cast.length ? p.cast.map((c) => c.name) : ['the hero'])

/** What the Writer is told about the reel's length: how many beats, how many spoken words, and the shape of the story. */
export const reelBrief = (p: SeriesProfile) => {
  const spec = REEL
  return { seconds: spec.targetSec, beats: spec.beats[0] === spec.beats[1] ? `${spec.beats[0]}` : `${spec.beats[0]} to ${spec.beats[1]}`, maxSpokenWordsInTotal: spec.maxSpokenWords, structure: spec.structure }
}

// ---------- Creator ----------
const STORY_KINDS = ['a plan that backfires', 'a surprising kindness', 'a rivalry that turns into teamwork', 'a misunderstanding that grows', 'a small mystery', 'a race against a silly deadline']

/** Three ideas for the next reel. Real mode: the model, with web search and the series memory; mock mode: three different fixtures. */
export async function creator(ctx: Ctx): Promise<AgentResult<Idea[]>> {
  const memory = ctx.memory ?? emptyMemory()
  const allowed = allowedVibes(ctx.profile.niche, ctx.profile.subNiche).map((v) => v.id)
  const avoid = recentVibes(memory)
  if (ctx.mode === 'text') {
    const brief = {
      task: 'Propose THREE ideas for the next reel of this series: short stories with three different vibes. They must differ in kind and must not repeat a recent title or running gag.',
      reel: reelBrief(ctx.profile), memory: memoryBrief(memory), avoidTitles: ctx.avoidTitles ?? [], mainCharacters: names(ctx.profile),
      vibesToChooseFrom: allowed, avoidVibes: avoid,
    }
    const ask = async (fixThese: string[]) => {
      const raw = await runTextAgent('creator', 'creator', IdeasSchema, ctx, { ...brief, ...(fixThese.length ? { fixThese } : {}) }, { webSearch: webSearchEnabled() })
      return { ideas: scrubDeep(raw.output.ideas).slice(0, 3), usage: raw.usage }
    }
    const first = await ask([])
    let ideas = first.ideas
    let usage: Usage | undefined = first.usage
    if (!ideas.length) throw new Error('The Creator returned no ideas')
    // the vibes are checked in code: if two ideas share one, or one is not offered, the Creator is asked once more with the problems named
    const problems = ideaProblems(ideas, allowed, avoid)
    if (problems.length) {
      const again = await ask(problems)
      usage = addUsage([usage, again.usage])
      if (again.ideas.length && ideaProblems(again.ideas, allowed, avoid).length <= problems.length) ideas = again.ideas
    }
    const verdict = await moderateTexts(ideas.flatMap((i) => [i.title, i.premise, i.hook]))
    if (verdict.flagged) throw new PolicyError(`The ideas were flagged by the content check (${verdict.reasons.join(', ') || 'policy'}).`)
    return { output: ideas, usage, summary: `3 ideas: ${ideas.map((i) => `"${i.title}" (${i.vibe})`).join(', ')}` }
  }
  await sleep(ctx.delayMs)
  const [a, b] = names(ctx.profile)
  const taken = new Set((ctx.avoidTitles ?? []).map((t) => t.toLowerCase()))
  const vibes = pickVibes(allowed, avoid, 3, memory.recent.length)
  const ideas: Idea[] = [0, 1, 2].map((i) => {
    const kind = STORY_KINDS[(i + memory.recent.length) % STORY_KINDS.length]
    const vibe = VIBES[vibes[i % vibes.length]]
    let title = [`${a} and the ${b ? `${b}'s ` : ''}wild plan`, `${a} tries to be helpful`, `The ${b ?? a} problem`][i].slice(0, 60)
    for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${title.replace(/ \(\d+\)$/, '')} (${n})`
    return {
      title,
      premise: `${a} runs into ${kind}: ${vibe.story}.`,
      hook: i === 0 ? `${a} announces a plan nobody asked for.` : i === 1 ? `${a} drops everything to help, loudly.` : `Something is missing and ${a} knows who took it.`,
      emotionalCore: ['smug, then humbled', 'warm and silly', 'curious, then relieved'][i], runningGag: i === 0 ? `${a}'s plans always have a letter` : null,
      vibe: vibe.id, arc: vibe.arc.join(' > '),
    }
  })
  return { output: ideas, summary: `3 ideas: ${ideas.map((i) => `"${i.title}" (${i.vibe})`).join(', ')}` }
}

// ---------- Writer ----------
/** What the Writer and the Critic are told about the vibe of an idea: its story, the arc of feelings, and the pace. */
const vibeOf = (idea: Pick<Idea, 'vibe'>) => (idea.vibe ? vibeBrief(idea.vibe) : null)

export async function writer(ctx: Ctx, idea: Idea, notes: string[], previous: Script | null): Promise<AgentResult<Script>> {
  if (ctx.mode === 'text') {
    const memory = memoryBrief(ctx.memory ?? emptyMemory())
    // A revision returns only the beats that changed; the Story Builder merges them (plan §3b).
    if (notes.length && previous && !tokenOptimization()) {
      // optimization off: the Writer rewrites the whole script from the Critic's notes
      const raw = await runTextAgent('writer', 'writer', ScriptSchema, ctx, { idea, vibe: vibeOf(idea), reel: reelBrief(ctx.profile), memory, criticNotes: notes, previousScript: previous })
      const output = scrubDeep(raw.output)
      return { output, usage: raw.usage, summary: `${output.beats.length} beats · "${output.title}" · rewritten from ${notes.length} notes` }
    }
    if (notes.length && previous) {
      const raw = await runTextAgent('writer', 'writer', ScriptPatchSchema, ctx, {
        idea, vibe: vibeOf(idea), reel: reelBrief(ctx.profile), memory, criticNotes: notes, previousScript: previous,
        instruction: 'Return ONLY the beats you changed or added (each complete, with its beat number "n") and any new title, hook or payoff; use null / an empty list for everything you keep.',
      })
      const output = scrubDeep(mergeScriptPatch(previous, raw.output))
      return { output, usage: raw.usage, summary: `${output.beats.length} beats · revised ${raw.output.beats.length} beat(s) from ${notes.length} notes` }
    }
    const raw = await runTextAgent('writer', 'writer', ScriptSchema, ctx, { idea, vibe: vibeOf(idea), reel: reelBrief(ctx.profile), memory })
    const output = scrubDeep(raw.output)
    return { output, usage: raw.usage, summary: `${output.beats.length} beats · "${output.title}"` }
  }
  await sleep(ctx.delayMs)
  const cast = names(ctx.profile)
  const talk = voiced(ctx.profile)
  const narrate = narrates(ctx.profile)
  const count = REEL.shots
  const faces = expressionPlan(idea.vibe ?? 'comedy', count, expressionsOf(ctx.profile.expressions))
  const beats = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    const who = cast[i % cast.length]
    const speaks = talk && i % 2 === 1
    const text = narrate && !speaks && i % 3 === 0
    return {
      n,
      action: n === 1 ? idea.hook : n === count ? 'The plan collapses, and everyone reacts.' : `${who} pushes the plan one step further.`,
      speaker: speaks ? cast[Math.floor(i / 2) % cast.length] : text ? 'narrator' : null,
      line: speaks ? `Trust me, this will work${n > 4 ? '... probably' : ''}.` : text ? `And that is when things got interesting.` : null,
      emotion: speaks || text ? (n > 5 ? 'panicked' : 'smug') : null,
      expression: faces[i] as Script['beats'][number]['expression'],
      delivery: speaks ? 'quickly, a little too confident' : null,
      onScreenText: !talk && !narrate ? ['Plan A', 'What could go wrong?', 'Plan B', 'Oops', 'Plan C', '...', 'Never again', 'Tomorrow?'][i % 8] : null,
    }
  })
  const output: Script = { title: idea.title, hook: idea.hook, beats, payoff: 'The plan fails spectacularly, and they try again tomorrow.', supportingCast: [], ...(idea.vibe ? { vibe: idea.vibe } : {}) }
  return { output, summary: `${beats.length} beats · "${output.title}"${notes.length ? ` · revised (${notes.length} notes)` : ''}` }
}

// ---------- Critic ----------
const RUBRIC_LABEL: Record<string, string> = { hook: 'the hook', silentClarity: 'clarity without sound', emotionalArc: 'the emotional arc (feelings that change, at least three expressions)', payoff: 'the payoff', castTruth: 'characters acting in character', feasibility: 'filmable shots', originality: 'originality', loop: 'rewatch value' }

/** The model's own opinion is not trusted: code decides from the rubric (hook and feasibility at least 4, nothing below 3) and the risk flags. */
export function normalizeCritique(c: z.infer<typeof RubricCritiqueSchema>): Critique {
  const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)))
  const rubric = Object.fromEntries(Object.entries(c.rubric).map(([k, v]) => [k, clamp(v)])) as z.infer<typeof RubricCritiqueSchema>['rubric']
  const values = Object.values(rubric)
  const score = Math.max(1, Math.min(10, Math.round((values.reduce((n, v) => n + v, 0) / values.length) * 2)))
  const approved = rubric.hook >= 4 && rubric.feasibility >= 4 && Math.min(...values) >= 3 && !c.policyRisk && !c.originalityRisk
  const weak = Object.entries(rubric).filter(([, v]) => v < 4).map(([k]) => RUBRIC_LABEL[k] ?? k)
  // a rejected script must say what to fix, even if the model forgot to
  const notes = approved ? [] : c.notes.length ? c.notes : [`Improve ${weak.join(', ') || 'the hook and the shots'}.`]
  return { score, approved, notes, originalityRisk: c.originalityRisk, policyRisk: c.policyRisk, rubric, failingBeats: [...new Set(c.failingBeats)].sort((x, y) => x - y) }
}

export async function critic(ctx: Ctx, script: Script, round: number): Promise<AgentResult<Critique>> {
  if (ctx.mode === 'text') {
    const raw = await runTextAgent('critic', 'critic', RubricCritiqueSchema, ctx, { script, round, vibe: script.vibe ? vibeBrief(script.vibe) : null, reel: reelBrief(ctx.profile) })
    const output = normalizeCritique(raw.output)
    return { output, usage: raw.usage, summary: `Round ${round}: ${output.score}/10${output.approved ? ' · approved' : ` · ${output.notes.length} note(s)`}` }
  }
  await sleep(ctx.delayMs)
  // Deterministic: the first round asks for one revision so the revise loop is exercised.
  const approved = round >= 2
  const good = { hook: 4, silentClarity: 4, emotionalArc: 4, payoff: 4, castTruth: 4, feasibility: 4, originality: 4, loop: 4 }
  const output = normalizeCritique({
    rubric: approved ? good : { ...good, hook: 3, feasibility: 3 }, failingBeats: approved ? [] : [1, 2],
    notes: approved ? [] : ['1. Beat 1: make the hook land in the first 2 seconds.', '2. Beat 2: shorten the longest line.'], originalityRisk: false, policyRisk: false,
  })
  return { output, summary: `Round ${round}: ${output.score}/10${approved ? ' · approved' : ' · 2 notes'}` }
}

// ---------- Style (per reel) ----------
const MOODS: EpisodeStyle[] = [
  { mood: 'warm and cosy', timeOfDay: 'golden hour', weather: 'clear', accentColour: '#F4A261', note: 'Soft low sun through the window.' },
  { mood: 'bright and bouncy', timeOfDay: 'midday', weather: 'sunny', accentColour: '#4ECDC4', note: 'Clean daylight, lively colours.' },
  { mood: 'calm and dreamy', timeOfDay: 'evening', weather: 'light mist', accentColour: '#7B6D8D', note: 'Gentle haze and long shadows.' },
]
const hexOk = /^#[0-9a-fA-F]{6}$/

/** The mood of THIS reel inside the series look: a tiny call (or a fixture in mock mode). The accent colour is checked, never trusted. */
export async function styleNotes(ctx: Ctx, script: Script, vibe?: VibeId): Promise<AgentResult<EpisodeStyle>> {
  const fallback = MOODS[[...script.title].reduce((n, ch) => n + ch.charCodeAt(0), 0) % MOODS.length]
  if (ctx.mode === 'text') {
    const raw = await runTextAgent('styleNotes', 'episodeStyle', EpisodeStyleSchema, ctx, { title: script.title, hook: script.hook, payoff: script.payoff, vibe: vibe ? vibeBrief(vibe) : null })
    const o = scrubDeep(raw.output)
    const output: EpisodeStyle = { ...o, accentColour: hexOk.test(o.accentColour) ? o.accentColour.toUpperCase() : fallback.accentColour }
    return { output, usage: raw.usage, summary: `${output.mood} · ${output.timeOfDay} · ${output.weather}` }
  }
  await sleep(ctx.delayMs)
  return { output: fallback, summary: `${fallback.mood} · ${fallback.timeOfDay} · ${fallback.weather}` }
}

// ---------- Art Director ----------
/** The standard shot list: shot types rotate, prompts are templated. It is the mock-mode list, and the fallback when the model cannot give a usable plan. */
export function standardShots(ctx: Ctx, script: Script): ShotList {
  const types = ['establishing', 'dialogue', 'subtle', 'action', 'reaction', 'dialogue', 'action', 'reaction'] as const
  const cast = names(ctx.profile)
  const base = script.beats.map((b, i) => {
    const type = types[i % types.length]
    // a main character is in every shot; the speaker of the beat (a main or a supporting character) is always in their own shot
    const who = b.speaker && b.speaker !== 'narrator' ? [b.speaker] : [cast[i % cast.length]]
    // the shots share the reel's length equally (7 beats: 4 s each), but never more than one 5 s clip
    return { n: i + 1, type, description: b.action, durationSec: Math.min(MAX_SHOT_SEC, Math.round((ctx.profile.durationTargetSec / script.beats.length) * 100) / 100), characters: who, beat: b.n }
  })
  // every shot is a real video clip of 5 or 10 s: the keyframe is the still it starts from, the motion prompt says what moves
  const plan = planShotClips(base, ctx.video.model)
  return {
    shots: base.map((s, i) => ({
      ...s,
      videoSeconds: plan[i].seconds,
      keyframePrompt: `${s.description} ${s.type === 'dialogue' ? 'Close-up on the speaker, expressive face.' : s.type === 'establishing' ? 'Wide shot that shows the place.' : 'Clear, readable composition.'}`,
      motionPrompt: `${s.description} Natural, realistic motion. Camera: ${s.type === 'action' ? 'handheld, following the action' : s.type === 'dialogue' ? 'slow push-in on the speaker' : 'gentle push-in'}.`,
    })),
  }
}

/** The second half of the Art Director's work: the shots (planned by the model, or the standard list) become keyframes. */
export async function artDirector(ctx: Ctx, script: Script, epStyle?: EpisodeStyle, planned?: ShotList): Promise<AgentResult<ShotList>> {
  await sleep(ctx.delayMs)
  const list = planned ?? standardShots(ctx, script)
  const dialogue = list.shots.filter((s) => s.type === 'dialogue').length
  const plan = planShotClips(list.shots, ctx.video.model)
  const usd = plannedVideoCostUsd(plan, ctx.video.model).toFixed(2)
  const videoNote = `${list.shots.length} video clips (${list.shots.reduce((n, s) => n + s.videoSeconds, 0)}s, about USD ${usd})`
  if (ctx.media) return artDirectorMedia(ctx, ctx.media, script, list, epStyle)
  return { output: list, summary: `${list.shots.length} shots · ${dialogue} dialogue · ${videoNote}` }
}

// ---------- Editor: clips ----------
export async function animator(ctx: Ctx, script: Script, shots: ShotList): Promise<AgentResult<Timeline>> {
  if (ctx.media) return animatorMedia(ctx, ctx.media, script, shots)
  await sleep(ctx.delayMs)
  const transitions = ['fade', 'slideleft', 'cut']
  const voices = script.beats.filter((b) => b.line && b.speaker).map((b) => {
    const c = ctx.profile.cast.find((x) => x.name === b.speaker)
    return { speaker: b.speaker as string, voice: c?.voiceProfile?.voice ?? ctx.profile.narrator?.voice ?? 'fable', text: b.line as string }
  })
  // Clips are only PLANNED here: making one needs the shot's keyframe, which the media phase supplies.
  const videoClips: VideoClip[] = shots.shots.map((s) => ({
    shot: s.n, model: ctx.video.model, seconds: s.videoSeconds, estimatedUsd: videoCostUsd(ctx.video.model, s.videoSeconds), costUsd: 0, status: 'planned' as const,
  }))
  const timeline: Timeline = {
    durationSec: Math.round(shots.shots.reduce((s, x) => s + x.durationSec, 0)),
    shots: shots.shots.map((s, i) => ({
      n: s.n, type: s.type, camera: transitions[i % transitions.length], motion: `video (${ctx.video.model})`, durationSec: s.durationSec, videoSeconds: s.videoSeconds,
    })),
    audio: { voices, music: 'light playful loop', sfx: ['whoosh'] },
    videoClips,
    mock: true,
  }
  const plannedSec = videoClips.reduce((n, c) => n + c.seconds, 0)
  return { output: timeline, summary: `${timeline.durationSec}s timeline · ${voices.length} voiced lines · ${videoClips.length} video clips planned (${plannedSec}s)` }
}

// ---------- Editor: assemble and check ----------
export async function editorQa(ctx: Ctx, timeline: Timeline): Promise<AgentResult<QaReport>> {
  if (ctx.media) return editorQaMedia(ctx, ctx.media, timeline)
  await sleep(ctx.delayMs)
  const report: QaReport = {
    passed: true, mock: true,
    checks: [
      { name: 'Characters on-model', ok: true, note: 'no clips yet (mock)' },
      { name: 'Captions in sync', ok: true, note: 'no assembly yet (mock)' },
      { name: 'Loudness', ok: true, note: 'target -14 LUFS (mock)' },
      { name: 'Lip-sync', ok: !voiced(ctx.profile) || timeline.audio.voices.length > 0, note: voiced(ctx.profile) ? 'voiced lines present' : 'not needed' },
    ],
  }
  return { output: report, summary: 'All checks passed (mock assembly)' }
}

// ---------- Publisher ----------
export async function publisher(ctx: Ctx, script: Script): Promise<AgentResult<Publish>> {
  if (ctx.mode === 'text') {
    const raw = await runTextAgent('publisher', 'publisher', PublishSchema, ctx, { script: { title: script.title, hook: script.hook, payoff: script.payoff } })
    const clean = scrubDeep(raw.output)
    const output: Publish = { ...clean, hashtags: cleanHashtags(raw.output.hashtags) }
    return { output, usage: raw.usage, summary: `"${output.title}"` }
  }
  await sleep(ctx.delayMs)
  const tags = ['#AnimatedStories', `#${ctx.profile.niche.replace(/\W+/g, '')}`, '#Shorts']
  const output: Publish = { title: script.title.slice(0, 70), caption: `${script.hook} 😂`, hashtags: tags, aiLabel: 'Made with AI' }
  return { output, summary: `"${output.title}"` }
}
