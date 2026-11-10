import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as agents from '@/pipeline/agents'
import type { Ctx, LlmCall, LlmRunner } from '@/pipeline/agents'
import { storyBuilder } from '@/pipeline/story-builder'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import { avoidTitlesFrom, emptyMemory, hydrateRecurring, memoryBrief, readMemory, rememberEpisode, MEMORY_RECENT } from '@/pipeline/memory'
import { PolicyError } from '@/pipeline/errors'
import type { Idea, Script } from '@/pipeline/schemas'
import { ScriptPatchSchema } from '@/pipeline/script-patch'
import type { SeriesProfile } from '@/agents/profile'
import { draftFor } from './helpers'
import { tokenCostUsd } from '@/agents/models'

const moderate = vi.hoisted(() => vi.fn(async (_texts: string[]) => ({ flagged: false, reasons: [] as string[] })))
vi.mock('@/pipeline/moderation', async (orig) => ({ ...(await orig<typeof import('@/pipeline/moderation')>()), moderateTexts: moderate }))

beforeEach(() => { moderate.mockClear(); moderate.mockImplementation(async () => ({ flagged: false, reasons: [] })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

const profile: SeriesProfile = {
  niche: 'Cat videos', style: { id: 'pixar-3d' }, durationTargetSec: 28, aspect: '9:16', voiceMode: 'character_voices',
  cast: [{ name: 'Mango', canonical: 'orange tabby', voiceProfile: { voice: 'coral' } }, { name: 'Luna', canonical: 'grey cat', voiceProfile: { voice: 'onyx' } }], narrator: { voice: 'fable' },
}
const idea = (n: number, over: Partial<Idea> = {}): Idea => ({ title: `Idea ${n}`, premise: `Premise ${n}`, hook: `Hook ${n}`, emotionalCore: 'warm', runningGag: null, vibe: 'comedy', arc: 'smug > confused > shocked > embarrassed > happy', ...over })
/** Three ideas with three different vibes, as the Creator must give them. */
const three = () => [idea(1, { vibe: 'comedy' }), idea(2, { vibe: 'adventure' }), idea(3, { vibe: 'calm' })]
const GOOD = { hook: 4, silentClarity: 4, emotionalArc: 4, payoff: 4, castTruth: 4, feasibility: 4, originality: 4, loop: 4 }
const USAGE = { inputTokens: 1000, cachedTokens: 0, outputTokens: 500, reasoningTokens: 0 }

type Handlers = Partial<Record<string, (call: LlmCall, n: number) => unknown>>
/** A fake model: each agent answers with whatever its handler returns, and every request is recorded. */
function fake(handlers: Handlers) {
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
const ctxOf = (llm: LlmRunner, over: Partial<Ctx> = {}): Ctx => ({ profile, seriesId: 1, mode: 'text', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: 100, provider: 'mock' }, llm, ...over })
/** A valid 15 s script made by the free mock Writer. */
const goodScript = async (title = 'Idea 1'): Promise<Script> => (await agents.writer({ ...ctxOf(async () => { throw new Error('unused') }), mode: 'mock' }, idea(1, { title }), [], null)).output

describe('Creator', () => {
  it('returns three ideas, tells the model the series memory, the titles to avoid and the reel length, and searches the web', async () => {
    const { llm, calls } = fake({ creator: () => ({ ideas: three() }) })
    const memory = rememberEpisode(emptyMemory(), { idea: idea(0, { title: 'Last week', runningGag: 'the red hat' }), script: await goodScript() })
    const r = await agents.creator(ctxOf(llm, { memory, avoidTitles: ['Old rejected title'] }))
    expect(r.output.map((i) => i.title)).toEqual(['Idea 1', 'Idea 2', 'Idea 3'])
    expect(calls[0].webSearch).toBe(true)
    expect(calls[0].model).toBe('gpt-5-mini')
    const user = calls[0].prompt.user
    expect(user).toContain('Last week'); expect(user).toContain('the red hat'); expect(user).toContain('Old rejected title'); expect(user).toContain('"seconds":28')
    expect(calls[0].prompt.system).toContain('You are the Creator')
    expect(calls[0].prompt.system).not.toContain('Last week') // memory is in the episode block, so the cached prefix stays the same
  })

  it('prices the call from its real token usage and can run without web search', async () => {
    vi.stubEnv('CREATOR_WEB_SEARCH', 'off')
    const { llm, calls } = fake({ creator: () => ({ ideas: [idea(1)] }) })
    const r = await agents.creator(ctxOf(llm))
    expect(calls[0].webSearch).toBe(false)
    expect(r.usage!.costUsd).toBeCloseTo(tokenCostUsd('gpt-5-mini', { inputTokens: 1000, cachedTokens: 0, outputTokens: 500 }), 8)
  })

  it('scrubs brand names, and stops the episode for a human when the ideas are flagged', async () => {
    const { llm } = fake({ creator: () => ({ ideas: [idea(1, { title: 'A Disney day' })] }) })
    expect((await agents.creator(ctxOf(llm))).output[0].title).toBe('A day')
    moderate.mockImplementation(async () => ({ flagged: true, reasons: ['violence'] }))
    await expect(agents.creator(ctxOf(llm))).rejects.toBeInstanceOf(PolicyError)
  })

  it('rejects an answer that does not match its format, instead of using it', async () => {
    const { llm } = fake({ creator: () => ({ ideas: 'nope' }) })
    await expect(agents.creator(ctxOf(llm))).rejects.toThrow(/does not match its format/)
  })

  it('makes three different ideas in mock mode, none of them a title to avoid', async () => {
    const r = await agents.creator({ ...ctxOf(async () => { throw new Error('unused') }), mode: 'mock', avoidTitles: ["Mango and the Luna's wild plan"] })
    expect(new Set(r.output.map((i) => i.title)).size).toBe(3)
    expect(r.output.map((i) => i.title)).not.toContain("Mango and the Luna's wild plan")
  })
})

describe('Story Builder', () => {
  const critiqueOf = (rubric = GOOD, over: object = {}) => ({ rubric, failingBeats: [] as number[], notes: [] as string[], originalityRisk: false, policyRisk: false, ...over })

  it('picks the idea the scorer names, writes it, and has the Critic approve it in code', async () => {
    const script = await goodScript('Idea 2')
    const { llm, calls, counts } = fake({
      picker: () => ({ scores: [], bestIndex: 1, reason: 'a stronger hook' }),
      writer: () => script,
      critic: () => critiqueOf({ ...GOOD, hook: 5 }, { notes: ['the model said ship it'] }),
    })
    const r = await storyBuilder(ctxOf(llm), [idea(1), idea(2), idea(3)])
    expect(r.output.idea.title).toBe('Idea 2')
    expect(calls.find((c) => c.agent === 'writer')!.prompt.user).toContain('Idea 2')
    expect(r.output.critique).toMatchObject({ approved: true, notes: [] })
    expect(counts).toEqual({ picker: 1, writer: 1, critic: 1 })
    expect(r.summary).toMatch(/Idea 2.*7 beats.*1 round.*approved/)
  })

  it('does not pay for the Critic when the script breaks the cast or length rule: it goes straight back to the Writer with the problem', async () => {
    const good = await goodScript()
    const bad: Script = { ...good, beats: good.beats.map((b, i) => (i === 1 ? { ...b, speaker: 'Stranger', line: 'Who am I?' } : b)) }
    const { llm, calls, counts } = fake({ writer: (_c, n) => (n === 1 ? bad : good), critic: () => critiqueOf() })
    const r = await storyBuilder(ctxOf(llm), [idea(1)])
    expect(counts.critic).toBe(1) // never called for the bad script
    expect(counts.writer).toBe(2)
    expect(calls.filter((c) => c.agent === 'writer')[1].prompt.user).toContain('Cast rule: Beat 2: \\"Stranger\\" is not in the cast')
    expect(r.output.rounds).toBe(2)
  })

  it('rejects a script with a weak hook however the model words it, and rewrites only what changed when optimization is on', async () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'on')
    const good = await goodScript()
    const patch = { title: null, hook: null, payoff: null, supportingCast: null, beats: [{ ...good.beats[0], action: 'A much stronger hook' }] }
    const { llm, calls } = fake({
      writer: (_c, n) => (n === 1 ? good : patch),
      critic: (_c, n) => (n === 1 ? critiqueOf({ ...GOOD, hook: 2 }, { failingBeats: [1], notes: ['Beat 1: the hook is slow'] }) : critiqueOf()),
    })
    const r = await storyBuilder(ctxOf(llm), [idea(1)])
    const second = calls.filter((c) => c.agent === 'writer')[1]
    expect(second.schema).toBe(ScriptPatchSchema) // a revision returns only changed beats
    expect(r.output.script.beats[0].action).toBe('A much stronger hook')
    expect(r.output.script.beats).toHaveLength(good.beats.length) // the other beats are kept
    expect(r.output.critique.approved).toBe(true)
    expect(r.output.rounds).toBe(2)
  })

  it('stops after 3 rounds and keeps the best attempt when the Critic never approves', async () => {
    const good = await goodScript()
    const { llm, counts } = fake({ writer: () => good, critic: () => critiqueOf({ ...GOOD, hook: 2 }, { failingBeats: [1], notes: ['Beat 1: still weak'] }) })
    const r = await storyBuilder(ctxOf(llm), [idea(1)])
    expect(counts.writer).toBe(3); expect(counts.critic).toBe(3)
    expect(r.output.critique.approved).toBe(false)
    expect(r.output.script.title).toBe(good.title)
    expect(r.summary).toMatch(/not approved/)
  })

  it('fails clearly when the Writer keeps breaking the rules', async () => {
    const good = await goodScript()
    const { llm } = fake({ writer: () => ({ ...good, beats: good.beats.slice(0, 1) }), critic: () => critiqueOf() })
    await expect(storyBuilder(ctxOf(llm), [idea(1)])).rejects.toThrow(/still breaks the cast or length rule after 3 tries.*Length rule/)
  })

  it('flags the script for review when the content check flags it', async () => {
    moderate.mockImplementation(async () => ({ flagged: true, reasons: ['harassment'] }))
    const script = await goodScript()
    const { llm } = fake({ writer: () => script, critic: () => critiqueOf() })
    const r = await storyBuilder(ctxOf(llm), [idea(1)])
    expect(r.output.critique).toMatchObject({ approved: false, policyRisk: true })
    expect(r.output.critique.notes.join(' ')).toMatch(/content check flagged.*harassment/)
  })

  it('adds the cost of every call it made into one usage, and stops when the budget says no', async () => {
    const good = await goodScript()
    const { llm } = fake({ picker: () => ({ scores: [], bestIndex: 0, reason: 'x' }), writer: () => good, critic: () => critiqueOf() })
    const r = await storyBuilder(ctxOf(llm), [idea(1), idea(2)])
    expect(r.usage!.inputTokens).toBe(3000) // picker + writer + critic
    expect(r.usage!.costUsd).toBeGreaterThan(0)
    await expect(storyBuilder(ctxOf(llm, { canSpend: async () => false }), [idea(1)])).rejects.toThrow(/Cost cap/)
  })

  it('uses a recurring character of the series when the script names it without declaring it', async () => {
    const memory = rememberEpisode(emptyMemory(), { idea: idea(0), script: { ...(await goodScript()), supportingCast: [{ name: 'Grumble', role: 'shopkeeper', canonicalLook: 'a tall grey owl', personality: 'grumpy', voice: null, recurring: true }] } })
    const good = await goodScript()
    const withOwl: Script = { ...good, beats: good.beats.map((b, i) => (i === 1 ? { ...b, speaker: 'Grumble', line: 'Hm.' } : b)) }
    const { llm } = fake({ writer: () => withOwl, critic: () => critiqueOf() })
    const r = await storyBuilder(ctxOf(llm, { memory }), [idea(1)])
    expect(r.output.script.supportingCast).toEqual([expect.objectContaining({ name: 'Grumble', canonicalLook: 'a tall grey owl', recurring: true })])
    expect(r.output.rounds).toBe(1) // no cast-rule round was needed
  })
})

describe('Style notes', () => {
  it('returns the mood of this reel and replaces an accent colour that is not a real colour', async () => {
    const note = (accentColour: string) => ({ mood: 'cosy', timeOfDay: 'dusk', weather: 'rain', accentColour, note: 'Warm lamps.' })
    const script = await goodScript()
    const ok = await agents.styleNotes(ctxOf(fake({ styleNotes: () => note('#aabbcc') }).llm), script)
    expect(ok.output.accentColour).toBe('#AABBCC')
    const bad = await agents.styleNotes(ctxOf(fake({ styleNotes: () => note('url(javascript:alert(1))') }).llm), script)
    expect(bad.output.accentColour).toMatch(/^#[0-9A-F]{6}$/)
    expect(ok.usage!.model).toBe('gpt-5-nano')
  })
})

describe('series memory', () => {
  const owl = { name: 'Grumble', role: 'shopkeeper', canonicalLook: 'a tall grey owl', personality: 'grumpy', voice: 'onyx', recurring: true }

  it('remembers the newest ideas first, without repeats, up to the limit', async () => {
    let m = emptyMemory()
    for (let i = 1; i <= MEMORY_RECENT + 3; i++) m = rememberEpisode(m, { idea: idea(i), script: await goodScript() })
    expect(m.recent).toHaveLength(MEMORY_RECENT)
    expect(m.recent[0].title).toBe(`Idea ${MEMORY_RECENT + 3}`)
    m = rememberEpisode(m, { idea: idea(MEMORY_RECENT + 3), script: await goodScript() })
    expect(m.recent.filter((e) => e.title === `Idea ${MEMORY_RECENT + 3}`)).toHaveLength(1)
  })

  it('saves a supporting character only when the story marked it recurring, and updates it by name', async () => {
    const base = await goodScript()
    let m = rememberEpisode(emptyMemory(), { idea: idea(1), script: { ...base, supportingCast: [{ ...owl, recurring: false, name: 'OneOff' }, owl] } })
    expect(m.recurringCast.map((c) => c.name)).toEqual(['Grumble'])
    m = rememberEpisode(m, { idea: idea(2), script: { ...base, supportingCast: [{ ...owl, canonicalLook: 'a tall grey owl with a new apron' }] } })
    expect(m.recurringCast).toHaveLength(1)
    expect(m.recurringCast[0].canonicalLook).toContain('new apron')
  })

  it('fills in a recurring character a script uses but does not declare, and leaves other scripts alone', async () => {
    const m = rememberEpisode(emptyMemory(), { idea: idea(1), script: { ...(await goodScript()), supportingCast: [owl] } })
    const good = await goodScript()
    const used: Script = { ...good, beats: good.beats.map((b, i) => (i === 0 ? { ...b, speaker: 'grumble', line: 'Hm.' } : b)) }
    expect(hydrateRecurring(used, m, ['Mango', 'Luna']).supportingCast.map((s) => s.name)).toEqual(['Grumble'])
    expect(hydrateRecurring(good, m, ['Mango', 'Luna'])).toBe(good)
    const declared = { ...used, supportingCast: [owl] }
    expect(hydrateRecurring(declared, m, ['Mango']).supportingCast).toHaveLength(1)
  })

  it('reads damaged stored data as an empty memory, and builds a compact brief and an avoid list', async () => {
    expect(readMemory(null)).toEqual(emptyMemory())
    expect(readMemory('x')).toEqual(emptyMemory())
    expect(readMemory({ recent: [{ title: '' }, { title: 'Kept', premise: 'p' }], recurringCast: [{ name: 'A' }] })).toEqual({ recent: [{ title: 'Kept', premise: 'p', runningGag: null, vibe: null }], recurringCast: [] })
    const m = rememberEpisode(emptyMemory(), { idea: idea(1, { runningGag: 'the red hat' }), script: { ...(await goodScript()), supportingCast: [owl] } })
    const b = memoryBrief(m)
    expect(b.runningGagsSoFar).toEqual(['the red hat'])
    expect(b.recurringCharactersYouMayReuse[0]).toMatchObject({ name: 'Grumble', look: 'a tall grey owl' })
    expect(avoidTitlesFrom(m, ['idea 1', 'Another', ''])).toEqual(['Idea 1', 'Another'])
  })
})

describe('a full episode with the fake model', () => {
  it('goes Creator → Story Builder → Style → Art Director → Editor → Publisher, books every cost, and updates the series memory', async () => {
    const script = await goodScript('Idea 2')
    const { llm, counts } = fake({
      creator: () => ({ ideas: three() }), picker: () => ({ scores: [], bestIndex: 1, reason: 'best' }), writer: () => script, critic: () => ({ rubric: GOOD, failingBeats: [], notes: [], originalityRisk: false, policyRisk: false }),
      styleNotes: () => ({ mood: 'cosy', timeOfDay: 'dusk', weather: 'rain', accentColour: '#112233', note: 'Warm lamps.' }),
      artDirector: () => draftFor(script),
      publisher: () => ({ title: 'Idea 2', caption: 'Funny cats', hashtags: ['#a', '#b', '#c'], aiLabel: 'Made with AI' }),
    })
    const events: string[] = []
    const episode: Record<string, unknown> = {}
    let spent = 0
    let remembered: { idea: Idea; script: Script } | null = null
    const store: Store = {
      stepStart: async (k) => { events.push(k) }, stepDone: async () => {}, stepFail: async (k, m) => { throw new Error(`${k}: ${m}`) },
      episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async (usd) => { spent += usd },
      episodeDone: async (info) => { remembered = info },
    }
    const out = await runEpisode(ctxOf(llm), store, [])
    expect(out.status).toBe('done')
    expect(events).toEqual(['orchestrator-plan', 'creator', 'story-builder', 'style', 'art-director', 'editor-clips', 'editor-assemble', 'publisher', 'orchestrator-final'])
    expect(counts).toEqual({ creator: 1, picker: 1, writer: 1, critic: 1, styleNotes: 1, artDirector: 1, publisher: 1 })
    expect((episode.ideas as Idea[]).map((i) => i.title)).toEqual(['Idea 1', 'Idea 2', 'Idea 3'])
    expect((episode.idea as Idea).title).toBe('Idea 2')
    expect(episode.styleNotes).toMatchObject({ mood: 'cosy', accentColour: '#112233' })
    expect(spent).toBeGreaterThan(0)
    expect(out.costUsd).toBeCloseTo(spent, 6)
    expect(remembered!.idea.title).toBe('Idea 2')
  })

  it('stops for review without spending more when the Creator\'s ideas are flagged', async () => {
    moderate.mockImplementation(async () => ({ flagged: true, reasons: ['sexual'] }))
    const { llm, counts } = fake({ creator: () => ({ ideas: [idea(1)] }) })
    const episode: Record<string, unknown> = {}
    const store: Store = { stepStart: async () => {}, stepDone: async () => {}, stepFail: async () => {}, episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async () => {} }
    const out = await runEpisode(ctxOf(llm), store, [])
    expect(out.status).toBe('needs-review')
    expect(String(episode.error)).toMatch(/flagged by the content check/)
    expect(counts.writer).toBeUndefined()
  })
})
