import { afterEach, describe, expect, it, vi } from 'vitest'
import * as agents from '@/pipeline/agents'
import { storyBuilder } from '@/pipeline/story-builder'
import { attachStory, ideaProblems, MIN_DISTINCT_EXPRESSIONS, normalizeExpressions, storyViolations } from '@/pipeline/story-rules'
import { emptyMemory, memoryBrief, readMemory, rememberEpisode } from '@/pipeline/memory'
import { mergeScriptPatch } from '@/pipeline/script-patch'
import { renderProfile } from '@/agents/prompt-builder'
import { BASE_EXPRESSIONS, closestExpression, EXPRESSION_VOCAB, expressionsOf, isExpression } from '@/lib/expressions'
import { allowedVibes, expressionPlan, isVibe, pickVibes, recentVibes, VIBE_IDS, VIBES, vibesFor, vibesLine } from '@/lib/vibes'
import { MOODS } from '@/engine/music'
import type { Idea, Script } from '@/pipeline/schemas'
import { ctxOf, fake, GOOD, goodScript, idea, profile } from './helpers'

// the free content check is a call to OpenAI: not made here
const moderate = vi.hoisted(() => vi.fn(async (_texts: string[]) => ({ flagged: false, reasons: [] as string[] })))
vi.mock('@/pipeline/moderation', async (orig) => ({ ...(await orig<typeof import('@/pipeline/moderation')>()), moderateTexts: moderate }))

afterEach(() => { vi.unstubAllEnvs() })

const base = [...BASE_EXPRESSIONS]
const critiqueOf = (rubric = GOOD, over: object = {}) => ({ rubric, failingBeats: [] as number[], notes: [] as string[], originalityRisk: false, policyRisk: false, ...over })
const withFaces = (s: Script, faces: string[]): Script => ({ ...s, beats: s.beats.map((b, i) => ({ ...b, expression: faces[i % faces.length] as never })) })

describe('the expression vocabulary', () => {
  it('has the four base expressions first, no repeats, and a nearest base expression for every word', () => {
    expect(EXPRESSION_VOCAB.slice(0, 4)).toEqual(base)
    expect(new Set(EXPRESSION_VOCAB).size).toBe(EXPRESSION_VOCAB.length)
    for (const e of EXPRESSION_VOCAB) expect(base).toContain(closestExpression(e, base))
    expect(isExpression('scared')).toBe(true); expect(isExpression('furious')).toBe(false)
  })

  it('moves a word to the nearest expression the series has: itself, then a relative, then the base one, then neutral', () => {
    expect(closestExpression('scared', base)).toBe('surprised')
    expect(closestExpression('scared', [...base, 'scared'])).toBe('scared')
    expect(closestExpression('excited', [...base, 'proud'])).toBe('proud') // a relative from its own group before the base one
    expect(closestExpression('tearful', base)).toBe('sad')
    expect(closestExpression('angry', ['neutral', 'happy'])).toBe('neutral')
    expect(closestExpression('angry', ['proud'])).toBe('proud') // the series has nothing close: whatever it has
    expect(closestExpression('whatever', [])).toBe('neutral')
  })

  it('offers the base four to every series, plus any known extra it has', () => {
    expect(expressionsOf(undefined)).toEqual(base)
    expect(expressionsOf([])).toEqual(base)
    expect(expressionsOf(['scared', 'proud', 'scared', 'made-up'])).toEqual([...base, 'scared', 'proud'])
  })
})

