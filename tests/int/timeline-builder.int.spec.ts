import { describe, expect, it } from 'vitest'
import { buildTimeline, captionChunks, pickTransition, speechInfoFrom, voiceNeedSec, type BuildInput } from '@/pipeline/timeline-builder'
import { shotStarts, TimelineSchema } from '@/engine/timeline'
import type { Script, ShotList } from '@/pipeline/schemas'

const beat = (n: number, over: Partial<Script['beats'][number]> = {}): Script['beats'][number] => ({ n, action: `beat ${n}`, speaker: null, line: null, emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null, ...over })
const shot = (n: number, type: ShotList['shots'][number]['type'], over: Partial<ShotList['shots'][number]> = {}): ShotList['shots'][number] => ({
  n, type, description: `shot ${n}`, durationSec: 3, characters: ['Mango'], beat: n, videoSeconds: 5, keyframePrompt: 'k', motionPrompt: 'm', ...over,
})
const words = (text: string, sec: number) => text.split(' ').map((t, i, a) => ({ text: t, startSec: (i * sec) / a.length, endSec: ((i + 0.9) * sec) / a.length }))

function input(over: Partial<BuildInput> = {}): BuildInput {
  const script: Script = { title: 't', hook: 'h', payoff: 'p', supportingCast: [], beats: [beat(1), beat(2, { speaker: 'Mango', line: 'Trust me this will work', emotion: 'smug' }), beat(3, { onScreenText: 'Oops' }), beat(4, { speaker: 'Luna', line: 'It did not' })] }
  return {
    script, shots: [shot(1, 'establishing'), shot(2, 'dialogue'), shot(3, 'action'), shot(4, 'dialogue')],
    speech: { 2: speechInfoFrom('line2.wav', 2.1, words('Trust me this will work', 2.1)), 4: speechInfoFrom('line4.wav', 1.2, words('It did not', 1.2)) },
    clips: { 1: { file: 'clip-1.mp4', seconds: 5 }, 2: { file: 'clip-2.mp4', seconds: 5 }, 3: { file: 'clip-3.mp4', seconds: 5 }, 4: { file: 'clip-4.mp4', seconds: 5 } },
    sfx: { whoosh: 'sfx-whoosh.wav' }, music: { src: 'music.wav', volume: 0.2 }, transitions: ['fade', 'slideleft'],
    ...over,
  }
}

describe('timing', () => {
  it('starts every shot where the earlier shots end, and makes a timeline the assembler accepts', () => {
    const r = buildTimeline(input())
    expect(() => TimelineSchema.parse(r.timeline)).not.toThrow()
    const cumulative = r.timeline.shots.map((_, i) => r.timeline.shots.slice(0, i).reduce((n, x) => n + x.durationSec, 0))
    r.shotStarts.forEach((x, i) => expect(x).toBeCloseTo(cumulative[i], 1))
    expect(shotStarts(r.timeline).map((x) => Math.round(x * 10) / 10)).toEqual(cumulative.map((x) => Math.round(x * 10) / 10))
    expect(r.durationSec).toBeCloseTo(r.timeline.shots.reduce((n, s) => n + s.durationSec, 0), 1)
    expect(r.timeline.shots.map((s) => s.clip)).toEqual(['clip-1.mp4', 'clip-2.mp4', 'clip-3.mp4', 'clip-4.mp4'])
    expect(r.timeline.music).toEqual({ src: 'music.wav', volume: 0.2 })
  })

  it('places a voice a little after its shot starts and gives the shot room for the whole line', () => {
    const r = buildTimeline(input())
    const [, s2] = r.timeline.shots
    const start2 = r.shotStarts[1]
    const v = r.timeline.voices[0]
    expect(v.src).toBe('line2.wav')
    expect(v.startSec).toBeGreaterThanOrEqual(start2 + 0.29)
    expect(v.startSec + 2.1).toBeLessThanOrEqual(start2 + s2.durationSec + 0.01) // the line ends inside its shot
    expect(s2.durationSec).toBeGreaterThanOrEqual(voiceNeedSec(2.1) - 0.01)
  })

  it('never lets two lines overlap, even when the earlier line is long', () => {
    const r = buildTimeline(input({ speech: { 2: speechInfoFrom('a.wav', 6, words('a b c d e f g h', 6)), 4: speechInfoFrom('b.wav', 1.2, words('It did not', 1.2)) }, clips: { 1: { file: 'c1', seconds: 5 }, 2: { file: 'c2', seconds: 10 }, 3: { file: 'c3', seconds: 5 }, 4: { file: 'c4', seconds: 5 } } }))
    const [a, b] = r.timeline.voices
    expect(b.startSec).toBeGreaterThanOrEqual(a.startSec + 6)
  })

  it('puts a beat\'s line only in the first shot of that beat', () => {
    const shots = [shot(1, 'dialogue', { beat: 2 }), shot(2, 'reaction', { beat: 2 }), shot(3, 'action', { beat: 3 })]
    const r = buildTimeline(input({ shots, clips: { 1: { file: 'c1', seconds: 5 }, 2: { file: 'c2', seconds: 5 }, 3: { file: 'c3', seconds: 5 } }, speech: { 2: speechInfoFrom('line2.wav', 2, words('Trust me this will work', 2)) } }))
    expect(r.timeline.voices).toHaveLength(1)
  })

  it('says when a shot is longer than its clip (the last frame is held) and fails when a clip is missing', () => {
    const r = buildTimeline(input({ shots: [shot(1, 'subtle', { durationSec: 7 })], clips: { 1: { file: 'c1', seconds: 5 } } }))
    expect(r.notes.join(' ')).toMatch(/last frame is held/)
    expect(() => buildTimeline(input({ clips: {} }))).toThrow(/no video clip/)
  })
})

