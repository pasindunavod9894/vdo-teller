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

describe('critic approval is decided in code, not by the model', () => {
  const base = { notes: [], originalityRisk: false, policyRisk: false }
  it('rejects a low score even when the model says approved (the real bug: "score 6, approved")', () => {
    expect(normalizeCritique({ ...base, score: 6, approved: true }).approved).toBe(false)
  })
  it('approves from 8 up', () => {
    expect(normalizeCritique({ ...base, score: 8, approved: false }).approved).toBe(true)
  })
  it('never approves a flagged script, and clamps odd scores', () => {
    expect(normalizeCritique({ ...base, score: 10, approved: true, policyRisk: true }).approved).toBe(false)
    expect(normalizeCritique({ ...base, score: 99, approved: true }).score).toBe(10)
    expect(normalizeCritique({ ...base, score: -3, approved: false }).score).toBe(1)
  })
})

describe('prompts never carry brand-like style ids', () => {
  const profile: SeriesProfile = {
    niche: 'Cat videos', style: { id: 'pixar-3d' }, format: 'story-reel', durationTargetSec: 45, aspect: '9:16', voiceMode: 'none',
    cast: [], qualityTier: 'standard',
  }
  it('describes the look instead of the id', () => {
    const p = buildPrompt('publisher', profile, 'x', 1)
    expect(p.system.toLowerCase()).not.toContain('pixar')
    expect(p.system).toContain('soft 3D animated-film render')
  })
})
