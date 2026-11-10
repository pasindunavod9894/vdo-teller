import { afterEach, describe, expect, it, vi } from 'vitest'
import { directArt, normalizeDurations, planShots, shotPlanProblems } from '@/pipeline/art-director'
import * as agents from '@/pipeline/agents'
import type { Script } from '@/pipeline/schemas'
import { ctxOf, draftFor, fake, goodScript, idea } from './helpers'

afterEach(() => { vi.restoreAllMocks() })

const MAIN = ['Mango', 'Luna']

describe('shot durations', () => {
  it('are scaled to add up to the reel length, within 1.5 to 5 s each, with the rounding on the last shot', () => {
    const d = normalizeDurations([3, 4, 5, 3], 15)
    expect(d.reduce((n, x) => n + x, 0)).toBeCloseTo(15, 5)
    expect(normalizeDurations([1, 1, 1], 10).reduce((n, x) => n + x, 0)).toBeCloseTo(10, 5)
    expect(Math.max(...normalizeDurations([20, 1, 1, 1], 15))).toBeLessThanOrEqual(5) // the huge one is held at one 5 s clip
    expect(normalizeDurations([NaN, 3, 3], 9).every((x) => x > 0)).toBe(true)
  })
})

describe('checking a shot plan', () => {
  it('passes a plan with one shot per beat, the right beats, only the cast, and varied angles', async () => {
    const s = await goodScript()
    expect(shotPlanProblems(draftFor(s) as never, s, MAIN)).toEqual([])
  })
  it('names a wrong shot count, wrong beats, strangers, repeated angles and empty prompts', async () => {
    const s = await goodScript()
    const d = draftFor(s)
    expect(shotPlanProblems({ ...d, shots: d.shots.slice(0, 3) } as never, s, MAIN)[0]).toMatch(/exactly 7 shots/)
    expect(shotPlanProblems({ ...d, shots: d.shots.map((x, i) => (i === 1 ? { ...x, beat: 9 } : x)) } as never, s, MAIN).join(' ')).toMatch(/Shot 2 must cover beat 2, not beat 9/)
    expect(shotPlanProblems({ ...d, shots: d.shots.map((x, i) => (i === 2 ? { ...x, characters: ['Stranger'] } : x)) } as never, s, MAIN).join(' ')).toMatch(/"Stranger" is not in the cast/)
    expect(shotPlanProblems({ ...d, shots: d.shots.map((x, i) => (i === 1 ? { ...x, angle: 'Wide Establishing' } : x)) } as never, s, MAIN).join(' ')).toMatch(/Shots 1 and 2 use the same camera angle/)
    expect(shotPlanProblems({ ...d, shots: d.shots.map((x, i) => (i === 0 ? { ...x, keyframePrompt: ' ' } : x)) } as never, s, MAIN).join(' ')).toMatch(/Shot 1 needs both/)
    expect(shotPlanProblems({ ...d, unfilmable: [{ beat: 9, reason: 'x' }] } as never, s, MAIN).join(' ')).toMatch(/beat 9, which does not exist/)
  })
})

describe('planning the shots with the model', () => {
  it('turns a good answer into a shot list with angles, lengths that add up to the reel and a clip length for each shot', async () => {
    const s = await goodScript()
    const { llm, calls } = fake({ artDirector: () => draftFor(s) })
    const r = await planShots(ctxOf(llm), s, { mood: 'cosy', timeOfDay: 'dusk', weather: 'rain', accentColour: '#112233', note: 'lamps' })
    const shots = r.output.shots.shots
    expect(r.output.fallback).toBe(false)
    expect(shots.map((x) => x.angle)).toEqual(['wide establishing', 'close-up', 'low angle', 'over the shoulder', 'wide establishing', 'close-up', 'low angle'])
    expect(shots.reduce((n, x) => n + x.durationSec, 0)).toBeCloseTo(28, 5)
    expect(shots.every((x) => x.videoSeconds === 5)).toBe(true)
    expect(calls[0].model).toBe('gpt-5-mini')
    expect(calls[0].prompt.user).toContain('"shots":7')
    expect(calls[0].prompt.user).toContain('cosy') // this reel's style notes reach the model
    expect(calls[0].prompt.system).toContain('You are the Art Director')
  })

  it('asks once more with the problems named when the first answer is unusable, and uses the second', async () => {
    const s = await goodScript()
    const bad = draftFor(s); bad.shots[1].characters = ['Stranger']
    const { llm, calls, counts } = fake({ artDirector: (_c, n) => (n === 1 ? bad : draftFor(s)) })
    const r = await planShots(ctxOf(llm), s)
    expect(counts.artDirector).toBe(2)
    expect(calls[1].prompt.user).toContain('fixThese')
    expect(calls[1].prompt.user).toContain('Stranger')
    expect(r.output.fallback).toBe(false)
    expect(r.output.notes[0]).toMatch(/asked for again/)
    expect(r.usage!.inputTokens).toBe(2000) // both calls are paid for and counted
  })

  it('falls back to the standard shot list, with a note, when the model is wrong twice, so the episode keeps going', async () => {
    const s = await goodScript()
    const { llm, counts } = fake({ artDirector: () => ({ ...draftFor(s), shots: [] }) })
    const r = await planShots(ctxOf(llm), s)
    expect(counts.artDirector).toBe(2)
    expect(r.output.fallback).toBe(true)
    expect(r.output.shots.shots).toHaveLength(7)
    expect(r.output.notes[0]).toMatch(/standard shot list was used/)
  })

  it('stops asking when the budget says no, and uses the standard list', async () => {
    const s = await goodScript()
    const { llm, counts } = fake({ artDirector: () => draftFor(s) })
    const r = await planShots(ctxOf(llm, { canSpend: async () => false }), s)
    expect(counts.artDirector).toBeUndefined()
    expect(r.output.fallback).toBe(true)
  })

  it('scrubs brand names out of the prompts', async () => {
    const s = await goodScript()
    const d = draftFor(s); d.shots[0].keyframePrompt = 'A Pixar style kitchen'
    const r = await planShots(ctxOf(fake({ artDirector: () => d }).llm), s)
    expect(r.output.shots.shots[0].keyframePrompt).toBe('A style kitchen')
  })

  it('uses the standard shot list in mock mode without calling any model', async () => {
    const s = await goodScript()
    const r = await planShots({ ...ctxOf(async () => { throw new Error('no model') }), mode: 'mock' }, s)
    expect(r.output.shots.shots).toHaveLength(7)
    expect(r.output.unfilmable).toEqual([])
  })
})

