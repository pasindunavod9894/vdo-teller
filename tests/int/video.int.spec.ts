import { describe, expect, it } from 'vitest'
import { clipSeconds, episodeVideoAllowance, lipsyncCostUsd, plannedVideoCostUsd, planShotClips, videoCostUsd } from '@/lib/video'
import { episodeCeilingUsd } from '@/pipeline/budget'

const PRO = 'kling-2.5-turbo' as const
const STD = 'kling-2.5-turbo-standard' as const

describe('video cost', () => {
  it('matches the verified fal.ai price of the pro model: $0.35 for 5 s, $0.70 for 10 s', () => {
    expect(videoCostUsd(PRO, 5)).toBe(0.35)
    expect(videoCostUsd(PRO, 10)).toBe(0.7)
  })
  it('prices the standard model from its fal.ai page: $0.21 for 5 s, $0.42 for 10 s', () => {
    expect(videoCostUsd(STD, 5)).toBe(0.21)
    expect(videoCostUsd(STD, 10)).toBe(0.42)
  })
  it('snaps odd lengths to a clip length the model really produces', () => {
    expect(clipSeconds(PRO, 3)).toBe(5)
    expect(clipSeconds(PRO, 5)).toBe(5)
    expect(clipSeconds(PRO, 6.2)).toBe(10)
    expect(clipSeconds(PRO, 30)).toBe(10) // longest available
    expect(videoCostUsd(PRO, 3)).toBe(0.35)
  })
  it('prices lip-sync per second of clip', () => {
    expect(lipsyncCostUsd('sync-lipsync-v2', 5)).toBe(0.25)
    expect(lipsyncCostUsd('sync-lipsync-v2', 10)).toBe(0.5)
  })
})

describe('every shot is a clip', () => {
  const shots = [{ n: 1, durationSec: 3 }, { n: 2, durationSec: 5 }, { n: 3, durationSec: 6.5 }, { n: 4, durationSec: 2 }]

  it('plans one clip per shot, 5 or 10 s long, with no engine shots and no tiers', () => {
    const plan = planShotClips(shots, PRO)
    expect(plan.map((p) => p.n)).toEqual([1, 2, 3, 4])
    expect(plan.map((p) => p.seconds)).toEqual([5, 5, 10, 5])
  })
  it('estimates the cost of a plan', () => {
    expect(plannedVideoCostUsd(planShotClips(shots, PRO), PRO)).toBe(1.75) // 5 + 5 + 10 + 5 = 25 s at USD 0.07
    expect(plannedVideoCostUsd(planShotClips(shots, STD), STD)).toBe(1.05)
    expect(plannedVideoCostUsd([], PRO)).toBe(0)
  })
})

describe('video allowance', () => {
  it('is what the money left under the cost cap can pay for (after a reserve for tokens, images and voice)', () => {
    expect(episodeVideoAllowance({ model: PRO, capUsd: 30, spentUsd: 0 })).toBe(425) // $29.85 / $0.07 = 426 s, whole clips only
    // $5 cap, $4.30 spent, $0.15 reserve => $0.55 left => 7 s => one 5 s clip
    expect(episodeVideoAllowance({ model: PRO, capUsd: 5, spentUsd: 4.3 })).toBe(5)
    expect(episodeVideoAllowance({ model: PRO, capUsd: 5, spentUsd: 4.9 })).toBe(0)
    expect(episodeVideoAllowance({ model: PRO, capUsd: 5, spentUsd: 99 })).toBe(0)
  })
  it('buys more seconds with the cheaper model', () => {
    expect(episodeVideoAllowance({ model: STD, capUsd: 5, spentUsd: 0 })).toBeGreaterThan(episodeVideoAllowance({ model: PRO, capUsd: 5, spentUsd: 0 }))
  })
})

describe('episode ceiling', () => {
  it('is about 5.2 dollars for a reel (25 to 30 s) with the default model, and grows with the length for any other length', () => {
    const c = (s: number) => episodeCeilingUsd(s, PRO, {})
    for (const s of [25, 28, 30]) { expect(c(s)).toBeGreaterThan(4.9); expect(c(s)).toBeLessThan(5.5) }
    expect(c(10)).toBeGreaterThan(2.8); expect(c(10)).toBeLessThan(3.4) // outside the window the shots are counted at 3.5 s each
    expect(c(15)).toBeGreaterThan(c(10)); expect(c(30)).toBeGreaterThan(c(15))
  })
  it('is cheaper with the standard model, and can be forced by EPISODE_COST_CAP_USD', () => {
    expect(episodeCeilingUsd(30, STD, {})).toBeLessThan(episodeCeilingUsd(30, PRO, {}))
    expect(episodeCeilingUsd(30, PRO, { EPISODE_COST_CAP_USD: '2.5' })).toBe(2.5)
    expect(episodeCeilingUsd(30, PRO, { EPISODE_COST_CAP_USD: 'nope' })).toBe(episodeCeilingUsd(30, PRO, {}))
  })
})
