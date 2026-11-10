import { describe, expect, it, vi } from 'vitest'
import { KEEP_LOOK, KEEP_LOOK_STRICT, NEGATIVE, produceVideoShots, videoConcurrency, type ShotJob } from '@/pipeline/video-shots'
import { BudgetError, ContinuityError, spentOf } from '@/pipeline/errors'
import { judgeContinuity, type CastRef, type ClipCheck } from '@/pipeline/continuity'
import { VideoError } from '@/providers/video/fal'
import type { ClipRequest, ClipResult, LipsyncRequest, LipsyncResult } from '@/providers/video'
import { videoBudgetFor } from '@/pipeline/video-budget'
import type { Series } from '@/payload-types'

const M = 'kling-2.5-turbo' as const
const mango: CastRef = { name: 'Mango', reference: '/tmp/mango.png', main: true }
const job = (n: number, over: Partial<ShotJob> = {}): ShotJob => ({ n, videoSeconds: 5, durationSec: 3, motionPrompt: `shot ${n} moves`, keyframe: `/tmp/kf-${n}.png`, speech: null, cast: [mango], ...over })
const okMake = (mock = false) => vi.fn(async (r: ClipRequest): Promise<ClipResult> => ({ file: r.destFile, seconds: r.seconds, costUsd: mock ? 0 : r.seconds * 0.07, model: M, remoteUrl: 'x', mock }))
const okLip = vi.fn(async (r: LipsyncRequest): Promise<LipsyncResult> => ({ file: r.destFile, costUsd: 0.25, model: 'sync-lipsync-v2' }))
const base = { model: M, workDir: '/tmp/clips', allowanceSec: 100 }

/** A continuity answer for one clip: the given score and drift for Mango. */
const check = (score: number, drift: number | null = null, extra: Partial<{ undeclared: string[] }> = {}) => vi.fn(async (_c: string, j: ShotJob, _a: number, clipSec: number): Promise<ClipCheck> => {
  const result = { characters: j.cast.map((c) => ({ name: c.name, sameIdentity: score, driftStartSec: drift, issues: score < 0.8 || drift !== null ? ['fur colour changes'] : [] })), undeclaredCharacters: extra.undeclared ?? [], costUsd: 0.004 }
  void clipSec
  return { result, costUsd: result.costUsd, verdict: judgeContinuity(result, j.cast, j.durationSec) }
})

describe('produceVideoShots', () => {
  it('makes a clip for every shot and sums the real cost and seconds', async () => {
    const make = okMake()
    const r = await produceVideoShots({ ...base, shots: [job(1), job(2, { videoSeconds: 10 })], make })
    expect(make).toHaveBeenCalledTimes(2)
    expect(r.clips.map((c) => c.status)).toEqual(['generated', 'generated'])
    expect(r.totalSeconds).toBe(15)
    expect(r.totalCostUsd).toBeCloseTo(1.05, 2)
    expect(Object.keys(r.files)).toEqual(['1', '2'])
  })

  it('tells the model to keep the characters the same, and never to add new ones', async () => {
    const make = okMake()
    await produceVideoShots({ ...base, shots: [job(1)], make, negative: 'photoreal skin' })
    const req = make.mock.calls[0][0]
    expect(req.prompt).toContain('shot 1 moves')
    expect(req.prompt).toContain(KEEP_LOOK)
    expect(req.negativePrompt).toContain(NEGATIVE)
    expect(req.negativePrompt).toContain('photoreal skin')
    expect(req.negativePrompt).toContain('extra characters')
    expect(req.tailImageFile).toBeUndefined() // the first try is free-running
  })

  it('lip-syncs only a shot that has a spoken line, and adds its cost', async () => {
    const lip = vi.fn(okLip)
    const r = await produceVideoShots({ ...base, shots: [job(1, { speech: { file: '/tmp/line.wav' } }), job(2)], make: okMake(), lipsync: lip })
    expect(lip).toHaveBeenCalledTimes(1)
    expect(lip.mock.calls[0][0].audioFile).toBe('/tmp/line.wav')
    expect(r.clips[0].lipsync).toEqual({ model: 'sync-lipsync-v2', costUsd: 0.25 })
    expect(r.clips[1].lipsync).toBeUndefined()
    expect(r.totalCostUsd).toBeCloseTo(0.35 * 2 + 0.25, 2)
  })

  it('counts mock clips as free and not as real video seconds', async () => {
    const r = await produceVideoShots({ ...base, shots: [job(1)], make: okMake(true) })
    expect(r.clips[0].status).toBe('mock')
    expect(r.totalCostUsd).toBe(0)
    expect(r.totalSeconds).toBe(0)
  })
})

