import { isReelLength, REEL } from '../lib/format'
import { clipSeconds, DEFAULT_VIDEO_MODEL, VIDEO_MODELS, type VideoModelId } from '../lib/video'

/** For a length outside the reel window: a reel's shots are about this long on screen, each with its own clip. */
const SHOT_SEC = 3.5
/** Keyframes, voice, lip-sync, reference images and checks, on top of the video. */
const FLAT_USD = 1.5
/** Room for a second try of a clip that drifted. */
const RETRY_FACTOR = 1.5

/**
 * The most one episode may cost (plan §3b "per-episode ceiling"): every shot is a video clip, with room for retries.
 * EPISODE_COST_CAP_USD overrides it. A reel of 25 to 30 seconds is about $5.2 with the default model.
 */
export function episodeCeilingUsd(durationSec: number, model: VideoModelId = DEFAULT_VIDEO_MODEL, env: Record<string, string | undefined> = process.env): number {
  const forced = Number(env.EPISODE_COST_CAP_USD)
  if (env.EPISODE_COST_CAP_USD && Number.isFinite(forced) && forced > 0) return forced
  // a reel has a fixed number of shots (7); any other length is counted by its shots' length
  const shots = isReelLength(durationSec) ? REEL.shots : Math.max(1, Math.ceil(durationSec / SHOT_SEC))
  const video = shots * clipSeconds(model, SHOT_SEC) * VIDEO_MODELS[model].pricePerSec * RETRY_FACTOR
  return Math.round((video + FLAT_USD) * 100) / 100
}

/**
 * The default cost cap of a series in USD. A reel costs about 3 to 6, so the old cap of 5 would have stopped a series after one
 * video; 30 allows roughly six to ten reels before the owner has to raise it. Change it per series in the admin.
 */
export const DEFAULT_SERIES_CAP_USD = 30
