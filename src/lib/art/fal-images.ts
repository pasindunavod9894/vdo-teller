import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from '@/engine/ffmpeg'
import { classifyFalError, realClient, type FalLike } from '@/providers/video/fal'
import { EXPRESSIONS } from './plan'

/** Which service draws the character sheet and expressions. Default: fal.ai when FAL_KEY is set, else OpenAI. */
export type CharacterImageProvider = 'fal' | 'openai'
export function characterImageProvider(env: Record<string, string | undefined> = process.env): CharacterImageProvider {
  const v = env.CHARACTER_IMAGE_PROVIDER?.trim().toLowerCase()
  if (v === 'fal' || v === 'openai') return v
  return env.FAL_KEY ? 'fal' : 'openai'
}

/** fal.ai's FLUX.2: text to image, and edit with up to 4 reference images. */
const TEXT_ENDPOINT = 'fal-ai/flux-2'
const EDIT_ENDPOINT = 'fal-ai/flux-2/edit'

export class FalImageError extends Error {
  constructor(message: string, public kind: 'auth' | 'policy' | 'invalid' | 'transient') { super(message) }
}

type Result = { images?: { url?: unknown }[]; has_nsfw_concepts?: boolean[] }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One FLUX.2 image. With `refs` it is an edit of those images (max 4), otherwise text to image. Transient errors retry twice;
 * a flagged image (fal returns it black) is a policy error, because it would otherwise be saved as a black "character".
 */
export async function falImage(o: {
  prompt: string
  size: { width: number; height: number }
  refs?: Buffer[]
  client?: FalLike
  fetchImpl?: typeof fetch
  retries?: number
}): Promise<Buffer> {
  let client: FalLike
  try { client = o.client ?? realClient() } catch (e) { throw new FalImageError((e as Error).message, 'auth') }
  const doFetch = o.fetchImpl ?? fetch
  const retries = o.retries ?? 2
  for (let attempt = 0; ; attempt++) {
    try {
      const input: Record<string, unknown> = { prompt: o.prompt, image_size: o.size, num_images: 1, output_format: 'png' }
      if (o.refs?.length) input.image_urls = await Promise.all(o.refs.slice(0, 4).map((b) => client.storage.upload(new Blob([new Uint8Array(b)], { type: 'image/png' }))))
      const res = await client.subscribe(o.refs?.length ? EDIT_ENDPOINT : TEXT_ENDPOINT, { input })
      const data = res.data as Result | undefined
      if (data?.has_nsfw_concepts?.[0]) throw new FalImageError('The image system declined this description.', 'policy')
      const url = data?.images?.[0]?.url
      if (typeof url !== 'string' || !url.startsWith('http')) throw new FalImageError('fal.ai returned no image', 'invalid')
      const r = await doFetch(url)
      if (!r.ok) throw new FalImageError(`Could not download the image (HTTP ${r.status})`, 'transient')
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      const raw = e instanceof FalImageError ? e.kind : classifyFalError(e)
      const kind = raw === 'download' ? 'transient' : raw
      if (kind !== 'transient' || attempt >= retries) {
        throw e instanceof FalImageError ? e : new FalImageError((e as Error)?.message || 'Image generation failed', kind)
      }
      await sleep(Math.min(6000, 700 * 2 ** attempt))
    }
  }
}

/** The one prompt that draws every expression at once: the panels in reading order (left to right, top to bottom), one expression each. */
export function expressionGridPrompt(canonical: string, style: string, names: readonly string[] = EXPRESSIONS, grid: { cols: number; rows: number } = { cols: 2, rows: 2 }): string {
  const panels = names.map((e, i) => `panel ${i + 1} (row ${Math.floor(i / grid.cols) + 1}, column ${(i % grid.cols) + 1}): a clearly ${e} expression`).join('; ')
  const spare = grid.cols * grid.rows - names.length
  return `The same character as in the reference image, shown as a ${grid.cols} by ${grid.rows} grid of ${grid.cols * grid.rows} equal square panels that fill the whole picture, with no borders, no gaps and no text. Each panel is a head and shoulders close-up facing the camera, framed the same way in every panel, on a plain light-grey background with nothing on it: no pattern, no props, no decoration. ${panels}.${spare > 0 ? ` Leave the last ${spare} panel${spare > 1 ? 's' : ''} plain light grey.` : ''} Keep the exact eye colour, fur or skin pattern and markings, proportions, outfit and every accessory identical in all panels. Character: ${canonical} Art style: ${style}. No other characters.`
}

/**
 * Cuts a grid picture into its panels in reading order with FFmpeg (2 x 2 by default). Each panel is taken a little inside its cell, so a
 * stray line between panels does not end up in a character image.
 */
export async function splitGrid(png: Buffer, cols = 2, rows = 2): Promise<Buffer[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-'))
  try {
    const src = path.join(dir, 'grid.png')
    fs.writeFileSync(src, png)
    const inset = 0.03, w = (1 - 2 * inset) / cols, h = (1 - 2 * inset) / rows
    const cells = Array.from({ length: cols * rows }, (_, i) => ({ file: path.join(dir, `p${i}.png`), x: ((i % cols) + inset) / cols, y: (Math.floor(i / cols) + inset) / rows }))
    await Promise.all(cells.map((c) => run(['-y', '-v', 'error', '-i', src, '-vf', `crop=iw*${w.toFixed(5)}:ih*${h.toFixed(5)}:iw*${c.x.toFixed(5)}:ih*${c.y.toFixed(5)}`, '-frames:v', '1', c.file])))
    return cells.map((c) => fs.readFileSync(c.file))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
