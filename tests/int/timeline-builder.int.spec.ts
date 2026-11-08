import { describe, expect, it } from 'vitest'
import { blinkTimes, buildTimeline, emotionBust, type BuildInput, type SpeechInfo } from '@/pipeline/timeline-builder'
import type { CharacterKit } from '@/media/kit'
import { TimelineSchema } from '@/engine/timeline'

const kit = (n: string): CharacterKit => ({
  name: n, stand: `${n}-stand.png`, walk: [`${n}-wa.png`, `${n}-wb.png`], crouch: `${n}-crouch.png`, air: `${n}-air.png`,
  face: [`${n}-f0.png`, `${n}-f1.png`, `${n}-f2.png`, `${n}-f3.png`], blink: `${n}-blink.png`,
  emotions: { happy: `${n}-happy.png`, surprised: `${n}-surprised.png`, smug: `${n}-smug.png` },
})
const speech = (seconds: number): SpeechInfo => ({
  file: `line-${seconds}.wav`, seconds,
  words: [{ text: 'hello', startSec: 0, endSec: seconds / 2 }, { text: 'there', startSec: seconds / 2, endSec: seconds }],
  mouthKeys: [{ atSec: 0.1, shape: 2 }, { atSec: 0.4, shape: 0 }],
  energy: Array.from({ length: Math.ceil(seconds * 30) }, (_, i) => (i % 6) / 6),
})
const beat = (n: number, speaker: string | null, line: string | null, extra: Record<string, unknown> = {}) =>
  ({ n, action: 'they talk', speaker, line, emotion: null, delivery: null, onScreenText: null, ...extra })
const shot = (n: number, type: string, over: Record<string, unknown> = {}) =>
  ({ n, type, description: 'a kitchen scene', durationSec: 3, characters: ['Mango'], beat: n, render: 'engine', videoSeconds: 0, motionPrompt: null, ...over })

function base(over: Partial<BuildInput> = {}): BuildInput {
  return {
    script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, 'Mango', 'hello there'), beat(2, 'Biscuit', 'hello there', { emotion: 'scared' }), beat(3, null, null)] },
    shots: [shot(1, 'dialogue'), shot(2, 'dialogue', { characters: ['Biscuit'] }), shot(3, 'action', { description: 'Mango jumps up', characters: ['Mango'] })] as BuildInput['shots'],
    kits: { Mango: kit('Mango'), Biscuit: kit('Biscuit') },
    speech: { 1: speech(2), 2: speech(2.5) },
    plates: { 1: 'plate-a.png', 2: 'plate-b.png' }, fallbackPlate: 'plate-fallback.png',
    clips: {}, stills: {},
    sfx: { whoosh: 'whoosh.wav', hiss: 'hiss.wav', thud: 'thud.wav' },
    ...over,
  }
}

