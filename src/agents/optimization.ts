import { QUALITY_FOR_TIER, type Quality } from '../lib/art/plan'

/**
 * The master switch for the Phase 13 token and cost savings (TOKEN_OPTIMIZATION=on). It is OFF by default, so a run
 * behaves like a plain pipeline: no output-token caps, full Writer rewrites, full-size vision images, medium image
 * quality for every tier, no reuse libraries for speech and clips, and no resume of a failed episode.
 *
 * When it is on, all of those savings apply (and OPENAI_FLEX=1 may add flex pricing for scheduled runs).
 *
 * The safety limits are NOT part of it and are always on: the per-episode ceiling, the per-series cap, the per-user
 * daily cap and the video-second budget.
 */
export function tokenOptimization(env: Record<string, string | undefined> = process.env): boolean {
  return ['on', '1', 'true', 'yes'].includes((env.TOKEN_OPTIMIZATION ?? '').trim().toLowerCase())
}

/** Image quality for plates and gate checks: follows the tier when optimizing, otherwise a flat medium. */
export function mediaQuality(tier: string, env: Record<string, string | undefined> = process.env): Quality {
  return tokenOptimization(env) ? (QUALITY_FOR_TIER[tier as keyof typeof QUALITY_FOR_TIER] ?? 'medium') : 'medium'
}
