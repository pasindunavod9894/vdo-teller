import { clipSeconds, DEFAULT_VIDEO_MODEL, lipsyncCostUsd, DEFAULT_LIPSYNC_MODEL, VIDEO_MODELS, type VideoModelId } from './video'

/**
 * The reel: every video is a short story of 25 to 30 seconds (there is no choice of length). This module is the single source of
 * truth for what that means (shots, beats, spoken words, story shape) and for what it costs. Pure, so the wizard, the dashboard and
 * the pipeline all read the same numbers.
 */
export const REEL_MIN_SEC = 25
export const REEL_MAX_SEC = 30
/** The length the Art Director plans for: the middle of the window, with room for a voice line to run a little long. */
export const REEL_TARGET_SEC = 28

/** A shot never runs past one 5-second clip: a longer one would need a 10-second clip, which costs twice as much. */
export const MAX_SHOT_SEC = 5

export type ReelSpec = {
  minSec: number
  maxSec: number
  targetSec: number
  label: string
  /** how many shots (and so video clips) the reel has */
  shots: number
  /** average seconds a shot is on screen */
  shotSec: number
  /** how many beats the script has: [fewest, most]. The Art Director makes one shot per beat. */
  beats: [number, number]
  /** the most words all spoken lines together may have (about 65% of the length at 2.5 words per second, so a line always fits its shot) */
  maxSpokenWords: number
  /** the story shape the Writer follows */
  structure: string
}

export const REEL: ReelSpec = {
  minSec: REEL_MIN_SEC, maxSec: REEL_MAX_SEC, targetSec: REEL_TARGET_SEC, label: '25–30 seconds',
  shots: 7, shotSec: REEL_TARGET_SEC / 7, beats: [6, 7], maxSpokenWords: 46,
  structure: 'a short story in six or seven beats: a hook in the first 3 seconds, the setup (what the character wants), a complication, an escalation, the turn (the choice), the payoff and a closing beat that makes people watch again',
}

/** True when a length (in seconds) is one a reel may have. */
export const isReelLength = (sec: number): boolean => Number.isFinite(sec) && sec >= REEL_MIN_SEC && sec <= REEL_MAX_SEC

/** A rough price of one video, for the wizard and the dashboard: the clips, lip-sync for about half the shots, and images, voice and checks. */
export function estimateReelCostUsd(model: VideoModelId = DEFAULT_VIDEO_MODEL): number {
  const clip = clipSeconds(model, REEL.shotSec)
  const video = REEL.shots * clip * VIDEO_MODELS[model].pricePerSec
  const lipsync = Math.ceil(REEL.shots / 2) * lipsyncCostUsd(DEFAULT_LIPSYNC_MODEL, clip)
  const other = 0.6 // plates, keyframes, reference checks, speech and the continuity checks
  return Math.round((video + lipsync + other) * 100) / 100
}
