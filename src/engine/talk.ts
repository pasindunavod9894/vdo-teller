import sharp from 'sharp'

/**
 * Steady-face lip-sync. Separately generated mouth images change the eyes, brows and head slightly, which reads as flicker.
 * Here every talking frame is the SAME base face with only the mouth region taken from an edited variant, so nothing else moves.
 */

const SIZE = 1024

async function rgbaSquare(input: Buffer | string) {
  return sharp(input).resize(SIZE, SIZE, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
}

/**
 * Finds the (dx, dy) shift of `b` that best matches `a` over the upper face (eyes, ears, hat), searched on a 4x smaller grid.
 * The edited variants are generated at a slightly different canvas, so a few pixels of offset are expected.
 */
export function estimateShift(a: Buffer, b: Buffer, size = SIZE, range = 6): { dx: number; dy: number } {
  const step = 4
  const n = size / step
  const gray = (src: Buffer) => {
    const g = new Float32Array(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = ((y * step) * size + x * step) * 4
      g[y * n + x] = src[i + 3] > 40 ? (src[i] + src[i + 1] + src[i + 2]) / 3 : -1
    }
    return g
  }
  const ga = gray(a), gb = gray(b)
  let best = Infinity, bdx = 0, bdy = 0
  for (let dy = -range; dy <= range; dy++) for (let dx = -range; dx <= range; dx++) {
    let sum = 0, cnt = 0
    for (let y = 4; y < n * 0.5; y++) for (let x = 8; x < n - 8; x++) {
      const yy = y + dy, xx = x + dx
      if (yy < 0 || yy >= n || xx < 0 || xx >= n) continue
      const va = ga[y * n + x], vb = gb[yy * n + xx]
      if (va < 0 || vb < 0) continue
      sum += Math.abs(va - vb); cnt++
    }
    const score = cnt ? sum / cnt : Infinity
    if (score < best) { best = score; bdx = dx; bdy = dy }
  }
  return { dx: bdx * step, dy: bdy * step }
}


/**
 * Moves the content of a raw RGBA square by (dx, dy) pixels (positive = right/down), filling the gap with transparency.
 * Pads first and crops in a second step; calling extend() and extract() in one chain makes sharp crop before it pads.
 */
export async function shiftImage(raw: Buffer, dx: number, dy: number, size = SIZE): Promise<Buffer> {
  const r = Math.max(Math.abs(dx), Math.abs(dy))
  if (r === 0) return raw
  const padded = await sharp(raw, { raw: { width: size, height: size, channels: 4 } })
    .extend({ top: r, bottom: r, left: r, right: r, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer()
  return sharp(padded).extract({ left: r - dx, top: r - dy, width: size, height: size }).ensureAlpha().raw().toBuffer()
}

/** Centre of the region where a variant differs from the base in the lower face: that is where the mouth is. */
export function mouthCentre(base: Buffer, variant: Buffer, size = SIZE, area: 'mouth' | 'eyes' = 'mouth'): { x: number; y: number } {
  let sx = 0, sy = 0, sw = 0
  const [y0, y1, x0, x1] = area === 'mouth' ? [0.5, 0.85, 0.3, 0.7] : [0.3, 0.58, 0.2, 0.8]
  for (let y = Math.round(size * y0); y < Math.round(size * y1); y++) for (let x = Math.round(size * x0); x < Math.round(size * x1); x++) {
    const i = (y * size + x) * 4
    if (base[i + 3] < 40 || variant[i + 3] < 40) continue
    const d = Math.abs(base[i] - variant[i]) + Math.abs(base[i + 1] - variant[i + 1]) + Math.abs(base[i + 2] - variant[i + 2])
    if (d > 60) { sx += x * d; sy += y * d; sw += d }
  }
  return sw ? { x: sx / sw, y: sy / sw } : { x: size / 2, y: size * (area === 'mouth' ? 0.64 : 0.46) }
}

export type TalkFrame = { name: string; data: Buffer }

/**
 * Builds the talking frames: the base face plus, for each variant, its mouth patched onto the base with a soft edge.
 * `rx`/`ry` are the patch radii in px (at 1024).
 */
export async function buildTalkingFrames(
  baseFile: string, variants: { name: string; file: string }[], opts: { rx?: number; ry?: number } = {},
): Promise<TalkFrame[]> {
  const rx = opts.rx ?? 190, ry = opts.ry ?? 130
  const base = await rgbaSquare(baseFile)
  const baseKept = await sharp(base, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer()
  const out: TalkFrame[] = []
  for (const v of variants) {
    const raw = await rgbaSquare(v.file)
    const { dx, dy } = estimateShift(base, raw)
    // shift the variant onto the base's coordinates
    const aligned = await shiftImage(raw, dx, dy)
    const c = mouthCentre(base, aligned)
    const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff"/><stop offset="62%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient></defs><ellipse cx="${c.x}" cy="${c.y}" rx="${rx}" ry="${ry}" fill="url(#g)"/></svg>`)
    const patch = await sharp(aligned, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .composite([{ input: await sharp(mask).resize(SIZE, SIZE).png().toBuffer(), blend: 'dest-in' }])
      .png().toBuffer()
    out.push({ name: v.name, data: await sharp(baseKept).composite([{ input: patch }]).png().toBuffer() })
  }
  return out
}


/**
 * A transparent PNG that contains ONLY the changed region of a variant (e.g. closed eyes), to be laid over the base face.
 * Used for blinks: the rest of the face is never touched.
 */
export async function buildPatchOverlay(baseFile: string, variantFile: string, area: 'mouth' | 'eyes', opts: { rx?: number; ry?: number } = {}): Promise<Buffer> {
  const rx = opts.rx ?? (area === 'eyes' ? 300 : 190), ry = opts.ry ?? (area === 'eyes' ? 110 : 130)
  const base = await rgbaSquare(baseFile)
  const raw = await rgbaSquare(variantFile)
  const { dx, dy } = estimateShift(base, raw)
  const aligned = await shiftImage(raw, dx, dy)
  const c = mouthCentre(base, aligned, SIZE, area)
  const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff"/><stop offset="62%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient></defs><ellipse cx="${c.x}" cy="${c.y}" rx="${rx}" ry="${ry}" fill="url(#g)"/></svg>`)
  return sharp(aligned, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .composite([{ input: await sharp(mask).resize(SIZE, SIZE).png().toBuffer(), blend: 'dest-in' }])
    .png().toBuffer()
}
