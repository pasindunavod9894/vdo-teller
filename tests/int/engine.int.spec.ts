import { describe, expect, it } from 'vitest'
import { durationSec, framesOf, shotStarts, TimelineSchema, TRANSITIONS } from '@/engine/timeline'

describe('timeline', () => {
  const t = TimelineSchema.parse({ shots: [{ id: 'a', clip: 'a.mp4', durationSec: 2 }, { id: 'b', clip: 'b.mp4', durationSec: 3.5 }] })

  it('applies defaults: a 720x1280 reel at 30 fps, cuts, no text, a plain look', () => {
    expect([t.fps, t.width, t.height]).toEqual([30, 720, 1280])
    expect(t.shots[0].transitionIn).toBe('cut')
    expect(t.shots[0].trimStartSec).toBe(0)
    expect(t.shots[0].text).toEqual([])
    expect(t.look.gradeFilter).toBe('')
    expect(t.look.caption.position).toBe('bottom')
    expect(t.look.caption.highlight).toBe('#FFE14D')
    expect(t.music).toBeNull()
  })

  it('computes duration and the moment each shot is fully on screen', () => {
    expect(durationSec(t)).toBe(5.5)
    expect(shotStarts(t)).toEqual([0, 2])
    expect(framesOf(2, 30)).toBe(60)
  })

  it('accepts every listed transition and rejects the old engine-only ones', () => {
    for (const x of TRANSITIONS) expect(TimelineSchema.safeParse({ shots: [{ id: 'a', clip: 'a.mp4', durationSec: 2, transitionIn: x }] }).success).toBe(true)
    expect(TimelineSchema.safeParse({ shots: [{ id: 'a', clip: 'a.mp4', durationSec: 2, transitionIn: 'whip' }] }).success).toBe(false)
  })

  it('validates caption colours, so a bad value never reaches the subtitle file', () => {
    const look = (caption: object) => TimelineSchema.safeParse({ shots: [{ id: 'a', clip: 'a.mp4', durationSec: 2 }], look: { caption } }).success
    expect(look({ primary: '#FFFFFF', highlight: '#00ff88' })).toBe(true)
    expect(look({ primary: 'white' })).toBe(false)
    expect(look({ highlight: '#12345' })).toBe(false)
  })

  it('rejects a timeline with no shots, an empty clip name or a too-short shot', () => {
    expect(TimelineSchema.safeParse({ shots: [] }).success).toBe(false)
    expect(TimelineSchema.safeParse({ shots: [{ id: 'a', durationSec: 2, clip: '' }] }).success).toBe(false)
    expect(TimelineSchema.safeParse({ shots: [{ id: 'a', durationSec: 0.1, clip: 'a.mp4' }] }).success).toBe(false)
    expect(TimelineSchema.safeParse({ shots: [{ id: 'a', durationSec: 2 }] }).success).toBe(false)
  })
})
