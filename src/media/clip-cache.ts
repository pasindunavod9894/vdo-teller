import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_VIDEO_MODEL } from '../lib/video'
import { probeDuration, type ClipRequest, type ClipResult } from '../providers/video/fal'

/**
 * Real-motion clips are the most expensive thing the pipeline makes. A clip is stored in the series library under a key
 * made of its starting image, motion prompt, length and model, so a retry of a failed episode (or a repeated shot) gets the
 * same clip back for free instead of paying for it again. Mock clips are free and are never cached.
 */
export function clipKey(req: Pick<ClipRequest, 'model' | 'prompt' | 'seconds' | 'imageFile'>): string {
  const image = crypto.createHash('sha1').update(fs.readFileSync(req.imageFile)).digest('hex')
  return crypto.createHash('sha1').update([req.model ?? DEFAULT_VIDEO_MODEL, req.prompt, String(req.seconds), image].join('\u0000')).digest('hex').slice(0, 16)
}

export function withClipCache(libraryDir: string, inner: (req: ClipRequest) => Promise<ClipResult>): (req: ClipRequest) => Promise<ClipResult> {
  return async (req) => {
    const stored = path.join(libraryDir, `clip-${clipKey(req)}.mp4`)
    if (fs.existsSync(stored)) {
      fs.mkdirSync(path.dirname(req.destFile), { recursive: true })
      fs.copyFileSync(stored, req.destFile)
      return { file: req.destFile, seconds: await probeDuration(stored), costUsd: 0, model: req.model ?? DEFAULT_VIDEO_MODEL, remoteUrl: 'library', cached: true }
    }
    const r = await inner(req)
    if (!r.mock && fs.existsSync(r.file)) { fs.mkdirSync(libraryDir, { recursive: true }); fs.copyFileSync(r.file, stored) }
    return r
  }
}
