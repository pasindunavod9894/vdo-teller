/**
 * The daily limit (plan R1-C): a user can make up to 3 videos in any 24 hours, across all of their series. There is no
 * schedule any more: the user presses Generate when they want a video, and the card says how many are left today.
 * Pure functions, so the rule is easy to test.
 */
export const DAILY_VIDEO_LIMIT = 3
export const DAY_MS = 24 * 3600_000

export type DailyState = {
  used: number
  limit: number
  left: number
  /** when the next video can be made; null while at least one is left */
  nextAt: Date | null
}

/** From the creation times of the user's episodes in the last day (episodes that failed are not counted, so a failed run can be retried). */
export function dailyState(createdAt: Date[], now = new Date(), limit = DAILY_VIDEO_LIMIT): DailyState {
  const recent = createdAt.filter((t) => now.getTime() - t.getTime() < DAY_MS).sort((a, b) => a.getTime() - b.getTime())
  const used = recent.length
  // the slot that frees up first is the one of the oldest episode among the `limit` newest ones
  const nextAt = used >= limit ? new Date(recent[used - limit].getTime() + DAY_MS) : null
  return { used, limit, left: Math.max(0, limit - used), nextAt }
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

/** The user's spending limit per day in USD (env DAILY_COST_CAP_USD, default 15: three reels at the default model with room for retries). */
export function dailyCapUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.DAILY_COST_CAP_USD)
  return Number.isFinite(n) && env.DAILY_COST_CAP_USD !== '' && env.DAILY_COST_CAP_USD !== undefined && n >= 0 ? n : 15
}
