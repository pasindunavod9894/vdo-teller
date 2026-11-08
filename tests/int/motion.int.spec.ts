import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { cycleFrame, energyAt, hopOffset, lerp, squashStretch } from '@/engine/motion'
import { energyEnvelope } from '@/engine/lipsync'
import { alignBodies, measureBust } from '@/engine/assets'
import { alignToScript } from '@/engine/transcribe'
import { TimelineSchema } from '@/engine/timeline'

describe('hop and squash-and-stretch', () => {
  it('a hop starts and ends on the ground and peaks in the middle', () => {
    expect(hopOffset(0.2, 0)).toBe(0)
    expect(hopOffset(0.2, 1)).toBe(0)
    expect(hopOffset(0.2, 0.5)).toBeCloseTo(0.2)
  })
  it('squashes at take-off and landing, stretches in the air, and preserves volume roughly', () => {
    expect(squashStretch(0).sy).toBeLessThan(0.95)
    expect(squashStretch(1).sy).toBeLessThan(0.95)
    expect(squashStretch(0.5).sy).toBeGreaterThan(1.05)
    for (const p of [0, 0.25, 0.5, 0.75, 1]) { const s = squashStretch(p); expect(s.sx * s.sy).toBeGreaterThan(0.85); expect(s.sx * s.sy).toBeLessThan(1.15) }
  })
  it('lerp interpolates', () => expect(lerp(10, 20, 0.25)).toBe(12.5))
})

describe('walk cycle', () => {
  const frames = ['a.png', 'b.png']
  it('alternates strides at the given rate and only inside the cycle window', () => {
    expect(cycleFrame(frames, 2, 1, 3, 0.9)).toBeNull()
    expect(cycleFrame(frames, 2, 1, 3, 1.0)).toBe('a.png')
    expect(cycleFrame(frames, 2, 1, 3, 1.5)).toBe('b.png')
    expect(cycleFrame(frames, 2, 1, 3, 2.0)).toBe('a.png')
    expect(cycleFrame(frames, 2, 1, 3, 3.0)).toBeNull()
  })
})

describe('speech-driven head motion', () => {
  it('energy envelope is 0..1, attacks fast and releases slowly', () => {
    const env = energyEnvelope([0, 0, 1, 0, 0, 0, 0])
    expect(Math.max(...env)).toBeLessThanOrEqual(1)
    expect(env[2]).toBeGreaterThan(0.5) // fast attack
    expect(env[3]).toBeGreaterThan(0) // still decaying one frame later (slower release)
    expect(env[3]).toBeLessThan(env[2])
  })
  it('energyAt is 0 outside the clip', () => {
    const e = [0.2, 0.8, 0.5]
    expect(energyAt(e, 1, 0.5, 30)).toBe(0)
    expect(energyAt(e, 1, 1 + 1 / 30, 30)).toBe(0.8)
    expect(energyAt(e, 1, 5, 30)).toBe(0)
  })
})

describe('caption word timing', () => {
  it('uses the script words with the recognised times, offset by the clip start', () => {
    const w = alignToScript('Wait... why is it growling', [
      { text: 'Wait', startSec: 0, endSec: 0.3 }, { text: 'why', startSec: 0.5, endSec: 0.7 }, { text: 'is', startSec: 0.7, endSec: 0.8 },
      { text: 'it', startSec: 0.8, endSec: 0.9 }, { text: 'growling', startSec: 0.9, endSec: 1.4 },
    ], 10)
    expect(w.map((x) => x.text)).toEqual(['Wait...', 'why', 'is', 'it', 'growling'])
    expect(w[0].startSec).toBe(10)
    expect(w[4].endSec).toBeCloseTo(11.4)
  })
  it('stretches when the counts differ and returns nothing without recognition', () => {
    const w = alignToScript('one two three four', [{ text: 'one', startSec: 0, endSec: 0.5 }, { text: 'two', startSec: 0.5, endSec: 1 }], 0)
    expect(w).toHaveLength(4)
    expect(w[0].startSec).toBe(0)
    expect(alignToScript('x y', [], 0)).toEqual([])
  })
})

describe('body alignment', () => {
  it('puts the feet of different poses on the same baseline and centres them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bodies-'))
    const draw = async (name: string, w: number, h: number, x: number, y: number) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f90"/></svg>`
      const f = path.join(dir, `${name}.png`); await sharp(Buffer.from(svg)).png().toFile(f); return { name, file: f }
    }
    const out = await alignBodies([await draw('tall', 200, 600, 100, 50), await draw('wide', 500, 300, 300, 400)])
    const ms = await Promise.all(out.map(async (o) => { const r = await sharp(o.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return measureBust(r.data, r.info.width, r.info.height) }))
    expect(ms[0].bottom).toBe(ms[1].bottom)
    expect(Math.abs((ms[0].left + ms[0].right) / 2 - (ms[1].left + ms[1].right) / 2)).toBeLessThan(3)
    fs.rmSync(dir, { recursive: true })
  })
})

describe('timeline accepts the new motion fields', () => {
  it('parses a walking, hopping, talking, blinking character', () => {
    const t = TimelineSchema.parse({ shots: [{ id: 's', durationSec: 3, background: 'bg.png', layers: [{
      kind: 'character', id: 'c', frames: [{ atSec: 0, src: 'a.png' }],
      path: { from: { x: -0.2, y: 1 }, to: { x: 0.5, y: 1 }, startSec: 0, endSec: 2, arc: 0.1 },
      cycle: { frames: ['a.png', 'b.png'], fromSec: 0, toSec: 2 },
      talk: { energy: [0.1, 0.5], startSec: 2 }, shiver: { fromSec: 0, toSec: 1 }, blinks: { src: 'blink.png', times: [1, 2] },
    }] }] })
    const c = t.shots[0].layers[0]
    expect(c.kind === 'character' && c.path?.ease).toBe('inOut')
    expect(c.kind === 'character' && c.cycle?.hz).toBe(3)
  })
})