describe('the vibe palette', () => {
  it('has ten vibes, each with a story, an arc of 3 to 5 known expressions, a pace and a music mood', () => {
    expect(VIBE_IDS).toHaveLength(10)
    expect(Object.keys(VIBES).sort()).toEqual([...VIBE_IDS].sort())
    for (const id of VIBE_IDS) {
      const v = VIBES[id]
      expect(v.id).toBe(id)
      expect(v.story.length).toBeGreaterThan(20); expect(v.pace.length).toBeGreaterThan(10)
      expect(v.arc.length).toBeGreaterThanOrEqual(3); expect(v.arc.length).toBeLessThanOrEqual(5)
      expect(v.arc.every(isExpression)).toBe(true)
      expect(MOODS).toContain(v.music)
    }
    expect(new Set(VIBE_IDS.map((id) => VIBES[id].label)).size).toBe(10)
  })

  it('always gives a real story, even to a series that only has the four base expressions (at least 3 different faces, 6 or 7 beats)', () => {
    for (const id of VIBE_IDS) for (const beats of [6, 7]) {
      const plan = expressionPlan(id, beats, base)
      expect(plan).toHaveLength(beats)
      expect(plan.every((e) => base.includes(e as never))).toBe(true)
      expect(new Set(plan).size).toBeGreaterThanOrEqual(MIN_DISTINCT_EXPRESSIONS)
    }
  })

  it('uses the exact feelings of the arc when the series has them', () => {
    const plan = expressionPlan('adventure', 5, [...base, ...EXPRESSION_VOCAB])
    expect(plan).toEqual(['curious', 'determined', 'scared', 'excited', 'proud'])
    expect(expressionPlan('thrill', 7, [...EXPRESSION_VOCAB])[0]).toBe('worried')
  })

  it('does not offer a thriller or a sad goodbye to a kids series, and offers everything else', () => {
    const kids = vibesFor('kids').map((v) => v.id)
    expect(kids).not.toContain('thrill'); expect(kids).not.toContain('bittersweet')
    expect(kids).toContain('calm'); expect(kids).toContain('adventure')
    expect(vibesFor('animals')).toHaveLength(10); expect(vibesFor('generic')).toHaveLength(10)
    expect(allowedVibes('Kids bedtime stories').map((v) => v.id)).not.toContain('thrill')
    expect(allowedVibes('Cat videos', 'cat family drama').map((v) => v.id)).toContain('thrill')
  })

  it('picks three different vibes, keeping away from the recent ones unless there is nothing else', () => {
    const all = [...VIBE_IDS]
    const picked = pickVibes(all, ['comedy', 'adventure'])
    expect(new Set(picked).size).toBe(3)
    expect(picked).not.toContain('comedy'); expect(picked).not.toContain('adventure')
    expect(pickVibes(all, [], 3, 1)).not.toEqual(pickVibes(all, [], 3, 0)) // the offset rotates through the palette
    expect(pickVibes(['calm', 'comedy', 'mystery', 'thrill'], ['calm', 'comedy'])).toHaveLength(3) // too few fresh ones: recent ones come back
    expect(pickVibes(['calm'], [])).toEqual(['calm'])
  })

  it('reads the recent vibes, newest first, ignoring anything that is not a vibe', () => {
    const m = { recent: [{ vibe: 'calm' }, { vibe: null }, { vibe: 'nonsense' as never }, { vibe: 'comedy' }, { vibe: 'mystery' }] }
    expect(recentVibes(m as never)).toEqual(['calm', 'comedy'])
    expect(recentVibes(m as never, 3)).toEqual(['calm', 'comedy', 'mystery'])
    expect(isVibe('calm')).toBe(true); expect(isVibe('spooky')).toBe(false)
  })

  it('puts the palette into the cached series profile, with the expressions, and leaves out vibes that do not suit the niche', () => {
    const cats = renderProfile(profile)
    expect(cats).toContain('Vibes (every reel has exactly ONE')
    expect(cats).toContain('thrill = a chase')
    expect(cats).toContain('Expressions the main characters can show (every beat names one): neutral, happy, surprised, sad')
    const kids = renderProfile({ ...profile, niche: 'Kids bedtime stories' })
    expect(kids).not.toContain('thrill =')
    expect(kids).toContain('calm = ')
    expect(renderProfile({ ...profile, expressions: ['scared'] })).toContain('neutral, happy, surprised, sad, scared')
    expect(vibesLine(allowedVibes('Cat videos'))).toBe(vibesLine(allowedVibes('Cat videos'))) // identical text every time, so it can be cached
  })
})

