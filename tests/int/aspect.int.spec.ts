import { describe, expect, it } from 'vitest'
import { aspectSlug, columnFactor, isAspect, isWide, recompose, sizeFor } from '@/engine/aspect'
import { TimelineSchema } from '@/engine/timeline'

const char = (over: Record<string, unknown>) => ({ kind: 'character', id: 'c', frames: [{ atSec: 0, src: 'a.png' }], ...over })
const timeline = () => TimelineSchema.parse({
  width: 1080, height: 1920,
  shots: [
    { id: 's1', durationSec: 3, background: 'p.png', layers: [char({ x: 0.5, y: 1.005, width: 1.0 })] },
    { id: 's2', durationSec: 3, background: 'p.png', layers: [char({ x: 0.62, width: 0.85, path: { from: { x: -0.2, y: 0.98 }, to: { x: 0.5, y: 0.98 }, startSec: 0.1, endSec: 2 } }), { kind: 'text', text: 'Hi' }] },
    { id: 's3', durationSec: 3, background: 'p.png', layers: [char({ x: 0.3, width: 0.5, path: { from: { x: 0.3, y: 1 }, to: { x: 1.2, y: 1 }, startSec: 0, endSec: 2 } })] },
  ],
})

describe('aspect ratios', () => {
  it('sizes every aspect at both tiers with even numbers', () => {
    expect(sizeFor('9:16', 'standard')).toEqual({ width: 1080, height: 1920 })
    expect(sizeFor('16:9', 'standard')).toEqual({ width: 1920, height: 1080 })
    expect(sizeFor('1:1', 'standard')).toEqual({ width: 1080, height: 1080 })
    expect(sizeFor('4:5', 'standard')).toEqual({ width: 1080, height: 1350 })
    expect(sizeFor('16:9', 'budget')).toEqual({ width: 1280, height: 720 })
    expect(sizeFor('9:16', 'budget')).toEqual({ width: 720, height: 1280 })
    for (const a of ['9:16', '16:9', '1:1', '4:5'] as const) for (const t of ['budget', 'standard']) {
      const s = sizeFor(a, t); expect(s.width % 2).toBe(0); expect(s.height % 2).toBe(0)
    }
    expect(isAspect('16:9')).toBe(true); expect(isAspect('2:1')).toBe(false)
    expect(aspectSlug('16:9')).toBe('16x9')
  })

  it('keeps the column the same height: a character is as tall in 16:9 as in 9:16', () => {
    const k = columnFactor({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })
    expect(k).toBeCloseTo(0.3164, 3)
    expect(columnFactor({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })).toBe(1)
    expect(columnFactor({ width: 1080, height: 1920 }, { width: 1080, height: 1350 })).toBeCloseTo(0.703, 3)
  })

  it('shrinks character width to the column and keeps it centred', () => {
    const t = recompose(timeline(), { width: 1920, height: 1080 })
    expect(t.width).toBe(1920); expect(t.height).toBe(1080)
    const c = t.shots[0].layers[0] as { width: number; x: number; y: number }
    expect(c.width).toBeCloseTo(0.3164, 3) // pixel width = 0.3164 * 1920 = 607 = the old column
    expect(c.x).toBeCloseTo(0.5, 5)
    expect(c.y).toBe(1.005)
  })

  it('moves in-frame positions with the column and keeps off-screen starts and ends off-screen', () => {
    const t = recompose(timeline(), { width: 1920, height: 1080 })
    const walk = t.shots[1].layers[0] as { x: number; width: number; path: { from: { x: number }; to: { x: number } } }
    expect(walk.path.from.x).toBeLessThan(-walk.width / 2) // still enters from beyond the left edge
    expect(walk.path.to.x).toBeCloseTo(0.5, 5)
    expect(walk.x).toBeCloseTo(0.5 + 0.12 * 0.3164, 4)
    const out = t.shots[2].layers[0] as { path: { from: { x: number }; to: { x: number } }; width: number }
    expect(out.path.to.x).toBeGreaterThan(1 + out.width / 2) // walks off past the right edge
    expect(out.path.from.x).toBeGreaterThan(0.4); expect(out.path.from.x).toBeLessThan(0.5)
  })

  it('leaves text, timing, audio and non-character layers alone, and does not mutate the original', () => {
    const src = timeline()
    const before = JSON.stringify(src)
    const t = recompose(src, { width: 1080, height: 1080 })
    expect(JSON.stringify(src)).toBe(before)
    expect(t.shots[1].layers[1]).toEqual(src.shots[1].layers[1])
    expect(t.shots.map((s) => s.durationSec)).toEqual([3, 3, 3])
    expect(t.fps).toBe(src.fps)
  })

  it('returns the same timeline when the size already matches, and the result still parses', () => {
    const src = timeline()
    expect(recompose(src, { width: 1080, height: 1920 })).toBe(src)
    expect(() => TimelineSchema.parse(recompose(src, { width: 1080, height: 1350 }))).not.toThrow()
  })

  it('knows which frames are wider than the column', () => {
    expect(isWide(1080, 1920)).toBe(false)
    expect(isWide(1080, 1350)).toBe(true)
    expect(isWide(1920, 1080)).toBe(true)
  })
})
