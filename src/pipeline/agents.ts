import { Agent, run } from '@openai/agents'
import type { z } from 'zod'
import { MODELS, REASONING, tokenCostUsd, type AgentModelKey } from '@/agents/models'
import { buildPrompt } from '@/agents/prompt-builder'
import type { AgentName, SeriesProfile } from '@/agents/profile'
import {
  CritiqueSchema, IdeaSchema, PublishSchema, ScriptSchema,
  type Critique, type Idea, type Publish, type QaReport, type Script, type ShotList, type Timeline,
} from './schemas'
import { scrubDeep, cleanHashtags } from './brand-safety'
import { APPROVE_SCORE, type PipelineMode } from './steps'

export type Usage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number }
export type AgentResult<T> = { output: T; summary: string; usage?: Usage }

export type Ctx = {
  profile: SeriesProfile
  seriesId: string | number
  mode: PipelineMode
  /** simulated work time for mock agents, so the progress card is watchable. 0 in tests. */
  delayMs: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const voiced = (p: SeriesProfile) => p.voiceMode === 'character_voices' || p.voiceMode === 'narrator_and_characters'
const narrates = (p: SeriesProfile) => p.voiceMode === 'narrator' || p.voiceMode === 'narrator_and_characters'
const names = (p: SeriesProfile) => (p.cast.length ? p.cast.map((c) => c.name) : ['the hero'])

/** Runs one real Agents SDK agent with the cache-friendly prompt from the prompt builder. */
async function runTextAgent<S extends z.ZodType>(
  agent: AgentName, modelKey: AgentModelKey, schema: S, ctx: Ctx, episode: Record<string, unknown> | string,
): Promise<{ output: z.infer<S>; usage: Usage }> {
  const p = buildPrompt(agent, ctx.profile, episode, ctx.seriesId)
  const model = MODELS[modelKey]
  // The SDK's generics don't accept a generic zod schema here; the schema is validated by the SDK at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = new Agent<unknown, any>({
    name: agent, model, instructions: p.system, outputType: schema,
    modelSettings: { reasoning: { effort: REASONING[modelKey] }, text: { verbosity: 'low' }, providerData: { prompt_cache_key: p.cacheKey } },
  })
  const res = await run(a, p.user)
  if (res.finalOutput == null) throw new Error(`${agent} returned no structured output`)
  const u = res.state.usage
  const cachedTokens = (u.inputTokensDetails as unknown as { cached_tokens?: number }[] | undefined)?.reduce((s, d) => s + (d?.cached_tokens ?? 0), 0) ?? 0
  const reasoningTokens = (u.outputTokensDetails as unknown as { reasoning_tokens?: number }[] | undefined)?.reduce((s, d) => s + (d?.reasoning_tokens ?? 0), 0) ?? 0
  const usage = { model, inputTokens: u.inputTokens, cachedTokens, outputTokens: u.outputTokens, reasoningTokens, costUsd: 0 }
  usage.costUsd = tokenCostUsd(model, usage)
  return { output: res.finalOutput as z.infer<S>, usage }
}

// ---------- Showrunner ----------
export async function showrunner(ctx: Ctx, previousTitles: string[]): Promise<AgentResult<Idea>> {
  if (ctx.mode === 'text') {
    const raw = await runTextAgent('showrunner', 'showrunner', IdeaSchema, ctx, {
      task: 'Propose ONE new episode idea for this series. It must differ from the previous titles.', previousTitles,
    })
    const output = scrubDeep(raw.output)
    return { output, usage: raw.usage, summary: `Idea: "${output.title}"` }
  }
  await sleep(ctx.delayMs)
  const [a, b] = names(ctx.profile)
  const output: Idea = {
    title: `${a} and the ${b ? b + "'s " : ''}wild plan`.slice(0, 60),
    premise: `${a} tries an absurd shortcut for an everyday goal and it backfires in a funny way.`,
    hook: `${a} announces a plan nobody asked for.`,
  }
  return { output, summary: `Idea: "${output.title}"` }
}

// ---------- Writer ----------
export async function writer(ctx: Ctx, idea: Idea, notes: string[], previous: Script | null): Promise<AgentResult<Script>> {
  if (ctx.mode === 'text') {
    const raw = await runTextAgent('writer', 'writer', ScriptSchema, ctx, {
      idea, targetSeconds: ctx.profile.durationTargetSec, ...(notes.length ? { criticNotes: notes, previousScript: previous } : {}),
    })
    const output = scrubDeep(raw.output)
    return { output, usage: raw.usage, summary: `${output.beats.length} beats · "${output.title}"` }
  }
  await sleep(ctx.delayMs)
  const cast = names(ctx.profile)
  const talk = voiced(ctx.profile)
  const narrate = narrates(ctx.profile)
  const beats = Array.from({ length: 8 }, (_, i) => {
    const n = i + 1
    const who = cast[i % cast.length]
    const speaks = talk && i % 2 === 1
    const text = narrate && !speaks && i % 3 === 0
    return {
      n,
      action: n === 1 ? idea.hook : n === 8 ? 'The plan collapses, and everyone reacts.' : `${who} pushes the plan one step further.`,
      speaker: speaks ? cast[Math.floor(i / 2) % cast.length] : text ? 'narrator' : null,
      line: speaks ? `Trust me, this will work${n > 4 ? '... probably' : ''}.` : text ? `And that is when things got interesting.` : null,
      emotion: speaks || text ? (n > 5 ? 'panicked' : 'smug') : null,
      delivery: speaks ? 'quickly, a little too confident' : null,
      onScreenText: !talk && !narrate ? ['Plan A', 'What could go wrong?', 'Plan B', 'Oops', 'Plan C', '...', 'Never again', 'Tomorrow?'][i] : null,
    }
  })
  const output: Script = { title: idea.title, hook: idea.hook, beats, payoff: 'The plan fails spectacularly, and they try again tomorrow.' }
  return { output, summary: `${beats.length} beats · "${output.title}"${notes.length ? ` · revised (${notes.length} notes)` : ''}` }
}