describe('the story rules', () => {
  it('fits every beat to the expressions the series has, and attaches the vibe of the idea', async () => {
    const s = withFaces(await goodScript(), ['scared', 'happy', 'tearful', 'neutral', 'angry', 'proud', 'sad'])
    const fitted = normalizeExpressions(s, base)
    expect(fitted.beats.map((b) => b.expression)).toEqual(['surprised', 'happy', 'sad', 'neutral', 'sad', 'happy', 'sad'])
    expect(normalizeExpressions(s, [...base, 'scared', 'tearful']).beats.map((b) => b.expression).slice(0, 3)).toEqual(['scared', 'happy', 'tearful'])
    expect(attachStory(s, 'mystery', base).vibe).toBe('mystery')
    expect(attachStory({ ...s, vibe: undefined }, undefined, base).vibe).toBeUndefined()
    expect(attachStory({ ...s, vibe: 'calm' }, undefined, base).vibe).toBe('calm') // no new vibe: the one it has stays
  })

  it('wants at least three different expressions in a reel: a story changes how the character feels', async () => {
    const good = await goodScript()
    expect(storyViolations(withFaces(good, ['neutral']))[0]).toMatch(/only 1 different expression; .*use at least 3/)
    expect(storyViolations(withFaces(good, ['neutral', 'happy']))[0]).toMatch(/only 2 different expressions/)
    expect(storyViolations(withFaces(good, ['neutral', 'happy', 'sad']))).toEqual([])
  })

  it('names what is wrong with the three ideas: an unknown vibe, a repeated vibe, a recent vibe', () => {
    const allowed = [...VIBE_IDS]
    const ok = [idea(1, { vibe: 'comedy' }), idea(2, { vibe: 'adventure' }), idea(3, { vibe: 'calm' })]
    expect(ideaProblems(ok, allowed, [])).toEqual([])
    expect(ideaProblems([ok[0], idea(2, { vibe: 'comedy' }), ok[2]], allowed, [])).toEqual(['Ideas 1 and 2 have the same vibe "comedy"; every idea needs a different vibe.'])
    expect(ideaProblems(ok, ['comedy', 'adventure', 'mystery'], [])[0]).toMatch(/Idea 3 uses the vibe "calm", which this series does not offer/)
    expect(ideaProblems(ok, allowed, ['comedy'])[0]).toMatch(/Idea 1 uses the vibe "comedy" of a recent reel/)
    // with too few other vibes to choose from, a recent one is allowed to come back
    expect(ideaProblems(ok, ['comedy', 'adventure', 'calm', 'mystery'], ['comedy', 'adventure'])).toEqual([])
  })
})

describe('the series memory keeps the vibes', () => {
  it('remembers the vibe of each finished reel, and tells the next idea which two to stay away from', async () => {
    let m = emptyMemory()
    for (const [n, vibe] of [[1, 'comedy'], [2, 'adventure'], [3, 'calm']] as const) m = rememberEpisode(m, { idea: idea(n, { vibe }), script: await goodScript() })
    expect(m.recent.map((e) => e.vibe)).toEqual(['calm', 'adventure', 'comedy'])
    expect(memoryBrief(m).recentVibes).toEqual(['calm', 'adventure'])
    expect(memoryBrief(m).recentReels[0]).toMatchObject({ title: 'Idea 3', vibe: 'calm' })
  })

  it('reads stored memory from before the vibes existed, and drops a vibe it does not know', () => {
    const m = readMemory({ recent: [{ title: 'Old', premise: 'p' }, { title: 'New', premise: 'q', vibe: 'mystery' }, { title: 'Odd', premise: 'r', vibe: 'spooky' }] })
    expect(m.recent.map((e) => e.vibe)).toEqual([null, 'mystery', null])
    expect(memoryBrief(m).recentVibes).toEqual(['mystery'])
  })
})