/** A clip maker that stays "in flight" until released, so the test controls the order in which shots finish. */
function gatedMake(failShot?: number) {
  const gates = new Map<number, () => void>()
  let inFlight = 0, peak = 0
  const started: number[] = []
  const make = vi.fn(async (r: ClipRequest): Promise<ClipResult> => {
    const n = Number(/shot (\d+)/.exec(r.prompt)![1])
    started.push(n); inFlight++; peak = Math.max(peak, inFlight)
    if (n === failShot) { inFlight--; throw new VideoError('blocked by the safety check', 'policy') }
    await new Promise<void>((res) => gates.set(n, res))
    inFlight--
    return { file: r.destFile, seconds: r.seconds, costUsd: 0.35, model: M, remoteUrl: 'x' }
  })
  const release = (...ns: number[]) => ns.forEach((n) => gates.get(n)!())
  const tick = () => new Promise((r) => setTimeout(r, 5))
  return { make, release, tick, started, peak: () => peak }
}

describe('shots made at the same time', () => {
  it('starts every shot at once up to the limit, and keeps the order of the result whatever finishes first', async () => {
    const g = gatedMake()
    const run = produceVideoShots({ ...base, shots: [job(1), job(2), job(3), job(4)], make: g.make, concurrency: 4 })
    await g.tick()
    expect(g.started.sort()).toEqual([1, 2, 3, 4]) // all four requests are out before any answer
    g.release(4, 2, 3, 1)
    const r = await run
    expect(r.clips.map((c) => c.shot)).toEqual([1, 2, 3, 4])
    expect(r.totalCostUsd).toBeCloseTo(1.4, 2)
    expect(r.totalSeconds).toBe(20)
  })

  it('never has more shots in flight than the limit, and starts the next one as soon as a slot is free', async () => {
    const g = gatedMake()
    const run = produceVideoShots({ ...base, shots: [job(1), job(2), job(3), job(4), job(5)], make: g.make, concurrency: 2 })
    await g.tick()
    expect(g.started).toEqual([1, 2])
    g.release(2)
    await g.tick()
    expect(g.started).toEqual([1, 2, 3])
    g.release(1, 3); await g.tick(); g.release(4, 5)
    await run
    expect(g.peak()).toBe(2)
  })

  it('does not start new shots after one fails, lets the running ones finish, and reports the earliest failure with all the spend', async () => {
    const g = gatedMake(1)
    const run = produceVideoShots({ ...base, shots: [job(1), job(2), job(3), job(4)], make: g.make, concurrency: 2 }).catch((e) => e)
    await g.tick()
    g.release(2)
    const err = await run
    expect(err.message).toMatch(/Shot 1.*policy/)
    expect(g.started.sort()).toEqual([1, 2]) // shots 3 and 4 were never paid for
    expect(spentOf(err).usd).toBeCloseTo(0.35, 2) // shot 2 had already been started, so it is paid and counted
  })

  it('shares the video seconds between running shots instead of letting each one use them', async () => {
    const g = gatedMake()
    const run = produceVideoShots({ ...base, allowanceSec: 10, shots: [job(1), job(2), job(3)], make: g.make, concurrency: 3 }).catch((e) => e)
    await g.tick()
    g.release(1, 2)
    const err = await run
    expect(err).toBeInstanceOf(BudgetError)
    expect(g.started.sort()).toEqual([1, 2]) // 10 seconds pay for two 5-second clips, not three
  })

  it('gives each shot back its seconds when its clip could not be made', async () => {
    const g = gatedMake(1)
    const err = await produceVideoShots({ ...base, allowanceSec: 5, shots: [job(1), job(2)], make: g.make, concurrency: 1 }).catch((e) => e)
    expect(err.message).toMatch(/Shot 1/)
    expect(g.started).toEqual([1])
  })

  it('writes the approved-frames gallery one clip at a time', async () => {
    let open = 0, peak = 0
    const onApproved = vi.fn(async () => { open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 5)); open-- })
    await produceVideoShots({ ...base, shots: [job(1), job(2), job(3)], make: okMake(), check: check(0.95), onApproved, concurrency: 3 })
    expect(onApproved).toHaveBeenCalledTimes(3)
    expect(peak).toBe(1)
  })

  it('reads the limit from VIDEO_CONCURRENCY: 4 by default, never below 1 or above 8', () => {
    expect(videoConcurrency({})).toBe(4)
    expect(videoConcurrency({ VIDEO_CONCURRENCY: '2' })).toBe(2)
    expect(videoConcurrency({ VIDEO_CONCURRENCY: '1' })).toBe(1)
    expect(videoConcurrency({ VIDEO_CONCURRENCY: '0' })).toBe(4)
    expect(videoConcurrency({ VIDEO_CONCURRENCY: 'abc' })).toBe(4)
    expect(videoConcurrency({ VIDEO_CONCURRENCY: '50' })).toBe(8)
  })
})