describe('captions and on-screen text', () => {
  it('turns a spoken line into captions with the real word timings, shifted to where the line starts', () => {
    const r = buildTimeline(input())
    const cap = r.timeline.captions[0]
    expect(cap.text).toBe('Trust me this will work')
    expect(cap.startSec).toBeCloseTo(r.timeline.voices[0].startSec, 2)
    expect(cap.words?.length).toBe(5)
    expect(cap.words![0].startSec).toBeGreaterThanOrEqual(r.timeline.voices[0].startSec)
  })

  it('splits a long line into captions of at most six words, each with its own window', () => {
    const text = 'one two three four five six seven eight nine ten'
    const c = captionChunks(text, words(text, 5), 10, 15)
    expect(c.map((x) => x.text.split(' ').length)).toEqual([6, 4])
    expect(c[0].endSec).toBeCloseTo(c[1].startSec, 5)
    expect(c[1].endSec).toBe(15)
    expect(captionChunks('a b c', [], 0, 3).map((x) => x.text)).toEqual(['a b c']) // no timings: spread evenly
  })

  it('shows a beat\'s on-screen text at the top of its shot', () => {
    const r = buildTimeline(input())
    expect(r.timeline.shots[2].text).toEqual([expect.objectContaining({ text: 'Oops', position: 'top' })])
    expect(r.timeline.shots[0].text).toEqual([])
  })
})

describe('transitions and sound', () => {
  it('cuts into the first shot and between two dialogue shots, and uses the style\'s energetic transition for action', () => {
    expect(pickTransition(0, 'dialogue', null, ['fade', 'slideleft'])).toBe('cut')
    expect(pickTransition(2, 'dialogue', 'dialogue', ['fade', 'slideleft'])).toBe('cut')
    expect(pickTransition(2, 'action', 'dialogue', ['fade', 'slideleft'])).toBe('slideleft')
    expect(pickTransition(1, 'establishing', 'action', [])).toBe('cut') // a style with none allowed
    expect(pickTransition(1, 'subtle', 'action', ['fade', 'slideleft'])).not.toBe('cut')
  })

  it('only uses transitions the style allows, and adds a whoosh where the picture slides', () => {
    const r = buildTimeline(input({ transitions: ['slideleft'] }))
    const used = new Set(r.timeline.shots.map((s) => s.transitionIn))
    for (const t of used) expect(['cut', 'slideleft']).toContain(t)
    const slides = r.timeline.shots.filter((s) => s.transitionIn === 'slideleft').length
    expect(r.timeline.sfx).toHaveLength(slides)
    for (const x of r.timeline.sfx) expect(x.src).toBe('sfx-whoosh.wav')
    // a whoosh lands just before the shot it introduces
    expect(r.timeline.sfx[0].startSec).toBeLessThan(r.shotStarts[r.timeline.shots.findIndex((s) => s.transitionIn === 'slideleft')])
  })

  it('passes the style\'s look to the assembler', () => {
    const look = { gradeFilter: 'eq=saturation=1.2', grain: 0.1, vignette: 0.2, caption: { font: 'Fredoka', size: 0.05, primary: '#FFFFFF', highlight: '#FF0000', outline: '#000000', bold: true, uppercase: true, position: 'bottom' as const } }
    const r = buildTimeline(input({ look }))
    expect(r.timeline.look.gradeFilter).toBe('eq=saturation=1.2')
    expect(r.timeline.look.caption.highlight).toBe('#FF0000')
  })
})