describe('Creator: ideas with different vibes', () => {
  const ideas = (...vibes: Idea['vibe'][]) => ({ ideas: vibes.map((vibe, i) => idea(i + 1, { vibe })) })

  it('is given the vibes that suit the series and the vibes of the last two reels, and gets three different ones', async () => {
    let memory = emptyMemory()
    for (const [n, vibe] of [[1, 'comedy'], [2, 'adventure']] as const) memory = rememberEpisode(memory, { idea: idea(n, { vibe }), script: await goodScript() })
    const { llm, calls, counts } = fake({ creator: () => ideas('calm', 'mystery', 'whimsical') })
    const r = await agents.creator(ctxOf(llm, { memory }))
    const user = calls[0].prompt.user
    expect(user).toContain('"vibesToChooseFrom":["adventure","calm","comedy"')
    expect(user).toContain('"avoidVibes":["adventure","comedy"]')
    expect(counts.creator).toBe(1)
    expect(r.output.map((i) => i.vibe)).toEqual(['calm', 'mystery', 'whimsical'])
    expect(r.summary).toContain('(calm)')
    expect(calls[0].prompt.system).toContain('Every reel is a SHORT STORY')
  })

  it('does not offer a thriller to a kids series', async () => {
    const { llm, calls } = fake({ creator: () => ideas('calm', 'whimsical', 'adventure') })
    await agents.creator(ctxOf(llm, { profile: { ...profile, niche: 'Kids bedtime stories' } }))
    expect(calls[0].prompt.user).not.toContain('thrill')
  })

  it('asks once more, naming the problem, when two ideas share a vibe, and uses the better answer', async () => {
    const { llm, calls, counts } = fake({ creator: (_c, n) => (n === 1 ? ideas('comedy', 'comedy', 'calm') : ideas('comedy', 'mystery', 'calm')) })
    const r = await agents.creator(ctxOf(llm))
    expect(counts.creator).toBe(2)
    expect(calls[1].prompt.user).toContain('fixThese')
    expect(calls[1].prompt.user).toContain('Ideas 1 and 2 have the same vibe')
    expect(r.output.map((i) => i.vibe)).toEqual(['comedy', 'mystery', 'calm'])
    expect(r.usage!.inputTokens).toBe(2000) // both answers are paid for and counted
  })

  it('keeps the first answer when the second one is no better, instead of failing the episode', async () => {
    const { llm, counts } = fake({ creator: (_c, n) => (n === 1 ? ideas('comedy', 'comedy', 'calm') : ideas('comedy', 'comedy', 'comedy')) })
    const r = await agents.creator(ctxOf(llm))
    expect(counts.creator).toBe(2)
    expect(r.output.map((i) => i.vibe)).toEqual(['comedy', 'comedy', 'calm'])
  })

  it('in the free mock gives three different vibes that follow the memory, each with its arc', async () => {
    let memory = emptyMemory()
    for (const [n, vibe] of [[1, 'comedy'], [2, 'adventure']] as const) memory = rememberEpisode(memory, { idea: idea(n, { vibe }), script: await goodScript() })
    const r = await agents.creator({ ...ctxOf(async () => { throw new Error('unused') }, { memory }), mode: 'mock' })
    const vibes = r.output.map((i) => i.vibe)
    expect(new Set(vibes).size).toBe(3)
    expect(vibes).not.toContain('comedy'); expect(vibes).not.toContain('adventure')
    for (const i of r.output) expect(i.arc).toBe(VIBES[i.vibe].arc.join(' > '))
  })
})

describe('Writer and Critic know the vibe', () => {
  it('the Writer is given the story, the arc and the pace of the idea\'s vibe', async () => {
    const script = await goodScript()
    const { llm, calls } = fake({ writer: () => script })
    await agents.writer(ctxOf(llm), idea(1, { vibe: 'calm' }), [], null)
    const user = calls[0].prompt.user
    expect(user).toContain('"vibe":"calm"')
    expect(user).toContain('"arc":"peaceful > curious > surprised > happy > peaceful"')
    expect(calls[0].prompt.system).toContain('every beat names the facial expression')
  })

  it('the free mock Writer follows the arc beat by beat with expressions the series has', async () => {
    for (const vibe of VIBE_IDS) {
      const s = (await agents.writer({ ...ctxOf(async () => { throw new Error('unused') }), mode: 'mock' }, idea(1, { vibe }), [], null)).output
      expect(s.vibe).toBe(vibe)
      expect(s.beats.every((b) => base.includes(b.expression as never))).toBe(true)
      expect(storyViolations(s)).toEqual([])
      expect(s.beats[0].expression).toBe(closestExpression(VIBES[vibe].arc[0], base))
    }
  })

  it('the Critic is given the vibe, and scores the emotional arc: a flat story is not approved however the model words it', async () => {
    const script = { ...(await goodScript()), vibe: 'mystery' as const }
    const { llm, calls } = fake({ critic: () => critiqueOf({ ...GOOD, emotionalArc: 2 }, { notes: [] }) })
    const r = await agents.critic(ctxOf(llm), script, 1)
    expect(calls[0].prompt.user).toContain('"vibe":"mystery"')
    expect(r.output.approved).toBe(false)
    expect(r.output.notes[0]).toMatch(/the emotional arc/)
    expect(r.output.rubric).toHaveProperty('emotionalArc', 2)
  })

  it('the Style agent is given the vibe, so the mood of the reel fits it', async () => {
    const script = await goodScript()
    const { llm, calls } = fake({ styleNotes: () => ({ mood: 'soft', timeOfDay: 'dusk', weather: 'clear', accentColour: '#112233', note: 'warm' }) })
    await agents.styleNotes(ctxOf(llm), script, 'calm')
    expect(calls[0].prompt.user).toContain('"vibe":"calm"')
    expect(calls[0].prompt.system).toContain('The reel has a vibe')
  })
})

