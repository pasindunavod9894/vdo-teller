import { describe, expect, it } from 'vitest'
import { clipSeconds, episodeVideoAllowance, plannedVideoCostUsd, planVideoShots, tierVideoSeconds, videoCostUsd } from '@/lib/video'

const M = 'kling-2.5-turbo' as const

describe('video cost', () => {
  it('matches the verified fal.ai price: $0.35 for 5 s, $0.70 for 10 s', () => {
    expect(videoCostUsd(M, 5)).toBe(0.35)
    expect(videoCostUsd(M, 10)).toBe(0.7)
  })
  it('snaps odd lengths to a clip length the model really produces', () => {
    expect(clipSeconds(M, 3)).toBe(5)
    expect(clipSeconds(M, 5)).toBe(5)
    expect(clipSeconds(M, 6.2)).toBe(10)
    expect(clipSeconds(M, 30)).toBe(10) // longest available
    expect(videoCostUsd(M, 3)).toBe(0.35)
  })
})

describe('tier video allowance (hybrid)', () => {
  it('Budget is 1-2 short clips, Standard ~45%, Premium mostly video, for a 30 s reel', () => {
    expect(tierVideoSeconds('budget', 30)).toBe(10)
    expect(tierVideoSeconds('standard', 30)).toBe(15)
    expect(tierVideoSeconds('premium', 30)).toBe(25)
  })
  it('Budget never exceeds two clips even for long videos', () => {
    expect(tierVideoSeconds('budget', 600)).toBe(10)
  })
  it('always allows at least one clip of the tier', () => {
    expect(tierVideoSeconds('standard', 5)).toBe(5)
  })
  it('is limited by the money left under the cost cap', () => {
    const base = { tier: 'premium' as const, episodeSec: 30, model: M, capUsd: 5 }
    expect(episodeVideoAllowance({ ...base, spentUsd: 0 })).toBe(25)
    // $5 cap, $4.30 spent, $0.15 reserve => $0.55 left => 7 s => one 5 s clip
    expect(episodeVideoAllowance({ ...base, spentUsd: 4.3 })).toBe(5)
    expect(episodeVideoAllowance({ ...base, spentUsd: 4.9 })).toBe(0)
    expect(episodeVideoAllowance({ ...base, spentUsd: 99 })).toBe(0)
  })
})

describe('which shots get real video', () => {
  const shots = [
    { n: 1, type: 'establishing' as const, durationSec: 3 },
    { n: 2, type: 'dialogue' as const, durationSec: 5 },
    { n: 3, type: 'action' as const, durationSec: 2.5 },
    { n: 4, type: 'reaction' as const, durationSec: 2 },
    { n: 5, type: 'info' as const, durationSec: 4 },
    { n: 6, type: 'action' as const, durationSec: 4 },
  ]
  const render = (plan: ReturnType<typeof planVideoShots>) => plan.filter((p) => p.render === 'video').map((p) => p.n).sort()

  it('prefers action shots first, longest first', () => {
    expect(render(planVideoShots(shots, 5, M))).toEqual([6])
    expect(render(planVideoShots(shots, 10, M))).toEqual([3, 6])
  })
  it('then fills with establishing and reaction shots as the allowance grows', () => {
    expect(render(planVideoShots(shots, 20, M))).toEqual([1, 3, 4, 6])
  })
  it('never sends dialogue or info shots to the video model, however large the allowance', () => {
    const r = planVideoShots(shots, 100, M)
    expect(r.find((p) => p.n === 2)?.render).toBe('engine')
    expect(r.find((p) => p.n === 5)?.render).toBe('engine')
  })
  it('never exceeds the allowance, and does nothing with an allowance of zero', () => {
    for (const a of [0, 5, 10, 15, 20, 25]) {
      const plan = planVideoShots(shots, a, M)
      expect(plan.reduce((s, p) => s + p.seconds, 0)).toBeLessThanOrEqual(a)
    }
    expect(render(planVideoShots(shots, 0, M))).toEqual([])
  })
  it('estimates the cost of a plan', () => {
    expect(plannedVideoCostUsd(planVideoShots(shots, 10, M), M)).toBe(0.7)
    expect(plannedVideoCostUsd(planVideoShots(shots, 0, M), M)).toBe(0)
  })
})
