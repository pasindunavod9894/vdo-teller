import { describe, expect, it, vi } from 'vitest'
import { produceVideoShots } from '@/pipeline/video-shots'
import { VideoError } from '@/providers/video/fal'
import type { ClipRequest, ClipResult } from '@/providers/video'
import { videoBudgetFor } from '@/pipeline/video-budget'
import type { Series } from '@/payload-types'

const M = 'kling-2.5-turbo' as const
const shot = (n: number, sec = 5) => ({ n, videoSeconds: sec, motionPrompt: `shot ${n} moves` })
const okMake = (mock = false) => vi.fn(async (r: ClipRequest): Promise<ClipResult> => ({ file: r.destFile, seconds: r.seconds, costUsd: mock ? 0 : r.seconds * 0.07, model: M, remoteUrl: 'x', mock }))
const base = { model: M, workDir: '/tmp/clips', allowanceSec: 20 }

describe('produceVideoShots', () => {
  it('generates each clip, sums the real cost and seconds, and keeps none as fallback', async () => {
    const make = okMake()
    const r = await produceVideoShots({ ...base, shots: [shot(2), shot(5, 10)], stillFor: (n) => `/tmp/still-${n}.png`, make })
    expect(make).toHaveBeenCalledTimes(2)
    expect(r.clips.map((c) => c.status)).toEqual(['generated', 'generated'])
    expect(r.totalSeconds).toBe(15)
    expect(r.totalCostUsd).toBeCloseTo(1.05, 2)
    expect(r.fallbackShots).toEqual([])
  })

  it('marks a shot "needs-still" and falls back to the engine when there is no still yet, without calling the provider', async () => {
    const make = okMake()
    const r = await produceVideoShots({ ...base, shots: [shot(1), shot(2)], stillFor: (n) => (n === 2 ? '/tmp/s.png' : null), make })
    expect(make).toHaveBeenCalledTimes(1)
    expect(r.clips[0].status).toBe('needs-still')
    expect(r.fallbackShots).toEqual([1])
  })

  it('skips (never generates) a clip that does not fit in the remaining allowance', async () => {
    const make = okMake()
    const r = await produceVideoShots({ ...base, allowanceSec: 10, shots: [shot(1, 10), shot(2, 5)], stillFor: () => '/tmp/s.png', make })
    expect(r.clips.map((c) => c.status)).toEqual(['generated', 'skipped-budget'])
    expect(make).toHaveBeenCalledTimes(1)
    expect(r.fallbackShots).toEqual([2])
  })

  it('one failing clip does not fail the run: that shot falls back, and no cost is counted for it', async () => {
    const make = vi.fn(async (r: ClipRequest): Promise<ClipResult> => {
      if (r.prompt.includes('shot 1')) throw new VideoError('blocked by the safety check', 'policy')
      return { file: r.destFile, seconds: r.seconds, costUsd: 0.35, model: M, remoteUrl: 'x' }
    })
    const r = await produceVideoShots({ ...base, shots: [shot(1), shot(2)], stillFor: () => '/tmp/s.png', make })
    expect(r.clips[0]).toMatchObject({ status: 'failed', costUsd: 0 })
    expect(r.clips[0].error).toContain('policy')
    expect(r.clips[1].status).toBe('generated')
    expect(r.totalCostUsd).toBe(0.35)
    expect(r.fallbackShots).toEqual([1])
  })

  it('counts mock clips as free and not as real video seconds', async () => {
    const r = await produceVideoShots({ ...base, shots: [shot(1)], stillFor: () => '/tmp/s.png', make: okMake(true) })
    expect(r.clips[0].status).toBe('mock')
    expect(r.totalCostUsd).toBe(0)
    expect(r.totalSeconds).toBe(0)
  })

  it('rejects a shot with no motion prompt', async () => {
    const make = okMake()
    const r = await produceVideoShots({ ...base, shots: [{ n: 1, videoSeconds: 5, motionPrompt: null }], stillFor: () => '/tmp/s.png', make })
    expect(r.clips[0].status).toBe('failed')
    expect(make).not.toHaveBeenCalled()
  })
})

describe('video budget for a series (videoBudgetFor)', () => {
  const series = (over: Partial<Series>) => ({ qualityTier: 'standard', costCapUsd: 5, spentUsd: 0, videoModel: 'kling-2.5-turbo', ...over }) as Series

  it('uses the tier allowance when there is plenty of money', () => {
    expect(videoBudgetFor(series({ qualityTier: 'budget' }), 30).allowanceSec).toBe(10)
    expect(videoBudgetFor(series({ qualityTier: 'standard' }), 30).allowanceSec).toBe(15)
    expect(videoBudgetFor(series({ qualityTier: 'premium' }), 30).allowanceSec).toBe(25)
  })
  it('shrinks as the cost cap is used up, down to zero', () => {
    expect(videoBudgetFor(series({ qualityTier: 'premium', spentUsd: 4.3 }), 30).allowanceSec).toBe(5)
    expect(videoBudgetFor(series({ qualityTier: 'premium', spentUsd: 4.95 }), 30).allowanceSec).toBe(0)
  })
  it('honours a per-series video-second limit', () => {
    expect(videoBudgetFor(series({ qualityTier: 'premium', videoBudgetSec: 12, videoSpentSec: 0 }), 30).allowanceSec).toBe(10)
    expect(videoBudgetFor(series({ qualityTier: 'premium', videoBudgetSec: 12, videoSpentSec: 12 }), 30).allowanceSec).toBe(0)
  })
  it('falls back to the default model for an unknown model id, and to the free mock provider without a key', () => {
    const k = process.env.FAL_KEY
    delete process.env.FAL_KEY
    const b = videoBudgetFor(series({ videoModel: 'something-else' as never }), 30)
    expect(b.model).toBe('kling-2.5-turbo')
    expect(b.provider).toBe('mock')
    if (k) process.env.FAL_KEY = k
  })
})
