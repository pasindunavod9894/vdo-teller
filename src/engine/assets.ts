import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

/**
 * Close-up normalisation. Generated close-ups of the same character differ slightly in zoom and position, so swapping
 * between them (expressions, mouth shapes) makes the head "pop". This measures the head in every image and rescales
 * and aligns them so the head has the same size and position in all of them.
 */
export type Bust = { name: string; data: Buffer; width: number; height: number }

type Measured = { left: number; top: number; right: number; bottom: number; headWidth: number; headCenterX: number }

const ALPHA_MIN = 16
/**
 * Fraction of the visible height (from the top) searched for the head. Measured on real generated busts: the head and ears are
 * widest within the top 45%, while rows below ~55% are dominated by scarf, arms and shoulders.
 */
export const HEAD_REGION = 0.45

/** Bounding box of the visible pixels, plus the head: the widest row in the top part of the subject (see HEAD_REGION). */
export function measureBust(rgba: Buffer, width: number, height: number): Measured {
  let top = height, bottom = -1, left = width, right = -1
  const rowL = new Array<number>(height).fill(width)
  const rowR = new Array<number>(height).fill(-1)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > ALPHA_MIN) {
        if (x < rowL[y]) rowL[y] = x
        if (x > rowR[y]) rowR[y] = x
      }
    }
    if (rowR[y] >= 0) {
      if (y < top) top = y
      bottom = y
      left = Math.min(left, rowL[y]); right = Math.max(right, rowR[y])
    }
  }
  if (bottom < 0) throw new Error('Image is fully transparent')
  const headEnd = top + Math.round((bottom - top) * HEAD_REGION)
  let headWidth = 0, headCenterX = (left + right) / 2
  for (let y = top; y <= headEnd; y++) {
    const w = rowR[y] - rowL[y] + 1
    if (rowR[y] >= 0 && w > headWidth) { headWidth = w; headCenterX = (rowL[y] + rowR[y]) / 2 }
  }
  return { left, top, right, bottom, headWidth, headCenterX }
}

export type NormalizeOptions = {
  /** head width in the output image, px */
  headWidth?: number
  /** distance from the top of the output to the top of the head/hat, px */
  topMargin?: number
  canvasWidth?: number
}

/**
 * Rescales and aligns a group of close-ups. All outputs have identical size: the head is the same size and sits at the same
 * place, and the bottom is cropped to the shortest image so no transparent gap remains under the shoulders.
 */
export async function normalizeBusts(files: { name: string; file: string }[], opts: NormalizeOptions = {}): Promise<Bust[]> {
  const headTarget = opts.headWidth ?? 640
  const topMargin = opts.topMargin ?? 60
  const canvasW = opts.canvasWidth ?? 1024

  const measured = await Promise.all(files.map(async (f) => {
    const { data, info } = await sharp(f.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { f, data, info, m: measureBust(data, info.width, info.height) }
  }))

  // scaled subject height below the top margin, per image; crop everything to the shortest
  const scaled = measured.map((x) => {
    const s = headTarget / x.m.headWidth
    return { ...x, s, subjectH: Math.floor((x.m.bottom - x.m.top + 1) * s) }
  })
  const canvasH = topMargin + Math.min(...scaled.map((x) => x.subjectH))

  const out: Bust[] = []
  for (const x of scaled) {
    const resized = await sharp(x.data, { raw: { width: x.info.width, height: x.info.height, channels: 4 } })
      .resize({ width: Math.round(x.info.width * x.s) })
      .png().toBuffer()
    const left = Math.round(canvasW / 2 - x.m.headCenterX * x.s)
    const topCrop = Math.round(x.m.top * x.s)
    // crop the scaled image to the subject's top, then to the common height, then place it on the canvas
    const cropped = await sharp(resized)
      .extract({ left: Math.max(0, -left), top: topCrop, width: Math.min(canvasW - Math.max(0, left), Math.round(x.info.width * x.s) - Math.max(0, -left)), height: canvasH - topMargin })
      .png().toBuffer()
    const png = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: cropped, left: Math.max(0, left), top: topMargin }])
      .png().toBuffer()
    out.push({ name: x.f.name, data: png, width: canvasW, height: canvasH })
  }
  return out
}

export async function writeBusts(busts: Bust[], dir: string, suffix = '-n') {
  fs.mkdirSync(dir, { recursive: true })
  return Promise.all(busts.map(async (b) => {
    const p = path.join(dir, `${b.name}${suffix}.png`)
    await fs.promises.writeFile(p, b.data)
    return p
  }))
}
