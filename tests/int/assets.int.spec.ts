import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { measureBust, normalizeBusts } from '@/engine/assets'

/** Synthetic "bust": a head circle on top of wider shoulders that start below the head and run off the bottom (like the real assets: shoulders begin after ~55% of the height). */
async function bust(file: string, head: { r: number; cx: number; cy: number }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><circle cx="${head.cx}" cy="${head.cy}" r="${head.r}" fill="#f90"/><rect x="${head.cx - head.r * 1.6}" y="${head.cy + head.r * 1.4}" width="${head.r * 3.2}" height="800" rx="40" fill="#f90"/></svg>`
  await sharp(Buffer.from(svg)).png().toFile(file)
}

describe('close-up normalisation', () => {
  it('measures the head as the widest row in the upper part, not the shoulders', async () => {
    const f = path.join(os.tmpdir(), `bust-${Date.now()}.png`)
    await bust(f, { r: 150, cx: 400, cy: 300 })
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const m = measureBust(data, info.width, info.height)
    expect(Math.abs(m.headWidth - 300)).toBeLessThan(6)
    expect(Math.abs(m.headCenterX - 400)).toBeLessThan(3)
    expect(m.top).toBeLessThanOrEqual(151)
    fs.unlinkSync(f)
  })

  it('gives different zoom and position the same head size, position and canvas', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'busts-'))
    const a = path.join(dir, 'a.png'), b = path.join(dir, 'b.png')
    await bust(a, { r: 150, cx: 400, cy: 300 })
    await bust(b, { r: 190, cx: 430, cy: 330 }) // zoomed in and shifted, like a "wide open" take
    const out = await normalizeBusts([{ name: 'a', file: a }, { name: 'b', file: b }], { headWidth: 500, topMargin: 40, canvasWidth: 900 })
    expect(out[0].width).toBe(out[1].width)
    expect(out[0].height).toBe(out[1].height)
    const m = await Promise.all(out.map(async (o) => { const r = await sharp(o.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return measureBust(r.data, r.info.width, r.info.height) }))
    expect(Math.abs(m[0].headWidth - m[1].headWidth)).toBeLessThan(8)
    expect(Math.abs(m[0].headCenterX - m[1].headCenterX)).toBeLessThan(6)
    expect(Math.abs(m[0].top - m[1].top)).toBeLessThan(6)
    expect(Math.abs(m[0].headWidth - 500)).toBeLessThan(10)
    fs.rmSync(dir, { recursive: true })
  })
})
