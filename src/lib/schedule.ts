export type Frequency = 'daily' | 'every-2-days' | '3-per-week' | 'weekly'

const HOUR = 3600_000
export const INTERVAL_MS: Record<Frequency, number> = {
  daily: 24 * HOUR,
  'every-2-days': 48 * HOUR,
  '3-per-week': Math.round((7 * 24 * HOUR) / 3),
  weekly: 7 * 24 * HOUR,
}

/** First episode is due immediately; afterwards one interval after the last episode (plan §7). */
export function nextEpisodeAt(frequency: Frequency, lastEpisodeAt: Date | null): Date | null {
  if (!lastEpisodeAt) return null
  return new Date(lastEpisodeAt.getTime() + (INTERVAL_MS[frequency] ?? INTERVAL_MS.daily))
}

export type NextState = { state: 'first' | 'ready' | 'locked'; at: Date | null; remainingMs: number }

export function nextState(frequency: Frequency, lastEpisodeAt: Date | null, now = new Date()): NextState {
  const at = nextEpisodeAt(frequency, lastEpisodeAt)
  if (!at) return { state: 'first', at: null, remainingMs: 0 }
  const remainingMs = at.getTime() - now.getTime()
  return remainingMs <= 0 ? { state: 'ready', at, remainingMs: 0 } : { state: 'locked', at, remainingMs }
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: 'every day', 'every-2-days': 'every 2 days', '3-per-week': '3 times a week', weekly: 'once a week',
}
