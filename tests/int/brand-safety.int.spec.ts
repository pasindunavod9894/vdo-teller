import { describe, expect, it } from 'vitest'
import { cleanHashtags, hasBrand, scrubDeep, scrubText } from '@/pipeline/brand-safety'
import { normalizeCritique } from '@/pipeline/agents'
import { buildPrompt } from '@/agents/prompt-builder'
import type { SeriesProfile } from '@/agents/profile'

describe('brand safety', () => {
  it('detects and removes studio and franchise names', () => {
    expect(hasBrand('a Pixar style cat')).toBe(true)
    expect(hasBrand('a hand-drawn cat')).toBe(false)
    expect(scrubText('A Disney cat in a PIXAR kitchen')).toBe('A cat in a kitchen')
  })

  it('replaces branded hashtags and always returns exactly 3 neutral tags', () => {
    expect(cleanHashtags(['#CatComedy', '#BubbleDrama', '#PixarPets'])).toEqual(['#CatComedy', '#BubbleDrama', '#AnimatedStories'])
    expect(cleanHashtags(['#Disney'])).toEqual(['#AnimatedStories', '#Shorts', '#Cartoon'])
    expect(cleanHashtags(['a', 'b', '#x', '#y', '#z', '#w'])).toEqual(['#x', '#y', '#z'])
  })

  it('scrubs every string inside nested data', () => {
    expect(scrubDeep({ t: 'Disney tale', beats: [{ line: 'like Pixar', n: 2 }] })).toEqual({ t: 'tale', beats: [{ line: 'like', n: 2 }] })
  })
})

describe('critic approval is decided in code, from the rubric', () => {
  const good = { hook: 4, silentClarity: 4, emotionalArc: 4, payoff: 4, castTruth: 4, feasibility: 4, originality: 4, loop: 4 }
  const base = { rubric: good, failingBeats: [] as number[], notes: [] as string[], originalityRisk: false, policyRisk: false }
  it('approves when the hook and the feasibility are at least 4 and nothing is below 3', () => {
    expect(normalizeCritique(base)).toMatchObject({ approved: true, score: 8, notes: [] })
    expect(normalizeCritique({ ...base, rubric: { ...good, loop: 3, originality: 3 } }).approved).toBe(true)
  })
  it('rejects a weak hook or weak shots even when everything else is great', () => {
    expect(normalizeCritique({ ...base, rubric: { ...good, hook: 3, payoff: 5, loop: 5 } }).approved).toBe(false)
    expect(normalizeCritique({ ...base, rubric: { ...good, feasibility: 3 } }).approved).toBe(false)
  })
  it('rejects any single item below 3', () => {
    expect(normalizeCritique({ ...base, rubric: { ...good, castTruth: 2 } }).approved).toBe(false)
  })
  it('never approves a flagged script', () => {
    expect(normalizeCritique({ ...base, rubric: { ...good, hook: 5 }, policyRisk: true }).approved).toBe(false)
    expect(normalizeCritique({ ...base, originalityRisk: true }).approved).toBe(false)
  })
  it('clamps odd values and derives a 1 to 10 score from the average', () => {
    const wild = normalizeCritique({ ...base, rubric: { ...good, hook: 99, payoff: -3 } })
    expect(wild.rubric!.hook).toBe(5); expect(wild.rubric!.payoff).toBe(1)
    expect(wild.score).toBeGreaterThanOrEqual(1); expect(wild.score).toBeLessThanOrEqual(10)
    expect(normalizeCritique({ ...base, rubric: { hook: 5, silentClarity: 5, emotionalArc: 5, payoff: 5, castTruth: 5, feasibility: 5, originality: 5, loop: 5 } }).score).toBe(10)
  })
  it('a rejected script always says what to fix, even if the model forgot to', () => {
    const r = normalizeCritique({ ...base, rubric: { ...good, hook: 2, feasibility: 3 } })
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toMatch(/the hook.*filmable shots/)
  })
  it('keeps the failing beats, sorted and without repeats', () => {
    expect(normalizeCritique({ ...base, rubric: { ...good, hook: 2 }, failingBeats: [3, 1, 3], notes: ['Beat 1: x'] }).failingBeats).toEqual([1, 3])
  })
})

describe('prompts never carry brand-like style ids', () => {
  const profile: SeriesProfile = {
    niche: 'Cat videos', style: { id: 'pixar-3d' }, durationTargetSec: 28, aspect: '9:16', voiceMode: 'none',
    cast: [],
  }
  it('describes the look instead of the id', () => {
    const p = buildPrompt('publisher', profile, 'x', 1)
    expect(p.system.toLowerCase()).not.toContain('pixar')
    expect(p.system).toContain('soft 3D animated-film render')
  })
})
