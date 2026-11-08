import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { estimateShift, mouthCentre, shiftImage } from '@/engine/talk'

const SIZE = 1024

/** A busy "face" (eyes + hat + noise-free shapes) drawn at an offset, so shifts are detectable. */
async function face(dx: number, dy: number, mouth = false) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
    <ellipse cx="${512 + dx}" cy="${520 + dy}" rx="330" ry="300" fill="#f6962e"/>
    <rect x="${380 + dx}" y="${80 + dy}" width="260" height="180" rx="60" fill="#eee"/>
    <circle cx="${400 + dx}" cy="${430 + dy}" r="52" fill="#3a3"/><circle cx="${624 + dx}" cy="${430 + dy}" r="52" fill="#3a3"/>
    <circle cx="${400 + dx}" cy="${436 + dy}" r="22" fill="#111"/><circle cx="${624 + dx}" cy="${436 + dy}" r="22" fill="#111"/>
    ${mouth ? `<ellipse cx="${512 + dx}" cy="${650 + dy}" rx="70" ry="50" fill="#5a1d1d"/>` : ''}
  </svg>`
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer()
}

describe('steady-face lip-sync helpers', () => {
  it('estimates the shift between two renders of the same face', async () => {
    const a = await face(0, 0)
    const b = await face(12, -8)
    const s = estimateShift(a, b)
    // b is a shifted by (+12, -8): matching b back onto a needs the same offset (within the 4px search grid)
    expect(Math.abs(s.dx - 12)).toBeLessThanOrEqual(4)
    expect(Math.abs(s.dy + 8)).toBeLessThanOrEqual(4)
  })

  it('reports no shift for identical faces', async () => {
    const a = await face(0, 0)
    expect(estimateShift(a, a)).toEqual({ dx: 0, dy: 0 })
  })

  it('finds the mouth where the variant differs in the lower face', async () => {
    const closed = await face(0, 0, false)
    const open = await face(0, 0, true)
    const c = mouthCentre(closed, open)
    expect(Math.abs(c.x - 512)).toBeLessThan(20)
    expect(Math.abs(c.y - 650)).toBeLessThan(20)
  })

  it('falls back to a sensible default when nothing differs', async () => {
    const a = await face(0, 0)
    const c = mouthCentre(a, a)
    expect(c.x).toBe(SIZE / 2)
    expect(c.y).toBeGreaterThan(SIZE * 0.5)
  })
})


describe('shiftImage (regression: negative offsets crashed with "bad extract area")', () => {
  const bbox = (raw: Buffer) => {
    let l = SIZE, r = -1, t = SIZE, b = -1
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (raw[(y * SIZE + x) * 4 + 3] > 40) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y) }
    return { l, r, t, b }
  }
  it.each([[0, 0], [20, 12], [-20, -12], [16, -8], [-16, 8]])('moves content by (%i, %i) exactly', async (dx, dy) => {
    const raw = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect x="300" y="300" width="200" height="200" fill="#f00"/></svg>`)).ensureAlpha().raw().toBuffer()
    const moved = await shiftImage(raw, dx, dy)
    expect(moved.length).toBe(raw.length)
    const b = bbox(moved)
    expect(b.l).toBe(300 + dx); expect(b.t).toBe(300 + dy); expect(b.r).toBe(499 + dx); expect(b.b).toBe(499 + dy)
  })
})