// ---------- Critic ----------
/** The model's own `approved` flag is not trusted (it once said "score 6, approved"): code decides from the score and risk flags. */
export function normalizeCritique(c: Critique): Critique {
  const score = Math.max(1, Math.min(10, Math.round(c.score)))
  return { ...c, score, approved: score >= APPROVE_SCORE && !c.policyRisk && !c.originalityRisk }
}

export async function critic(ctx: Ctx, script: Script, round: number): Promise<AgentResult<Critique>> {
  if (ctx.mode === 'text') {
    const raw = await runTextAgent('critic', 'critic', CritiqueSchema, ctx, { script, round })
    const output = normalizeCritique(raw.output)
    return { output, usage: raw.usage, summary: `Round ${round}: score ${output.score}/10${output.approved ? ' · approved' : ` · ${output.notes.length} notes`}` }
  }
  await sleep(ctx.delayMs)
  // Deterministic: the first round asks for one revision so the revise loop is exercised.
  const approved = round >= 2
  const output: Critique = {
    score: approved ? 8 : 6, approved,
    notes: approved ? [] : ['1. Make the hook land in the first 3 seconds.', '2. Shorten the longest line.'],
    originalityRisk: false, policyRisk: false,
  }
  return { output, summary: `Round ${round}: score ${output.score}/10${approved ? ' · approved' : ' · 2 notes'}` }
}

// ---------- Art Director (media: mock until Phase 9) ----------
export async function artDirector(ctx: Ctx, script: Script): Promise<AgentResult<ShotList>> {
  await sleep(ctx.delayMs)
  const types = ['establishing', 'dialogue', 'subtle', 'action', 'reaction', 'dialogue', 'action', 'reaction'] as const
  const shots = script.beats.map((b, i) => ({
    n: i + 1, type: types[i % types.length], description: b.action, durationSec: 2.5 + (i % 3) * 0.5,
    characters: b.speaker && b.speaker !== 'narrator' ? [b.speaker] : [], beat: b.n,
  }))
  const dialogue = shots.filter((s) => s.type === 'dialogue').length
  return { output: { shots }, summary: `${shots.length} shots · ${dialogue} dialogue · varied shot types` }
}

// ---------- Animator (media: mock until Phase 8/9) ----------
export async function animator(ctx: Ctx, script: Script, shots: ShotList): Promise<AgentResult<Timeline>> {
  await sleep(ctx.delayMs)
  const cameras = ['slow push-in', 'handheld micro-shake', 'whip pan', 'depth dolly', 'zoom punch']
  const voices = script.beats.filter((b) => b.line && b.speaker).map((b) => {
    const c = ctx.profile.cast.find((x) => x.name === b.speaker)
    return { speaker: b.speaker as string, voice: c?.voiceProfile?.voice ?? ctx.profile.narrator?.voice ?? 'fable', text: b.line as string }
  })
  const timeline: Timeline = {
    durationSec: Math.round(shots.shots.reduce((s, x) => s + x.durationSec, 0)),
    shots: shots.shots.map((s, i) => ({ n: s.n, type: s.type, camera: cameras[i % cameras.length], motion: s.type === 'action' ? 'keyframes + implied-action cut' : 'subtle life', durationSec: s.durationSec })),
    audio: { voices, music: 'light playful loop', sfx: ['whoosh', 'thud', 'meow'] },
    mock: true,
  }
  return { output: timeline, summary: `${timeline.durationSec}s timeline · ${voices.length} voiced lines` }
}

// ---------- Editor-QA (media: mock until Phase 8/9) ----------
export async function editorQa(ctx: Ctx, timeline: Timeline): Promise<AgentResult<QaReport>> {
  await sleep(ctx.delayMs)
  const report: QaReport = {
    passed: true, mock: true,
    checks: [
      { name: 'Continuity', ok: true, note: 'no render yet (mock)' },
      { name: 'Captions in sync', ok: true, note: 'no render yet (mock)' },
      { name: 'Loudness', ok: true, note: 'target -14 LUFS (mock)' },
      { name: 'Lip-sync', ok: !voiced(ctx.profile) || timeline.audio.voices.length > 0, note: voiced(ctx.profile) ? 'voiced lines present' : 'not needed' },
    ],
  }
  return { output: report, summary: 'All checks passed (mock render)' }
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
