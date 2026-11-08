import { describe, expect, it } from 'vitest'
import { planChunks, shotFrameRanges, totalFrames } from '@/engine/chunks'
import { TimelineSchema } from '@/engine/timeline'

const tl = (durations: number[], fps = 30) =>
  TimelineSchema.parse({ fps, shots: durations.map((d, i) => ({ id: `s${i}`, durationSec: d, background: 'x.png' })) })

describe('planChunks', () => {
  it('puts a short episode in one chunk covering every frame', () => {
    const t = tl([5, 5])
    const c = planChunks(t, 300)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ fromFrame: 0, toFrame: totalFrames(t) - 1, shots: 2 })
  })

  it('splits only at shot boundaries, and the chunks are contiguous with no gap or overlap', () => {
    const t = tl([4, 3, 5, 2.5, 6, 3.5, 4])
    const ranges = shotFrameRanges(t)
    const starts = new Set(ranges.map((r) => r.from))
    const c = planChunks(t, 330) // 11 s
    expect(c.length).toBeGreaterThan(1)
    expect(c[0].fromFrame).toBe(0)
    expect(c.at(-1)!.toFrame).toBe(totalFrames(t) - 1)
    for (let i = 0; i < c.length; i++) {
      expect(starts.has(c[i].fromFrame)).toBe(true) // every chunk begins on a cut
      if (i > 0) expect(c[i].fromFrame).toBe(c[i - 1].toFrame + 1)
    }
    expect(c.reduce((n, x) => n + x.shots, 0)).toBe(7)
  })

  it('keeps chunks within the limit', () => {
    const t = tl([4, 3, 5, 2.5, 6, 3.5, 4])
    for (const max of [200, 330, 500]) {
      for (const ch of planChunks(t, max)) expect(ch.toFrame - ch.fromFrame + 1).toBeLessThanOrEqual(max)
    }
  })

  it('gives a single shot that is longer than the limit its own chunk', () => {
    const t = tl([2, 20, 2])
    const c = planChunks(t, 150) // 5 s
    expect(c.map((x) => x.shots)).toEqual([1, 1, 1])
    expect(c[1].toFrame - c[1].fromFrame + 1).toBe(600)
  })

  it('handles a one-shot episode and an episode of many equal shots', () => {
    expect(planChunks(tl([7]), 90)).toEqual([{ index: 0, fromFrame: 0, toFrame: 209, shots: 1 }])
    const many = planChunks(tl(Array(40).fill(3)), 900) // 40 x 3 s = 2 minutes, 30 s chunks
    expect(many).toHaveLength(4)
    expect(many.every((x) => x.shots === 10)).toBe(true)
  })

  it('scales to a 10-minute episode in a handful of chunks without losing a frame', () => {
    const t = tl(Array(200).fill(3)) // 200 shots x 3 s = 10 minutes
    const c = planChunks(t, 1800) // 60 s chunks
    expect(c).toHaveLength(10)
    expect(c.reduce((n, x) => n + (x.toFrame - x.fromFrame + 1), 0)).toBe(18000)
  })
})
