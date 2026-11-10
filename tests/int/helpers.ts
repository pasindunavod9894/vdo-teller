import { vi } from 'vitest'
import * as agents from '@/pipeline/agents'
import type { Ctx, LlmCall, LlmRunner } from '@/pipeline/agents'
import type { SeriesProfile } from '@/agents/profile'
import type { Idea, Script } from '@/pipeline/schemas'

/** Shared by the specs that run agents against a fake model, so nothing is ever spent. */
export const profile: SeriesProfile = {
  niche: 'Cat videos', style: { id: 'pixar-3d' }, durationTargetSec: 28, aspect: '9:16', voiceMode: 'character_voices',
  cast: [{ name: 'Mango', canonical: 'orange tabby', voiceProfile: { voice: 'coral' } }, { name: 'Luna', canonical: 'grey cat', voiceProfile: { voice: 'onyx' } }], narrator: { voice: 'fable' },
}
export const idea = (n: number, over: Partial<Idea> = {}): Idea => ({ title: `Idea ${n}`, premise: `Premise ${n}`, hook: `Hook ${n}`, emotionalCore: 'warm', runningGag: null, vibe: 'comedy', arc: 'smug > confused > shocked > embarrassed > happy', ...over })
export const GOOD = { hook: 4, silentClarity: 4, emotionalArc: 4, payoff: 4, castTruth: 4, feasibility: 4, originality: 4, loop: 4 }
export const USAGE = { inputTokens: 1000, cachedTokens: 0, outputTokens: 500, reasoningTokens: 0 }

export type Handlers = Partial<Record<string, (call: LlmCall, n: number) => unknown>>
/** A fake model: each agent answers with whatever its handler returns, and every request is recorded. */
export function fake(handlers: Handlers) {
  const calls: LlmCall[] = []
  const counts: Record<string, number> = {}
  const llm: LlmRunner = async (call) => {
    calls.push(call)
    counts[call.agent] = (counts[call.agent] ?? 0) + 1
    const h = handlers[call.agent]
    if (!h) throw new Error(`no fake answer for ${call.agent}`)
    return { output: h(call, counts[call.agent]), usage: USAGE }
  }
  return { llm, calls, counts }
}
export const ctxOf = (llm: LlmRunner, over: Partial<Ctx> = {}): Ctx => ({ profile, seriesId: 1, mode: 'text', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: 100, provider: 'mock' }, llm, ...over })
/** A valid 15 s script made by the free mock Writer. */
export const goodScript = async (title = 'Idea 1'): Promise<Script> => (await agents.writer({ ...ctxOf(async () => { throw new Error('unused') }), mode: 'mock' }, idea(1, { title }), [], null)).output
export const quiet = () => { vi.spyOn(console, 'error').mockImplementation(() => {}) }

/** What a model returns for a 4-beat script: one shot per beat, varied angles. */
export const draftFor = (script: Script, over: Record<string, unknown> = {}) => ({
  shots: script.beats.map((b, i) => ({
    n: i + 1, type: (['establishing', 'dialogue', 'action', 'reaction'] as const)[i % 4], description: b.action, durationSec: [3, 4, 5, 3][i % 4],
    characters: [b.speaker && b.speaker !== 'narrator' ? b.speaker : 'Mango'], beat: b.n, videoSeconds: 5,
    keyframePrompt: `Low angle on ${b.action}`, motionPrompt: 'A slow push-in as the cat turns', angle: ['wide establishing', 'close-up', 'low angle', 'over the shoulder'][i % 4],
  })),
  unfilmable: [] as { beat: number; reason: string }[], ...over,
})

// ---------- an in-memory stand-in for Payload: the collections and calls the pipeline store makes ----------
export type Doc = Record<string, unknown> & { id: number }
export function fakePayload(seed: Record<string, Doc[]>) {
  const db: Record<string, Doc[]> = { episodes: [], series: [], 'pipeline-steps': [], characters: [], ...seed }
  let nextId = 1000
  const idOf = (v: unknown) => (typeof v === 'object' && v ? (v as Doc).id : v)
  const match = (d: Doc, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true
    if (Array.isArray(where.and)) return (where.and as Record<string, unknown>[]).every((w) => match(d, w))
    return Object.entries(where).every(([field, cond]) => {
      const c = cond as Record<string, unknown>
      const v = idOf(d[field])
      if ('equals' in c) return v === c.equals
      if ('not_equals' in c) return v !== c.not_equals
      if ('greater_than' in c) return String(v) > String(c.greater_than)
      return true
    })
  }
  const payload = {
    findByID: async ({ collection, id }: { collection: string; id: number | string }) => { const d = db[collection].find((x) => String(x.id) === String(id)); if (!d) throw new Error('not found'); return structuredClone(d) },
    find: async ({ collection, where, limit = 10 }: { collection: string; where?: Record<string, unknown>; limit?: number }) => ({ docs: structuredClone(db[collection].filter((d) => match(d, where)).slice(0, limit)), hasNextPage: false }),
    update: async ({ collection, id, data }: { collection: string; id: number | string; data: Record<string, unknown> }) => { const d = db[collection].find((x) => String(x.id) === String(id))!; Object.assign(d, data); return structuredClone(d) },
    create: async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => { const d = { id: nextId++, createdAt: new Date().toISOString(), ...data } as Doc; db[collection].push(d); return structuredClone(d) },
    delete: async ({ collection, id }: { collection: string; id: number }) => { db[collection] = db[collection].filter((x) => x.id !== id) },
  }
  return { payload: payload as never, db }
}