describe('a beat that cannot be filmed', () => {
  it('goes back to the Writer once, before any image is made, and the shots are planned again from the rewritten script', async () => {
    const s = await goodScript()
    const rewritten: Script = { ...s, beats: s.beats.map((b, i) => (i === 2 ? { ...b, action: 'Mango sits on the fence and looks at the moon' } : b)) }
    const { llm, counts, calls } = fake({
      artDirector: (_c, n) => draftFor(n === 1 ? s : rewritten, n === 1 ? { unfilmable: [{ beat: 3, reason: 'a crowd of fifty cats cannot be one shot' }] } : {}),
    })
    const writer = vi.spyOn(agents, 'writer').mockImplementation(async () => ({ output: rewritten, summary: 'rewrote beat 3' }))
    const artist = vi.spyOn(agents, 'artDirector')
    const r = await directArt(ctxOf(llm), idea(1), s)
    expect(counts.artDirector).toBe(2)
    expect(writer).toHaveBeenCalledTimes(1)
    expect(writer.mock.calls[0][2][0]).toMatch(/Beat 3 cannot be filmed.*crowd of fifty/)
    expect(r.output.script.beats[2].action).toContain('moon')
    expect(calls[1].prompt.user).toContain('moon') // the second plan is made from the new script
    expect(artist).toHaveBeenCalledTimes(1) // keyframes are made once, after the plan is settled
    expect(r.summary).toMatch(/1 beat\(s\) rewritten once/)
  })

  it('keeps the vibe of the script and fits the expressions of a beat the Writer rewrote (the Writer does not write the vibe)', async () => {
    const s = await goodScript()
    expect(s.vibe).toBe('comedy')
    const { vibe: _vibe, ...noVibe } = s
    const rewritten = { ...noVibe, beats: s.beats.map((b, i) => (i === 2 ? { ...b, action: 'Mango sits on the fence', expression: 'scared' as const } : b)) } as Script
    const { llm } = fake({ artDirector: (_c, n) => draftFor(n === 1 ? s : rewritten, n === 1 ? { unfilmable: [{ beat: 3, reason: 'too big' }] } : {}) })
    vi.spyOn(agents, 'writer').mockImplementation(async () => ({ output: rewritten, summary: 'rewrote beat 3' }))
    const r = await directArt(ctxOf(llm), idea(1), s)
    expect(r.output.script.vibe).toBe('comedy')
    expect(r.output.script.beats[2].action).toContain('fence')
    expect(r.output.script.beats[2].expression).toBe('surprised') // the series only has the base four: scared becomes surprised
  })

  it('keeps the original script when the rewrite breaks a rule, and does not rewrite twice when the beat is still hard', async () => {
    const s = await goodScript()
    const hard = { unfilmable: [{ beat: 3, reason: 'too big' }] }
    const { llm, counts } = fake({ artDirector: () => draftFor(s, hard) })
    const broken = vi.spyOn(agents, 'writer').mockImplementation(async () => ({ output: { ...s, beats: s.beats.slice(0, 2) }, summary: 'bad' }))
    const r = await directArt(ctxOf(llm), idea(1), s)
    expect(r.output.script).toBe(s)
    expect(r.summary).toMatch(/original script was kept/)
    expect(counts.artDirector).toBe(1)
    broken.mockRestore()
    const ok = vi.spyOn(agents, 'writer').mockImplementation(async () => ({ output: s, summary: 'same' }))
    const r2 = await directArt(ctxOf(fake({ artDirector: () => draftFor(s, hard) }).llm), idea(1), s)
    expect(ok).toHaveBeenCalledTimes(1) // asked once only
    expect(r2.summary).toMatch(/still hard to film/)
  })

  it('does not call the Writer at all when everything can be filmed', async () => {
    const s = await goodScript()
    const writer = vi.spyOn(agents, 'writer')
    const r = await directArt(ctxOf(fake({ artDirector: () => draftFor(s) }).llm), idea(1), s)
    expect(writer).not.toHaveBeenCalled()
    expect(r.output.script).toBe(s)
    expect(r.output.shots.shots).toHaveLength(7)
  })
})