describe('fitting the format', () => {
  const plain = (n: number, dur: number) => {
    const script: Script = { title: 't', hook: 'h', payoff: 'p', supportingCast: [], beats: Array.from({ length: n }, (_, i) => beat(i + 1)) }
    return { script, shots: Array.from({ length: n }, (_, i) => shot(i + 1, 'subtle', { durationSec: dur })), speech: {}, clips: Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { file: `c${i + 1}.mp4`, seconds: 5 }])), sfx: { whoosh: 'w.wav' } } satisfies BuildInput
  }
  const total = (r: ReturnType<typeof buildTimeline>) => r.timeline.shots.reduce((n, s) => n + s.durationSec, 0)

  it('shortens the shots evenly when the reel runs over its format', () => {
    const r = buildTimeline({ ...plain(4, 5), targetSec: 15 })
    expect(total(r)).toBeCloseTo(15, 1)
    expect(r.durationSec).toBeCloseTo(total(r), 1)
    for (const s of r.timeline.shots) expect(s.durationSec).toBeCloseTo(3.75, 1)
  })

  it('leaves a reel alone when it is within half a second of the format, and when there is no format', () => {
    expect(total(buildTimeline({ ...plain(4, 5), targetSec: 19.8 }))).toBeCloseTo(20, 5)
    expect(total(buildTimeline(plain(4, 5)))).toBeCloseTo(20, 5)
  })

  it('never shortens a shot below the time its spoken line needs, and takes the rest from the other shots', () => {
    const b = plain(4, 5)
    b.script.beats[0] = beat(1, { speaker: 'Mango', line: 'Trust me this will work I promise' })
    b.speech = { 1: speechInfoFrom('l1.wav', 3, words('Trust me this will work I promise', 3)) }
    const r = buildTimeline({ ...b, targetSec: 15 })
    expect(r.timeline.shots[0].durationSec).toBeGreaterThanOrEqual(voiceNeedSec(3) - 0.01)
    expect(total(r)).toBeLessThan(15.6)
    expect(r.timeline.shots[1].durationSec).toBeLessThan(r.timeline.shots[0].durationSec + 0.01 + 5)
    // the line still ends inside its shot
    expect(r.timeline.voices[0].startSec + 3).toBeLessThanOrEqual(r.timeline.shots[0].durationSec + 0.01)
  })

  it('keeps the voices and captions in step with the shortened shots', () => {
    const b = plain(4, 5)
    b.script.beats[2] = beat(3, { speaker: 'Luna', line: 'It did not' })
    b.speech = { 3: speechInfoFrom('l3.wav', 1.2, words('It did not', 1.2)) }
    const r = buildTimeline({ ...b, targetSec: 12 })
    const start3 = r.shotStarts[2]
    expect(r.timeline.voices[0].startSec).toBeGreaterThanOrEqual(start3 + 0.29)
    expect(r.timeline.captions[0].startSec).toBeCloseTo(r.timeline.voices[0].startSec, 2)
  })

  it('says so when the shots cannot be shortened enough', () => {
    const r = buildTimeline({ ...plain(4, 1.6), targetSec: 3 })
    expect(total(r)).toBeGreaterThan(4)
    expect(r.notes.join(' ')).toMatch(/longer than its 3s format/)
  })
})