describe('continuity retry', () => {
  it('keeps a clip that stays on-model and records its scores', async () => {
    const approved = vi.fn(async () => {})
    const r = await produceVideoShots({ ...base, shots: [job(1)], make: okMake(), check: check(0.95), onApproved: approved })
    expect(r.clips[0].continuity).toMatchObject({ ok: true, attempts: 1, scores: { Mango: 0.95 } })
    expect(approved).toHaveBeenCalledTimes(1)
    expect(r.checkCostUsd).toBeCloseTo(0.004, 4)
  })

  it('makes a drifting clip again, stricter, with the end frame pinned where the model allows it, and keeps the second one', async () => {
    const make = okMake()
    const chk = vi.fn()
      .mockImplementationOnce(check(0.5, 1.5))
      .mockImplementationOnce(check(0.92))
    const r = await produceVideoShots({ ...base, shots: [job(1)], make, check: chk })
    expect(make).toHaveBeenCalledTimes(2)
    expect(make.mock.calls[1][0].prompt).toContain(KEEP_LOOK_STRICT)
    expect(make.mock.calls[1][0].tailImageFile).toBe('/tmp/kf-1.png') // the Pro model supports an end frame
    expect(r.clips[0].continuity).toMatchObject({ ok: true, attempts: 2 })
    expect(r.totalCostUsd).toBeCloseTo(0.7, 2) // both attempts were paid for
  })

  it('does not send an end frame to a model that cannot use one', async () => {
    const make = okMake()
    const chk = vi.fn().mockImplementationOnce(check(0.5, 1)).mockImplementationOnce(check(0.9))
    await produceVideoShots({ ...base, model: 'kling-2.5-turbo-standard', shots: [job(1)], make, check: chk })
    expect(make.mock.calls[1][0].tailImageFile).toBeUndefined()
  })

  it('accepts a clip that only changes after the part the reel uses', async () => {
    const r = await produceVideoShots({ ...base, shots: [job(1, { durationSec: 3 })], make: okMake(), check: check(0.4, 3.5) })
    expect(r.clips[0].continuity?.ok).toBe(true)
    expect(r.clips[0].continuity?.attempts).toBe(1)
  })

  it('stops the episode when a character drifts twice, names the character and shot, and still reports what was spent', async () => {
    const make = okMake()
    const err = await produceVideoShots({ ...base, shots: [job(1), job(2)], make, check: check(0.4, 1), concurrency: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(ContinuityError)
    expect(err.message).toMatch(/Shot 1.*Mango/)
    expect(err.character).toBe('Mango')
    expect(make).toHaveBeenCalledTimes(2) // two attempts of shot 1, then it stops: shot 2 is never started
    expect(spentOf(err).usd).toBeCloseTo(0.7 + 0.008, 3)
  })

  it('fails the clip when an undeclared character appears, whatever the scores say', async () => {
    const err = await produceVideoShots({ ...base, shots: [job(1)], make: okMake(), check: check(0.99, null, { undeclared: ['a stray dog'] }) }).catch((e) => e)
    expect(err).toBeInstanceOf(ContinuityError)
    expect(err.message).toContain('a stray dog')
  })

  it('holds a supporting character to a lower bar than a main character', () => {
    const result = (score: number) => ({ characters: [{ name: 'Owl', sameIdentity: score, driftStartSec: null, issues: [] }], undeclaredCharacters: [], costUsd: 0 })
    expect(judgeContinuity(result(0.7), [{ name: 'Owl', reference: 'o', main: false }], 3).ok).toBe(true)
    expect(judgeContinuity(result(0.7), [{ name: 'Owl', reference: 'o', main: true }], 3).ok).toBe(false)
  })
})

describe('no cheaper fallback', () => {
  it('stops the episode when a clip cannot be made, naming the shot, with no engine fallback', async () => {
    const make = vi.fn(async (r: ClipRequest): Promise<ClipResult> => {
      if (r.prompt.includes('shot 2')) throw new VideoError('blocked by the safety check', 'policy')
      return { file: r.destFile, seconds: r.seconds, costUsd: 0.35, model: M, remoteUrl: 'x' }
    })
    const err = await produceVideoShots({ ...base, shots: [job(1), job(2), job(3)], make, concurrency: 1 }).catch((e) => e)
    expect(err.message).toMatch(/Shot 2.*policy/)
    expect(make).toHaveBeenCalledTimes(2)
    expect(spentOf(err).usd).toBe(0.35) // shot 1 was paid for
  })

  it('stops when the lip-sync fails', async () => {
    const err = await produceVideoShots({ ...base, shots: [job(1, { speech: { file: '/tmp/l.wav' } })], make: okMake(), lipsync: async () => { throw new VideoError('no face found', 'invalid') } }).catch((e) => e)
    expect(err.message).toMatch(/Shot 1.*lip-sync/)
  })

  it('stops with a budget error when the video seconds run out or the next paid call is refused', async () => {
    const make = okMake()
    await expect(produceVideoShots({ ...base, allowanceSec: 5, shots: [job(1), job(2)], make })).rejects.toBeInstanceOf(BudgetError)
    expect(make).toHaveBeenCalledTimes(1)
    const refused = vi.fn(async () => false)
    await expect(produceVideoShots({ ...base, shots: [job(1)], make: okMake(), canSpend: refused })).rejects.toBeInstanceOf(BudgetError)
  })
})

describe('video budget for a series (videoBudgetFor)', () => {
  const series = (over: Partial<Series>) => ({ costCapUsd: 30, spentUsd: 0, videoModel: 'kling-2.5-turbo', ...over }) as Series

  it('is what the money left under the cost cap can pay for', () => {
    expect(videoBudgetFor(series({})).allowanceSec).toBe(425)
    expect(videoBudgetFor(series({ costCapUsd: 5, spentUsd: 4.3 })).allowanceSec).toBe(5)
    expect(videoBudgetFor(series({ costCapUsd: 5, spentUsd: 4.95 })).allowanceSec).toBe(0)
  })
  it('honours a per-series video-second limit', () => {
    expect(videoBudgetFor(series({ videoBudgetSec: 12, videoSpentSec: 0 })).allowanceSec).toBe(10)
    expect(videoBudgetFor(series({ videoBudgetSec: 12, videoSpentSec: 12 })).allowanceSec).toBe(0)
  })
  it('uses the chosen model, falls back to the default for an unknown one, and uses the free mock provider without a key', () => {
    const k = process.env.FAL_KEY
    delete process.env.FAL_KEY
    expect(videoBudgetFor(series({ videoModel: 'kling-2.5-turbo-standard' })).model).toBe('kling-2.5-turbo-standard')
    const b = videoBudgetFor(series({ videoModel: 'something-else' as never }))
    expect(b.model).toBe('kling-2.5-turbo')
    expect(b.provider).toBe('mock')
    if (k) process.env.FAL_KEY = k
  })
})
