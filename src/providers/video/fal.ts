import fs from 'node:fs'
import path from 'node:path'
import { fal } from '@fal-ai/client'
import { scrubText } from '../../pipeline/brand-safety'
import { probe, run } from '../../engine/ffmpeg'
import { clipSeconds, DEFAULT_VIDEO_MODEL, VIDEO_MODELS, videoCostUsd, type VideoModelId } from '../../lib/video'

export type VideoErrorKind = 'auth' | 'policy' | 'invalid' | 'transient' | 'download'

export class VideoError extends Error {
  constructor(message: string, public kind: VideoErrorKind) { super(message) }
}

/** The slice of the fal client we use; tests pass a fake. */
export type FalLike = {
  subscribe(endpoint: string, opts: { input: Record<string, unknown>; logs?: boolean }): Promise<{ data: unknown; requestId?: string }>
  storage: { upload(file: Blob): Promise<string> }
}

export type ClipRequest = {
  model?: VideoModelId
  /** the shot's approved keyframe: the full scene WITH its characters in it */
  imageFile: string
  /** describes the MOTION only: what moves and how the camera moves */
  prompt: string
  seconds: number
  destFile: string
  negativePrompt?: string
  /** pin the END of the clip to this image too (only for models that support it); used by the continuity retry */
  tailImageFile?: string
  client?: FalLike
  fetchImpl?: typeof fetch
  retries?: number
}

export type ClipResult = { file: string; seconds: number; costUsd: number; model: VideoModelId; remoteUrl: string; requestId?: string; mock?: boolean; /** served from the series library: no money was spent */ cached?: boolean }

const MAX_PROMPT = 500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function realClient(): FalLike {
  const key = process.env.FAL_KEY
  if (!key) throw new VideoError('FAL_KEY is not set', 'auth')
  fal.config({ credentials: key })
  return fal as unknown as FalLike
}

/** Maps an error from the fal client (or network) to a kind we can act on. Only "transient" is worth retrying. */
export function classifyFalError(e: unknown): VideoErrorKind {
  const err = e as { status?: number; message?: string; body?: unknown }
  const text = `${err?.message ?? ''} ${typeof err?.body === 'string' ? err.body : JSON.stringify(err?.body ?? '')}`.toLowerCase()
  if (err?.status === 401 || err?.status === 403) return 'auth'
  if (/content[_ ]policy|safety|nsfw|violat/.test(text)) return 'policy'
  if (err?.status === 429 || (err?.status !== undefined && err.status >= 500)) return 'transient'
  if (err?.status !== undefined && err.status >= 400) return 'invalid'
  return 'transient' // no status: network-level failure
}

export async function probeDuration(file: string): Promise<number> {
  try { return (await probe(file)).durationSec } catch { throw new Error('ffprobe could not read the clip') }
}

/**
 * Animates one approved still into a 5 or 10 second clip with fal.ai (image-to-video), downloads it, and returns what it cost.
 * A failed request is not billed; only a successful clip is counted. Transient errors retry; policy/auth/invalid ones do not.
 */
export async function generateClip(req: ClipRequest): Promise<ClipResult> {
  const model = req.model ?? DEFAULT_VIDEO_MODEL
  const spec = VIDEO_MODELS[model]
  if (!fs.existsSync(req.imageFile)) throw new VideoError(`Source still not found: ${req.imageFile}`, 'invalid')
  // brand names never go to the model; keep the prompt short and about motion
  const prompt = scrubText(req.prompt).slice(0, MAX_PROMPT).trim()
  if (!prompt) throw new VideoError('The motion prompt is empty', 'invalid')
  const seconds = clipSeconds(model, req.seconds)
  const client = req.client ?? realClient()
  const doFetch = req.fetchImpl ?? fetch
  const retries = req.retries ?? 2

  const image = fs.readFileSync(req.imageFile)
  const mime = req.imageFile.toLowerCase().endsWith('.jpg') || req.imageFile.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
  const input = { prompt, duration: String(seconds), ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}) }

  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const imageUrl = await client.storage.upload(new Blob([image], { type: mime }))
      const tailUrl = req.tailImageFile && spec.endFrame && fs.existsSync(req.tailImageFile)
        ? await client.storage.upload(new Blob([fs.readFileSync(req.tailImageFile)], { type: req.tailImageFile.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png' }))
        : null
      const res = await client.subscribe(spec.endpoint, { input: { ...input, image_url: imageUrl, ...(tailUrl ? { tail_image_url: tailUrl } : {}) } })
      const url = (res.data as { video?: { url?: unknown } } | undefined)?.video?.url
      if (typeof url !== 'string' || !url.startsWith('http')) throw new VideoError('fal.ai returned no video url', 'invalid')
      const r = await doFetch(url)
      if (!r.ok) throw new VideoError(`Could not download the clip (HTTP ${r.status})`, 'download')
      fs.mkdirSync(path.dirname(req.destFile), { recursive: true })
      fs.writeFileSync(req.destFile, Buffer.from(await r.arrayBuffer()))
      const dur = await probeDuration(req.destFile)
      if (dur < 0.5) throw new VideoError('The downloaded clip is empty', 'download')
      return { file: req.destFile, seconds, costUsd: videoCostUsd(model, seconds), model, remoteUrl: url, requestId: res.requestId }
    } catch (e) {
      last = e
      const kind = e instanceof VideoError ? (e.kind === 'download' ? 'transient' : e.kind) : classifyFalError(e)
      if (kind !== 'transient' || attempt === retries) {
        if (e instanceof VideoError) throw e
        throw new VideoError((e as Error)?.message || 'Video generation failed', kind)
      }
      await sleep(Math.min(8000, 800 * 2 ** attempt))
    }
  }
  throw last
}

/**
 * Free stand-in for the video model: a slow push-in made from the still with FFmpeg. Lets the whole pipeline (timeline,
 * assembly, cost tracking) run without spending anything.
 */
export function generateMockClip(req: Pick<ClipRequest, 'imageFile' | 'seconds' | 'destFile'> & { width?: number; height?: number; model?: VideoModelId }): Promise<ClipResult> {
  const model = req.model ?? DEFAULT_VIDEO_MODEL
  const seconds = clipSeconds(model, req.seconds)
  const w = req.width ?? 720, h = req.height ?? 1280
  fs.mkdirSync(path.dirname(req.destFile), { recursive: true })
  const frames = seconds * 30
  const vf = `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0012,1.2)':d=${frames}:s=${w}x${h}:fps=30,format=yuv420p`
  return run(['-y', '-v', 'error', '-loop', '1', '-i', req.imageFile, '-vf', vf, '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', req.destFile])
    .then(() => ({ file: req.destFile, seconds, costUsd: 0, model, remoteUrl: 'mock://ffmpeg', mock: true }) as ClipResult)
    .catch((e: Error) => { throw new VideoError(`Mock clip failed: ${e.message.slice(-200)}`, 'invalid') })
}
