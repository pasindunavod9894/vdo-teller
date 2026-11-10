/**
 * Video-model registry and cost maths (plan §1b, §12). Every shot of a reel is a real video clip made from an approved
 * keyframe, so there are no quality tiers and no engine fallback: the only limits are the series cost cap and the episode ceiling.
 * Pure functions only, so the money logic is easy to test. Only models whose fal.ai schema has been verified are listed.
 */

export const VIDEO_MODELS = {
  // Verified on fal.ai: inputs image_url + prompt (+ duration "5"|"10", negative_prompt, cfg_scale, tail_image_url);
  // no aspect-ratio input (the output follows the keyframe); output { video: { url } }.
  'kling-2.5-turbo': {
    label: 'Kling 2.5 Turbo (pro)',
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    durations: [5, 10] as readonly number[],
    /** fal.ai: $0.35 for 5 s, then $0.07 per extra second => $0.07 per second */
    pricePerSec: 0.07,
    /** can a clip be pinned to a start AND an end keyframe (used by the continuity retry) */
    endFrame: true,
  },
  // fal.ai page: inputs image_url, prompt, duration "5"|"10", negative_prompt, cfg_scale. $0.21 for 5 s, then $0.042 per extra second.
  // NOT yet verified with a live call: its output resolution and tail_image_url support are not on the page. Run
  // scripts/live-kling-test.ts with VIDEO_MODEL=kling-2.5-turbo-standard, then make it the default below if it passes.
  'kling-2.5-turbo-standard': {
    label: 'Kling 2.5 Turbo (standard)',
    endpoint: 'fal-ai/kling-video/v2.5-turbo/standard/image-to-video',
    durations: [5, 10] as readonly number[],
    pricePerSec: 0.042,
    endFrame: false,
  },
} as const

export type VideoModelId = keyof typeof VIDEO_MODELS
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'kling-2.5-turbo'
export const isVideoModel = (id: unknown): id is VideoModelId => typeof id === 'string' && id in VIDEO_MODELS

/** Cost in USD of a clip of `seconds` (snapped to a length the model supports). */
export function videoCostUsd(model: VideoModelId, seconds: number): number {
  const m = VIDEO_MODELS[model]
  return Math.round(clipSeconds(model, seconds) * m.pricePerSec * 100) / 100
}

/** The smallest supported clip length that covers `wanted` seconds (or the longest one if none does). */
export function clipSeconds(model: VideoModelId, wanted: number): number {
  const d = [...VIDEO_MODELS[model].durations].sort((a, b) => a - b)
  return d.find((x) => x >= wanted) ?? d[d.length - 1]
}

export type ShotKind = 'establishing' | 'dialogue' | 'action' | 'subtle' | 'reaction' | 'info'

/** Lip-sync models on fal.ai. A dialogue clip and its speech go in, the same clip with a moving mouth comes out. */
export const LIPSYNC_MODELS = {
  // fal.ai page: inputs video_url, audio_url, sync_mode (cut_off | loop | bounce | silence | remap); $3 per minute of video.
  // Its pages do not say whether it works on cartoon or animal faces: run scripts/lipsync-proof.ts on three styles first.
  'sync-lipsync-v2': { label: 'Sync Lipsync 2.0', endpoint: 'fal-ai/sync-lipsync/v2', pricePerSec: 0.05 },
} as const
export type LipsyncModelId = keyof typeof LIPSYNC_MODELS
export const DEFAULT_LIPSYNC_MODEL: LipsyncModelId = 'sync-lipsync-v2'
export const lipsyncCostUsd = (model: LipsyncModelId, seconds: number) => Math.round(seconds * LIPSYNC_MODELS[model].pricePerSec * 100) / 100

/** One clip per shot: its length is the model's clip length that covers the shot (5 or 10 s). */
export type PlannedShot = { n: number; seconds: number }
export function planShotClips(shots: { n: number; durationSec: number }[], model: VideoModelId): PlannedShot[] {
  return shots.map((s) => ({ n: s.n, seconds: clipSeconds(model, s.durationSec) }))
}

/** Estimated cost of a planned reel's video, for the wizard and the dashboard. */
export function plannedVideoCostUsd(plan: PlannedShot[], model: VideoModelId): number {
  return Math.round(plan.reduce((sum, p) => sum + videoCostUsd(model, p.seconds), 0) * 100) / 100
}

/**
 * What this episode may spend on video: every planned clip, unless the money left under the series cost cap (keeping
 * `reserveUsd` for tokens, images and voice) cannot pay for them. Returns whole seconds the cap allows; the orchestrator stops
 * the episode when that is less than the plan needs, because there is no cheaper way to make a shot.
 */
export function episodeVideoAllowance(opts: { model: VideoModelId; capUsd: number; spentUsd: number; reserveUsd?: number }): number {
  const left = Math.max(0, opts.capUsd - opts.spentUsd - (opts.reserveUsd ?? 0.15))
  return Math.floor(left / VIDEO_MODELS[opts.model].pricePerSec / 5) * 5
}
