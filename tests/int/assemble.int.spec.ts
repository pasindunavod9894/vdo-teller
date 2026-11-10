import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assembleTimeline, buildVideoGraph, reframeVideo, transitionLengths } from '../../src/engine/assemble'
import { buildAss, assTime } from '../../src/engine/captions-ass'
import { probe, run } from '../../src/engine/ffmpeg'
import { measureLoudness } from '../../src/engine/finish'
import { TimelineSchema, type TimelineInput } from '../../src/engine/timeline'

let dir: string
const assets = () => path.join(dir, 'assets')

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-'))
  fs.mkdirSync(assets())
  // three clips of different colour and length (the second is shorter than its shot, so it must be held)
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x640:r=24:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(assets(), 'a.mp4')])
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2255aa:s=1280x720:r=30:d=1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(assets(), 'b.mp4')])
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=720x1280:r=30:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(assets(), 'c.mp4')])
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-ar', '24000', '-ac', '1', path.join(assets(), 'voice.wav')])
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const timeline = (): TimelineInput => ({
  shots: [
    { id: 's1', clip: 'a.mp4', durationSec: 3 },
    { id: 's2', clip: 'b.mp4', durationSec: 3, transitionIn: 'fade', transitionSec: 0.4, text: [{ text: 'Hello {there}', atSec: 0.5, durationSec: 1 }] },
    { id: 's3', clip: 'c.mp4', durationSec: 2.5, transitionIn: 'slideleft' },
  ],
  voices: [{ src: 'voice.wav', startSec: 3, volume: 1 }],
  captions: [{ text: 'one two three', startSec: 3, endSec: 5, words: [{ text: 'one', startSec: 3, endSec: 3.5 }, { text: 'two', startSec: 3.6, endSec: 4.2 }, { text: 'three', startSec: 4.3, endSec: 4.9 }] }],
  look: { gradeFilter: 'eq=saturation=1.2', grain: 0.2, vignette: 0.3, caption: { position: 'bottom' } },
})

describe('transition lengths', () => {
  it('uses 0 for cuts and the first shot, and clamps to half the shorter neighbour', () => {
    const t = TimelineSchema.parse({ shots: [
      { id: 'a', clip: 'a', durationSec: 3 }, { id: 'b', clip: 'b', durationSec: 0.8, transitionIn: 'fade', transitionSec: 1 }, { id: 'c', clip: 'c', durationSec: 2 },
    ] })
    expect(transitionLengths(t)).toEqual([0, 0.4, 0])
  })
})

describe('video graph', () => {
  it('starts every shot where the earlier durations end (transitions happen just before)', () => {
    const t = TimelineSchema.parse(timeline())
    const g = buildVideoGraph(t, [4, 1.5, 5], null)
    expect(g.lengths).toEqual([3, 3.4, 2.5 + 0.3])
    expect(g.filter).toContain('xfade=transition=fade:duration=0.400:offset=2.600')
    expect(g.filter).toContain('xfade=transition=slideleft:duration=0.300:offset=5.700')
    expect(g.filter).toContain('eq=saturation=1.2')
    expect(g.filter).not.toContain('ass=')
  })
})

describe('captions', () => {
  it('formats ASS times and highlights one word per window', () => {
    expect(assTime(3725.5)).toBe('1:02:05.50')
    const ass = buildAss(TimelineSchema.parse(timeline()))
    expect(ass).toContain('PlayResX: 720')
    expect(ass.match(/Dialogue: 0,/g)?.length).toBeGreaterThanOrEqual(3)
    expect(ass).toContain('Hello there') // braces are stripped so they cannot start an override block
  })
})

describe('assembleTimeline', () => {
  it('produces a 720x1280, 30 fps reel with the exact length and an audio stream', async () => {
    const out = path.join(dir, 'out', 'reel.mp4')
    const r = await assembleTimeline({ timeline: timeline(), assetsDir: assets(), outFile: out, workDir: path.join(dir, 'work') })
    expect(r.durationSec).toBeCloseTo(8.5, 5)
    const p = await probe(out)
    expect(p.width).toBe(720)
    expect(p.height).toBe(1280)
    expect(Math.round(p.fps)).toBe(30)
    expect(p.hasAudio).toBe(true)
    expect(Math.abs(p.durationSec - 8.5)).toBeLessThan(0.15)
    expect((await measureLoudness(out)).integrated).toBeLessThan(0) // has a measurable audio track
  }, 120_000)

  it('still gives a silent reel an audio stream, and rejects a missing clip', async () => {
    const out = path.join(dir, 'out', 'silent.mp4')
    await assembleTimeline({ timeline: { shots: [{ id: 'x', clip: 'a.mp4', durationSec: 2 }] }, assetsDir: assets(), outFile: out, workDir: path.join(dir, 'work2') })
    expect((await probe(out)).hasAudio).toBe(true)
    await expect(assembleTimeline({ timeline: { shots: [{ id: 'y', clip: 'nope.mp4', durationSec: 2 }] }, assetsDir: assets(), outFile: out, workDir: path.join(dir, 'work3') })).rejects.toThrow(/missing/)
  }, 60_000)
})

describe('reframeVideo', () => {
  it('makes a 16:9 version of the master with the same length', async () => {
    const master = path.join(dir, 'out', 'reel.mp4')
    if (!fs.existsSync(master)) await assembleTimeline({ timeline: timeline(), assetsDir: assets(), outFile: master, workDir: path.join(dir, 'work') })
    const wide = path.join(dir, 'out', 'wide.mp4')
    await reframeVideo(master, wide, { width: 1280, height: 720 })
    const p = await probe(wide)
    expect([p.width, p.height]).toEqual([1280, 720])
    expect(Math.abs(p.durationSec - (await probe(master)).durationSec)).toBeLessThan(0.15)
    expect(p.hasAudio).toBe(true)
  }, 120_000)
})
