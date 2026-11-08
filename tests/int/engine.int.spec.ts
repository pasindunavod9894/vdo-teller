import { describe, expect, it } from 'vitest'
import { mouthFrames, mouthTrackFromRms } from '@/engine/lipsync'
import { durationSec, frameAt, framesOf, shotStarts, TimelineSchema } from '@/engine/timeline'

describe('lip-sync mouth track', () => {
  it('is empty for no audio and stays closed for silence', () => {
    expect(mouthTrackFromRms([], 30)).toEqual([])
    const keys = mouthTrackFromRms(new Array(30).fill(0), 30)
    expect(keys.every((k) => k.shape === 0)).toBe(true)
  })
  it('opens wider for louder speech', () => {
    const quiet = mouthTrackFromRms([0, 0, 0, 0, 0.2, 0.2, 0.2, 0.2, 1, 1, 1, 1], 30)
    const shapes = quiet.map((k) => k.shape)
    expect(Math.max(...shapes)).toBe(3)
    expect(shapes[0]).toBe(0)
  })
  it('does not flicker: a shape is held for at least 2 frames', () => {
    const noisy = Array.from({ length: 60 }, (_, i) => (i % 2 ? 1 : 0))
    const keys = mouthTrackFromRms(noisy, 30)
    for (let i = 1; i < keys.length; i++) expect(keys[i].atSec - keys[i - 1].atSec).toBeGreaterThanOrEqual(2 / 30 - 1e-9)
  })
  it('uses the resting image outside the spoken line', () => {
    const track = mouthTrackFromRms([0, 1, 1, 0.3, 0], 30)
    const f = mouthFrames(track, { startSec: 1, endSec: 2, mouthSrc: ['m0', 'm1', 'm2', 'm3'], restSrc: 'rest' })
    expect(frameAt(f, 0.5)).toBe('rest')
    expect(frameAt(f, 1.1)).toMatch(/^m/)
    expect(frameAt(f, 2.5)).toBe('rest')
  })
})

describe('timeline', () => {
  const t = TimelineSchema.parse({ shots: [{ id: 'a', durationSec: 2, background: 'a.png' }, { id: 'b', durationSec: 3.5, background: 'b.png' }] })
  it('applies defaults', () => {
    expect(t.fps).toBe(30)
    expect(t.shots[0].camera.move).toBe('push-in')
    expect(t.look.grade).toBe('neutral')
  })
  it('computes duration and shot starts', () => {
    expect(durationSec(t)).toBe(5.5)
    expect(shotStarts(t)).toEqual([0, 2])
    expect(framesOf(2, 30)).toBe(60)
  })
  it('accepts a real-video shot and defaults its playback', () => {
    const v = TimelineSchema.parse({ shots: [{ id: 'a', durationSec: 5, background: 'still.png', video: { src: 'clip.mp4' } }] })
    expect(v.shots[0].video).toEqual({ src: 'clip.mp4', startFromSec: 0, playbackRate: 1 })
    expect(TimelineSchema.parse({ shots: [{ id: 'b', durationSec: 2, background: 'b.png' }] }).shots[0].video).toBeUndefined()
    expect(TimelineSchema.safeParse({ shots: [{ id: 'a', durationSec: 5, background: 's.png', video: { src: '' } }] }).success).toBe(false)
  })
  it('rejects a timeline with no shots or an empty asset name', () => {
    expect(TimelineSchema.safeParse({ shots: [] }).success).toBe(false)
    expect(TimelineSchema.safeParse({ shots: [{ id: 'a', durationSec: 2, background: '' }] }).success).toBe(false)
  })
})
