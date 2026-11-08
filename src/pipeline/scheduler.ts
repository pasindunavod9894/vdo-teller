import { nextState, type Frequency } from '../lib/schedule'
import type { RunOutcome } from './orchestrator'

/**
 * The scheduler (plan §7): decides which series are due and starts their next episode, one at a time. It only knows
 * about the small `SchedulerDeps` below, so the same logic runs from the cron endpoint, the local ticker script and tests.
 * Guards: one run per series, the per-series cost cap, a per-user daily cost cap, and a limit of episodes per tick.
 */
export type SeriesRow = { id: number | string; ownerId: number | string; frequency: Frequency; spentUsd: number; costCapUsd: number }

export type SchedulerDeps = {
  /** series that are active (not paused, not removed) and have a folder linked */
  activeSeries(): Promise<SeriesRow[]>
  /** creation time of the series' latest episode that did not fail */
  lastEpisodeAt(seriesId: number | string): Promise<Date | null>
  hasRunning(seriesId: number | string): Promise<boolean>
  /** what the user's episodes cost since `since` */
  spentSince(ownerId: number | string, since: Date): Promise<number>
  /** creates the episode row (applies its own checks and may refuse) */
  start(series: SeriesRow): Promise<{ episodeId: number | string }>
  execute(episodeId: number | string): Promise<RunOutcome>
}

export type SkipReason = 'locked' | 'running' | 'series-cap' | 'daily-cap' | 'limit' | `refused: ${string}`
export type TickReport = {
  checked: number
  due: (number | string)[]
  started: { seriesId: number | string; episodeId: number | string; outcome: RunOutcome['status'] }[]
  skipped: { seriesId: number | string; reason: SkipReason }[]
}

export const DAY_MS = 24 * 3600_000

/** Daily spending limit per user in USD (env DAILY_COST_CAP_USD, default 10). */
export function dailyCapUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.DAILY_COST_CAP_USD)
  return Number.isFinite(n) && env.DAILY_COST_CAP_USD !== '' && env.DAILY_COST_CAP_USD !== undefined && n >= 0 ? n : 10
}

/** Series whose next episode is due now and that may spend more. Nothing is started here. */
export async function findDue(deps: SchedulerDeps, now: Date, dailyCap = dailyCapUsd()): Promise<{ due: SeriesRow[]; skipped: TickReport['skipped']; checked: number }> {
  const all = await deps.activeSeries()
  const due: SeriesRow[] = []
  const skipped: TickReport['skipped'] = []
  const daily = new Map<string, number>() // spend per user, read once per tick
  for (const s of all) {
    if (await deps.hasRunning(s.id)) { skipped.push({ seriesId: s.id, reason: 'running' }); continue }
    if (nextState(s.frequency, await deps.lastEpisodeAt(s.id), now).state === 'locked') { skipped.push({ seriesId: s.id, reason: 'locked' }); continue }
    if (s.spentUsd >= s.costCapUsd) { skipped.push({ seriesId: s.id, reason: 'series-cap' }); continue }
    const key = String(s.ownerId)
    if (!daily.has(key)) daily.set(key, await deps.spentSince(s.ownerId, new Date(now.getTime() - DAY_MS)))
    if ((daily.get(key) ?? 0) >= dailyCap) { skipped.push({ seriesId: s.id, reason: 'daily-cap' }); continue }
    due.push(s)
  }
  return { due, skipped, checked: all.length }
}

/** Starts the next episode of every due series, sequentially (rendering is heavy), up to `maxPerTick`. A missed run is made once, never backfilled. */
export async function runDueSeries(deps: SchedulerDeps, opts: { now?: Date; maxPerTick?: number; dailyCap?: number } = {}): Promise<TickReport> {
  const now = opts.now ?? new Date()
  const max = opts.maxPerTick ?? 1
  const { due, skipped, checked } = await findDue(deps, now, opts.dailyCap)
  const report: TickReport = { checked, due: due.map((s) => s.id), started: [], skipped }
  for (const s of due) {
    if (report.started.length >= max) { report.skipped.push({ seriesId: s.id, reason: 'limit' }); continue }
    try {
      const { episodeId } = await deps.start(s)
      const out = await deps.execute(episodeId)
      report.started.push({ seriesId: s.id, episodeId, outcome: out.status })
    } catch (e) {
      report.skipped.push({ seriesId: s.id, reason: `refused: ${e instanceof Error ? e.message : 'unknown'}`.slice(0, 120) as SkipReason })
    }
  }
  return report
}