describe('timeline builder', () => {
  it('produces a timeline the engine schema accepts', () => {
    const r = buildTimeline(base())
    expect(() => TimelineSchema.parse(r.timeline)).not.toThrow()
    expect(r.timeline.shots).toHaveLength(3)
  })

  it('never lets two voices overlap and puts each voice inside its shot', () => {
    const r = buildTimeline(base())
    const v = r.timeline.voices!
    expect(v).toHaveLength(2)
    expect(v[1].startSec).toBeGreaterThanOrEqual(v[0].startSec + 2)
    r.timeline.shots.forEach((s, i) => expect(s.durationSec).toBeGreaterThan(0.5))
    // the first voice begins after its shot starts, the second after the first has finished
    expect(v[0].startSec).toBeGreaterThan(r.shotStarts[0])
    expect(v[1].startSec).toBeGreaterThanOrEqual(r.shotStarts[1])
  })

  it('stretches a talking shot to hold the speaker until the line ends', () => {
    const r = buildTimeline(base({ shots: [shot(1, 'dialogue', { durationSec: 1.5 })] as BuildInput['shots'], script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, 'Mango', 'hello there')] }, speech: { 1: speech(3) } }))
    expect(r.timeline.shots[0].durationSec).toBeGreaterThanOrEqual(0.3 + 3)
  })

  it('gives a speaking character the steady face with talk, blinks and mouth frames', () => {
    const c = buildTimeline(base()).timeline.shots[0].layers.find((l) => l.kind === 'character') as Record<string, any>
    expect(c.talk).toBeTruthy()
    expect(c.blinks.src).toBe('Mango-blink.png')
    expect(c.frames.length).toBeGreaterThan(1)
    expect(c.frames.every((f: { src: string }) => f.src.startsWith('Mango-f'))).toBe(true)
  })

  it('uses the speaker\'s own face even when the shot is framed on someone else', () => {
    const r = buildTimeline(base({ shots: [shot(1, 'dialogue', { characters: ['Mango'] })] as BuildInput['shots'], script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, 'Biscuit', 'hello there')] }, speech: { 1: speech(2) } }))
    const c = r.timeline.shots[0].layers.find((l) => l.kind === 'character') as Record<string, any>
    expect(c.frames[0].src.startsWith('Biscuit-f')).toBe(true)
  })

  it('adds captions with word timings for each spoken line', () => {
    const r = buildTimeline(base())
    expect(r.timeline.captions).toHaveLength(2)
    expect(r.timeline.captions[0].words!.map((w) => w.text)).toEqual(['hello', 'there'])
    expect(r.timeline.captions[0].words![0].startSec).toBeGreaterThanOrEqual(r.timeline.voices![0].startSec)
  })

  it('narrator lines get a voice and captions but no talking face', () => {
    const r = buildTimeline(base({
      script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, 'narrator', 'hello there')] },
      shots: [shot(1, 'establishing')] as BuildInput['shots'], speech: { 1: speech(2) },
    }))
    expect(r.timeline.voices).toHaveLength(1)
    const c = r.timeline.shots[0].layers.find((l) => l.kind === 'character') as Record<string, any> | undefined
    expect(c?.talk).toBeUndefined()
  })

  it('a no-voice episode has no voices or captions but still shows on-screen text', () => {
    const r = buildTimeline(base({
      script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, null, null, { onScreenText: 'Uh oh' })] },
      shots: [shot(1, 'reaction')] as BuildInput['shots'], speech: {},
    }))
    expect(r.timeline.voices).toHaveLength(0)
    expect(r.timeline.captions).toHaveLength(0)
    expect(r.timeline.shots[0].layers.some((l) => l.kind === 'text')).toBe(true)
  })

  it('plays a generated clip at its own length and uses the still as the poster', () => {
    const r = buildTimeline(base({
      shots: [shot(1, 'action', { render: 'video', videoSeconds: 5, description: 'Mango walks in' })] as BuildInput['shots'],
      script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, null, null)] }, speech: {},
      clips: { 1: { file: 'clip-1.mp4', seconds: 5 } }, stills: { 1: 'scene-1.png' },
    }))
    const s = r.timeline.shots[0]
    expect(s.durationSec).toBe(5)
    expect(s.video?.src).toBe('clip-1.mp4')
    expect(s.background).toBe('scene-1.png')
    expect(s.layers.filter((l) => l.kind === 'character')).toHaveLength(0)
  })

  it('falls back to an engine shot (and says so) when a video clip is missing', () => {
    const r = buildTimeline(base({ shots: [shot(1, 'action', { render: 'video', videoSeconds: 5 })] as BuildInput['shots'], script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, null, null)] }, speech: {} }))
    expect(r.timeline.shots[0].video).toBeUndefined()
    expect(r.notes.join(' ')).toMatch(/no clip/)
  })

  it('a hop shot uses crouch, air and a thud; a walk shot uses the walk cycle', () => {
    const hop = buildTimeline(base({ shots: [shot(1, 'action', { description: 'Mango jumps in fright' })] as BuildInput['shots'], script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, null, null)] }, speech: {} }))
    const hopLayer = hop.timeline.shots[0].layers.find((l) => l.kind === 'character') as Record<string, any>
    expect(hopLayer.frames.map((f: { src: string }) => f.src)).toEqual(expect.arrayContaining(['Mango-crouch.png', 'Mango-air.png']))
    expect(hop.timeline.sfx!.some((s) => s.src === 'thud.wav')).toBe(true)
    const walk = buildTimeline(base({ shots: [shot(1, 'action', { description: 'Mango walks into the kitchen' })] as BuildInput['shots'], script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, null, null)] }, speech: {} }))
    const walkLayer = walk.timeline.shots[0].layers.find((l) => l.kind === 'character') as Record<string, any>
    expect(walkLayer.cycle.frames).toEqual(['Mango-wa.png', 'Mango-wb.png'])
  })

  it('a reaction shot shows the emotion bust matching the line', () => {
    const r = buildTimeline(base({
      script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, null, null, { emotion: 'smug' })] },
      shots: [shot(1, 'reaction')] as BuildInput['shots'], speech: {},
    }))
    const c = r.timeline.shots[0].layers.find((l) => l.kind === 'character') as Record<string, any>
    expect(c.frames[0].src).toBe('Mango-smug.png')
  })

  it('uses the fallback plate when a shot has none, and reports a missing kit', () => {
    const r = buildTimeline(base({ kits: {}, plates: {}, shots: [shot(1, 'reaction')] as BuildInput['shots'], script: { title: 't', hook: 'h', payoff: 'p', beats: [beat(1, null, null)] }, speech: {} }))
    expect(r.timeline.shots[0].background).toBe('plate-fallback.png')
    expect(r.notes.join(' ')).toMatch(/no character kit/)
  })

  it('maps emotions and spreads blinks', () => {
    expect(emotionBust('Smug and proud')).toBe('smug')
    expect(emotionBust('terrified')).toBe('surprised')
    expect(emotionBust('joyful')).toBe('happy')
    expect(emotionBust('nervous')).toBe('surprised')
    expect(emotionBust(null)).toBe('happy')
    const t = blinkTimes(6, 1)
    expect(t.length).toBeGreaterThan(1)
    expect(blinkTimes(6, 1)).not.toEqual(blinkTimes(6, 2))
    expect(blinkTimes(0.5, 1)).toEqual([])
  })
})
