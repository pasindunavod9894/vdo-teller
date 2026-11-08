import path from 'node:path'
import { videoCostUsd, type VideoModelId } from '../lib/video'
import { makeClip, type ClipRequest, type ClipResult } from '../providers/video'
import { VideoError } from '../providers/video/fal'
import type { VideoClip } from './schemas'

export type VideoShot = { n: number; videoSeconds: number; motionPrompt: string | null }

export type ProduceOptions = {
  model: VideoModelId
  shots: VideoShot[]
  /** where the clips are written */
  workDir: string
  /** the full-scene still (WITH the character in it) for a shot, or null if it does not exist yet */
  stillFor: (shot: number) => string | null
  /** real video seconds this run may still use; clips that do not fit are skipped, never generated */
  allowanceSec: number
  /** injectable for tests */
  make?: (req: ClipRequest) => Promise<ClipResult>
}

export type ProduceResult = {
  clips: VideoClip[]
  totalCostUsd: number
  totalSeconds: number
  /** shots that did NOT get a clip and must be rendered by the free engine instead */
  fallbackShots: number[]
}

/**
 * Generates the real-video clip for each planned shot. One failing clip never fails the episode: that shot falls back
 * to the engine. Only clips that actually succeeded are counted as cost.
 */
export async function produceVideoShots(opts: ProduceOptions): Promise<ProduceResult> {
  const make = opts.make ?? makeClip
  const clips: VideoClip[] = []
  const fallback: number[] = []
  let left = opts.allowanceSec
  let totalCost = 0
  let totalSec = 0

  for (const s of opts.shots) {
    const estimatedUsd = videoCostUsd(opts.model, s.videoSeconds)
    const base = { shot: s.n, model: opts.model, seconds: s.videoSeconds, estimatedUsd, costUsd: 0 }
    const still = opts.stillFor(s.n)
    if (!still) { clips.push({ ...base, status: 'needs-still' }); fallback.push(s.n); continue }
    if (s.videoSeconds > left) { clips.push({ ...base, status: 'skipped-budget' }); fallback.push(s.n); continue }
    if (!s.motionPrompt) { clips.push({ ...base, status: 'failed', error: 'No motion prompt' }); fallback.push(s.n); continue }
    try {
      const r = await make({ model: opts.model, imageFile: still, prompt: s.motionPrompt, seconds: s.videoSeconds, destFile: path.join(opts.workDir, `shot-${s.n}.mp4`) })
      // mock and library (cached) clips are free: they must not use up the real-video seconds
      if (!r.mock && !r.cached) left -= r.seconds
      totalCost += r.costUsd
      totalSec += r.mock || r.cached ? 0 : r.seconds
      clips.push({ ...base, seconds: r.seconds, costUsd: r.costUsd, status: r.mock ? 'mock' : 'generated', file: r.file })
    } catch (e) {
      const msg = e instanceof VideoError ? `${e.kind}: ${e.message}` : (e as Error).message
      clips.push({ ...base, status: 'failed', error: msg.slice(0, 200) })
      fallback.push(s.n)
    }
  }
  return { clips, totalCostUsd: Math.round(totalCost * 100) / 100, totalSeconds: totalSec, fallbackShots: fallback }
}
