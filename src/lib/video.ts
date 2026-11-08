/**
 * Video-model registry, cost maths and the hybrid-by-tier budget (plan §1b, §12).
 * Pure functions only, so the money logic is easy to test. Only models whose fal.ai schema has been verified are listed.
 */

export const VIDEO_MODELS = {
  // Verified on fal.ai: inputs image_url + prompt (+ duration "5"|"10", negative_prompt, cfg_scale, tail_image_url);
  // no aspect-ratio input (the output follows the still); output { video: { url } }.
  'kling-2.5-turbo': {
    label: 'Kling 2.5 Turbo (pro)',
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    durations: [5, 10] as readonly number[],
    /** fal.ai: $0.35 for 5 s, then $0.07 per extra second => $0.07 per second */
    pricePerSec: 0.07,
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

export type Tier = 'budget' | 'standard' | 'premium'

/** Share of an episode that is real video, per quality tier (plan: Budget 1-2 action shots, Standard ~40-50%, Premium mostly video). */
export const TIER_VIDEO_SHARE: Record<Tier, number> = { budget: 0.33, standard: 0.45, premium: 0.85 }
/** Budget never goes beyond two short clips. */
const BUDGET_MAX_SEC = 10

const roundTo5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)

/** Real-video seconds allowed for one episode of `episodeSec` seconds at the given tier. */
export function tierVideoSeconds(tier: Tier, episodeSec: number): number {
  const raw = roundTo5(episodeSec * TIER_VIDEO_SHARE[tier])
  return tier === 'budget' ? Math.min(BUDGET_MAX_SEC, raw) : raw
}

/**
 * What this episode may actually spend: the tier allowance, further limited by the money left under the series cost cap
 * (keeping `reserveUsd` for tokens, images and voice). Returns whole clip lengths only.
 */
export function episodeVideoAllowance(opts: { tier: Tier; episodeSec: number; model: VideoModelId; capUsd: number; spentUsd: number; reserveUsd?: number }): number {
  const tierSec = tierVideoSeconds(opts.tier, opts.episodeSec)
  const left = Math.max(0, opts.capUsd - opts.spentUsd - (opts.reserveUsd ?? 0.15))
  const affordable = Math.floor(left / VIDEO_MODELS[opts.model].pricePerSec / 5) * 5
  return Math.max(0, Math.min(tierSec, affordable))
}

export type ShotKind = 'establishing' | 'dialogue' | 'action' | 'subtle' | 'reaction' | 'info'

/** Shots worth paying for, best first. Dialogue and info shots are never sent to the video model: the engine owns voice sync and text. */
const PRIORITY: ShotKind[] = ['action', 'establishing', 'reaction', 'subtle']

export type PlannedShot = { n: number; render: 'engine' | 'video'; seconds: number }

/**
 * Chooses which shots get real video within `allowanceSec`. Greedy by priority, longest first within a priority;
 * a shot that does not fit in the remaining allowance stays on the engine.
 */
export function planVideoShots(shots: { n: number; type: ShotKind; durationSec: number }[], allowanceSec: number, model: VideoModelId): PlannedShot[] {
  const chosen = new Map<number, number>()
  let left = allowanceSec
  for (const kind of PRIORITY) {
    const pool = shots.filter((s) => s.type === kind).sort((a, b) => b.durationSec - a.durationSec)
    for (const s of pool) {
      const secs = clipSeconds(model, s.durationSec)
      if (secs <= left) { chosen.set(s.n, secs); left -= secs }
    }
  }
  return shots.map((s) => (chosen.has(s.n) ? { n: s.n, render: 'video' as const, seconds: chosen.get(s.n)! } : { n: s.n, render: 'engine' as const, seconds: 0 }))
}

/** Estimated cost of a planned episode's video, for the wizard and the dashboard. */
export function plannedVideoCostUsd(plan: PlannedShot[], model: VideoModelId): number {
  return Math.round(plan.reduce((sum, p) => sum + (p.render === 'video' ? videoCostUsd(model, p.seconds) : 0), 0) * 100) / 100
}
