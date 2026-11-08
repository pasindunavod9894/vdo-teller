import { describe, expect, it } from 'vitest'
import { dailyCapUsd, findDue, runDueSeries, type SchedulerDeps, type SeriesRow } from '@/pipeline/scheduler'

const NOW = new Date('2026-11-10T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000)
const row = (id: number, over: Partial<SeriesRow> = {}): SeriesRow => ({ id, ownerId: 1, frequency: 'daily', spentUsd: 0, costCapUsd: 5, ...over })

function deps(over: Partial<SchedulerDeps> & { series?: SeriesRow[]; last?: Record<number, Date | null>; running?: number[]; spent?: Record<number, number> } = {}) {
  const calls: string[] = []
  const d: SchedulerDeps = {
    activeSeries: async () => over.series ?? [],
    lastEpisodeAt: async (id) => over.last?.[Number(id)] ?? null,
    hasRunning: async (id) => (over.running ?? []).includes(Number(id)),
    spentSince: async (owner) => over.spent?.[Number(owner)] ?? 0,
    start: over.start ?? (async (s) => { calls.push(`start:${s.id}`); return { episodeId: Number(s.id) * 100 } }),
    execute: over.execute ?? (async (id) => { calls.push(`run:${id}`); return { status: 'done', costUsd: 0 } }),
  }
  return { d, calls }
}

describe('scheduler', () => {
  it('a series with no episode yet is due; one inside its interval is locked; one past it is due again (a missed run)', async () => {
    const { d } = deps({ series: [row(1), row(2), row(3)], last: { 1: null, 2: hoursAgo(5), 3: hoursAgo(80) } })
    const r = await findDue(d, NOW)
    expect(r.due.map((s) => s.id)).toEqual([1, 3])
    expect(r.skipped).toEqual([{ seriesId: 2, reason: 'locked' }])
    expect(r.checked).toBe(3)
  })

  it('respects each series frequency', async () => {
    const { d } = deps({ series: [row(1, { frequency: 'weekly' }), row(2, { frequency: '3-per-week' })], last: { 1: hoursAgo(100), 2: hoursAgo(100) } })
    expect((await findDue(d, NOW)).due.map((s) => s.id)).toEqual([2]) // 100 h: past 3-per-week (56 h), before weekly (168 h)
  })

  it('never starts a series that is already running, over its own cap, or whose user hit the daily cap', async () => {
    const { d } = deps({
      series: [row(1), row(2, { spentUsd: 5 }), row(3, { ownerId: 9 }), row(4)], running: [1],
      spent: { 9: 12 },
    })
    const r = await findDue(d, NOW, 10)
    expect(r.due.map((s) => s.id)).toEqual([4])
    expect(r.skipped).toEqual([{ seriesId: 1, reason: 'running' }, { seriesId: 2, reason: 'series-cap' }, { seriesId: 3, reason: 'daily-cap' }])
  })

  it('reads a user\'s daily spend once per tick', async () => {
    let reads = 0
    const { d } = deps({ series: [row(1), row(2), row(3)] })
    d.spentSince = async () => { reads++; return 0 }
    await findDue(d, NOW)
    expect(reads).toBe(1)
  })

  it('starts and runs due series one after the other, up to the limit per tick', async () => {
    const { d, calls } = deps({ series: [row(1), row(2), row(3)] })
    const r = await runDueSeries(d, { now: NOW, maxPerTick: 2 })
    expect(calls).toEqual(['start:1', 'run:100', 'start:2', 'run:200'])
    expect(r.started.map((s) => s.seriesId)).toEqual([1, 2])
    expect(r.skipped).toEqual([{ seriesId: 3, reason: 'limit' }])
  })

  it('one series being refused or failing does not stop the next', async () => {
    const { d } = deps({
      series: [row(1), row(2)],
      start: async (s) => { if (s.id === 1) throw new Error('The cost cap for this series is reached.'); return { episodeId: 7 } },
    })
    const r = await runDueSeries(d, { now: NOW, maxPerTick: 5 })
    expect(r.skipped[0].reason).toMatch(/^refused: The cost cap/)
    expect(r.started).toEqual([{ seriesId: 2, episodeId: 7, outcome: 'done' }])
  })

  it('reports the outcome of each run, including a failed one', async () => {
    const { d } = deps({ series: [row(1)], execute: async () => ({ status: 'failed', reason: 'x', costUsd: 0 }) })
    expect((await runDueSeries(d, { now: NOW })).started[0].outcome).toBe('failed')
  })

  it('does nothing when no series is active', async () => {
    const r = await runDueSeries(deps().d, { now: NOW })
    expect(r).toEqual({ checked: 0, due: [], started: [], skipped: [] })
  })

  it('reads the daily cap from the environment, with a safe default', () => {
    expect(dailyCapUsd({})).toBe(10)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: '3.5' })).toBe(3.5)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: '0' })).toBe(0)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: 'abc' })).toBe(10)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: '' })).toBe(10)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: '-4' })).toBe(10)
  })
})
