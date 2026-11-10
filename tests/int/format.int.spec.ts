import { describe, expect, it } from 'vitest'
import { estimateReelCostUsd, isReelLength, REEL, REEL_MAX_SEC, REEL_MIN_SEC, REEL_TARGET_SEC } from '@/lib/format'
import { lengthViolations, spokenWords } from '@/pipeline/length'
import { normalizeDurations } from '@/pipeline/art-director'
import { episodeCeilingUsd } from '@/pipeline/budget'
import { OptionsSchema } from '@/lib/research/schemas'
import { STEPS } from '@/components/wizard/steps'
import { useWizard } from '@/lib/wizard/store'

const beats = (n: number, words = 0) => ({ beats: Array.from({ length: n }, (_, i) => ({ n: i + 1, action: 'a', speaker: i === 0 && words ? 'Mango' : null, line: i === 0 && words ? Array.from({ length: words }, () => 'w').join(' ') : null, emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null })) })

describe('the reel: a short story of 25 to 30 seconds', () => {
  it('has one length, planned at 28 s, inside a 25 to 30 s window', () => {
    expect([REEL_MIN_SEC, REEL_TARGET_SEC, REEL_MAX_SEC]).toEqual([25, 28, 30])
    expect(REEL.label).toBe('25–30 seconds')
    expect(isReelLength(25)).toBe(true); expect(isReelLength(28)).toBe(true); expect(isReelLength(30)).toBe(true)
    expect(isReelLength(24.9)).toBe(false); expect(isReelLength(30.1)).toBe(false); expect(isReelLength(NaN)).toBe(false)
  })

  it('has 7 shots of about 4 s cut from 5 s clips, 6 to 7 beats, and few enough words for every line to fit its shot', () => {
    expect(REEL.shots).toBe(7)
    expect(REEL.beats).toEqual([6, 7])
    expect(REEL.shotSec * REEL.shots).toBeCloseTo(REEL_TARGET_SEC, 5)
    expect(REEL.shotSec).toBeGreaterThan(3.5); expect(REEL.shotSec).toBeLessThan(5)
    expect(REEL.maxSpokenWords).toBeLessThanOrEqual(Math.floor(REEL_TARGET_SEC * 2.5 * 0.7))
    expect(REEL.beats[1]).toBeLessThanOrEqual(REEL.shots)
    // the reel is the shots end to end, so even six of them reach the window
    expect(REEL.beats[0] * 5).toBeGreaterThanOrEqual(REEL_MIN_SEC)
    expect(REEL.structure).toMatch(/short story/)
  })
})

describe('cost of one video', () => {
  it('is about 4 dollars with the default model, and lower with the cheaper one', () => {
    const c = estimateReelCostUsd()
    expect(c).toBeGreaterThan(3); expect(c).toBeLessThan(5)
    expect(estimateReelCostUsd('kling-2.5-turbo-standard')).toBeLessThan(c)
  })

  it('has an episode ceiling for the reel of about 5 dollars, whatever length inside the window it is asked for', () => {
    const ceiling = episodeCeilingUsd(REEL_TARGET_SEC, 'kling-2.5-turbo', {})
    expect(ceiling).toBeGreaterThan(estimateReelCostUsd()); expect(ceiling).toBeLessThan(6)
    expect(episodeCeilingUsd(25, 'kling-2.5-turbo', {})).toBe(ceiling)
    expect(episodeCeilingUsd(30, 'kling-2.5-turbo', {})).toBe(ceiling)
  })
})

describe('length rule for a script', () => {
  it('passes a script with six or seven beats and few enough words', () => {
    expect(lengthViolations(beats(6, 46))).toEqual([])
    expect(lengthViolations(beats(7))).toEqual([])
  })
  it('names too many or too few beats', () => {
    expect(lengthViolations(beats(5))[0]).toMatch(/has 5 beats; a 25–30 seconds reel needs 6 to 7/)
    expect(lengthViolations(beats(4))[0]).toMatch(/has 4 beats/)
    expect(lengthViolations(beats(8))[0]).toMatch(/needs 6 to 7/)
  })
  it('names too many spoken words, counting narrator and characters together', () => {
    expect(spokenWords(beats(6, 17))).toBe(17)
    expect(lengthViolations(beats(7, 47))).toEqual(['The spoken lines have 47 words in total; a 25–30 seconds reel can carry at most 46. Shorten the lines.'])
  })
  it('reports both problems at once', () => {
    expect(lengthViolations(beats(4, 60))).toHaveLength(2)
  })
})

describe('shot lengths that add up to the reel', () => {
  const sum = (a: number[]) => Math.round(a.reduce((n, x) => n + x, 0) * 100) / 100
  it('scales the model\'s lengths to the target and keeps their proportions', () => {
    const d = normalizeDurations([3, 4, 5, 3, 4, 4, 3], REEL_TARGET_SEC)
    expect(sum(d)).toBe(REEL_TARGET_SEC)
    expect(d[2]).toBeGreaterThan(d[0]) // the longer shot stays the longer one
  })
  it('never makes a shot longer than one 5 s clip, giving what is left to the others', () => {
    const d = normalizeDurations([6, 2, 2, 2, 2, 2], REEL_TARGET_SEC) // six shots have to average 4.67 s
    expect(Math.max(...d)).toBeLessThanOrEqual(5)
    expect(sum(d)).toBe(REEL_TARGET_SEC)
    const e = normalizeDurations([5, 5, 5, 1.5, 1.5, 1.5, 1.5], REEL_TARGET_SEC)
    expect(Math.max(...e)).toBeLessThanOrEqual(5)
    expect(sum(e)).toBe(REEL_TARGET_SEC)
  })
  it('gets as close as it can when the shots cannot reach the target (five shots top out at 25 s)', () => {
    const d = normalizeDurations([4, 4, 4, 4, 4], REEL_TARGET_SEC)
    expect(d).toEqual([5, 5, 5, 5, 5])
  })
  it('treats a missing or odd length as an equal share', () => {
    const d = normalizeDurations([NaN, 4, 4, 4, 4, 4, 4], REEL_TARGET_SEC)
    expect(sum(d)).toBe(REEL_TARGET_SEC)
    expect(d.every((x) => x >= 1.5 && x <= 5)).toBe(true)
  })
})

describe('the wizard', () => {
  it('has four steps: there is no Format step and the store keeps no format', () => {
    expect(STEPS.map((s) => s.slug)).toEqual(['sub-niche', 'style', 'characters', 'voice'])
    expect('format' in useWizard.getState()).toBe(false)
  })
})

describe('wizard options', () => {
  it('no longer asks the research for a length', () => {
    const ok = OptionsSchema.safeParse({ styles: [], voices: [], characters: [] })
    expect(ok.success).toBe(true)
    expect(ok.success && 'recommendedFormat' in ok.data).toBe(false)
  })
})