describe('Story Builder: the story rule', () => {
  it('attaches the vibe of the picked idea to the script, and keeps it through a patch revision', async () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'on')
    const good = await goodScript()
    const patch = { title: null, hook: null, payoff: null, supportingCast: null, beats: [{ ...good.beats[0], action: 'A stronger hook' }] }
    const { llm } = fake({
      picker: () => ({ scores: [], bestIndex: 1, reason: 'best' }),
      writer: (_c, n) => (n === 1 ? good : patch),
      critic: (_c, n) => (n === 1 ? critiqueOf({ ...GOOD, hook: 2 }, { failingBeats: [1], notes: ['Beat 1: slow'] }) : critiqueOf()),
    })
    const r = await storyBuilder(ctxOf(llm), [idea(1, { vibe: 'comedy' }), idea(2, { vibe: 'mystery' }), idea(3, { vibe: 'calm' })])
    expect(r.output.rounds).toBe(2)
    expect(r.output.script.vibe).toBe('mystery')
    expect(mergeScriptPatch({ ...good, vibe: 'calm' }, patch).vibe).toBe('calm')
  })

  it('does not pay for the Critic when the reel shows too few expressions: it goes straight back to the Writer', async () => {
    const good = await goodScript()
    const flat = withFaces(good, ['neutral'])
    const { llm, calls, counts } = fake({ writer: (_c, n) => (n === 1 ? flat : good), critic: () => critiqueOf() })
    const r = await storyBuilder(ctxOf(llm), [idea(1)])
    expect(counts.critic).toBe(1) // never called for the flat script
    expect(counts.writer).toBe(2)
    expect(calls.filter((c) => c.agent === 'writer')[1].prompt.user).toContain('Story rule: The beats show only 1 different expression')
    expect(r.output.rounds).toBe(2)
  })

  it('moves an expression the series does not have to the nearest one it has, without a rewrite', async () => {
    const good = await goodScript()
    const faces = withFaces(good, ['curious', 'scared', 'happy', 'tearful', 'sad', 'proud', 'determined'])
    const { llm, counts } = fake({ writer: () => faces, critic: () => critiqueOf() })
    const r = await storyBuilder(ctxOf(llm), [idea(1)])
    expect(counts.writer).toBe(1)
    expect(r.output.script.beats.map((b) => b.expression)).toEqual(['neutral', 'surprised', 'happy', 'sad', 'sad', 'happy', 'neutral'])
  })

  it('keeps the exact expressions when the series has them', async () => {
    const good = await goodScript()
    const faces = withFaces(good, ['curious', 'scared', 'happy', 'tearful', 'sad', 'proud', 'determined'])
    const { llm } = fake({ writer: () => faces, critic: () => critiqueOf() })
    const r = await storyBuilder(ctxOf(llm, { profile: { ...profile, expressions: ['curious', 'scared', 'tearful', 'proud', 'determined'] } }), [idea(1)])
    expect(r.output.script.beats.map((b) => b.expression)).toEqual(['curious', 'scared', 'happy', 'tearful', 'sad', 'proud', 'determined'])
  })

  it('tells the picker which vibes the last reels had, so it can prefer a fresh one', async () => {
    let memory = emptyMemory()
    memory = rememberEpisode(memory, { idea: idea(9, { vibe: 'comedy' }), script: await goodScript() })
    const script = await goodScript()
    const { llm, calls } = fake({ picker: () => ({ scores: [], bestIndex: 0, reason: 'x' }), writer: () => script, critic: () => critiqueOf() })
    await storyBuilder(ctxOf(llm, { memory }), [idea(1, { vibe: 'calm' }), idea(2, { vibe: 'mystery' })])
    expect(calls.find((c) => c.agent === 'picker')!.prompt.user).toContain('"avoidVibes":["comedy"]')
    expect(calls.find((c) => c.agent === 'picker')!.prompt.system).toContain('vibe fit')
  })
})
