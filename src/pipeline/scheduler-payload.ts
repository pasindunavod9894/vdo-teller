import 'server-only'
import type { Payload } from 'payload'
import { executeEpisode, ownerSpentSince, startEpisode } from './payload-store'
import { runDueSeries, type SchedulerDeps, type SeriesRow, type TickReport } from './scheduler'
import type { Frequency } from '../lib/schedule'

const idOf = (v: unknown) => (typeof v === 'object' && v ? (v as { id: string | number }).id : (v as string | number))

/** The scheduler's database access: active series with a linked folder, their latest episodes, and spending. */
export function payloadSchedulerDeps(payload: Payload): SchedulerDeps {
  return {
    async activeSeries() {
      const { docs } = await payload.find({ collection: 'series', where: { and: [{ status: { equals: 'active' } }, { folderLinked: { equals: true } }] }, limit: 500, depth: 0, overrideAccess: true })
      return docs.map((s): SeriesRow => ({ id: s.id, ownerId: idOf(s.owner), frequency: s.frequency as Frequency, spentUsd: s.spentUsd ?? 0, costCapUsd: s.costCapUsd ?? 5 }))
    },
    async lastEpisodeAt(seriesId) {
      const { docs } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: seriesId } }, { status: { not_equals: 'failed' } }] }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
      return docs[0] ? new Date(docs[0].createdAt) : null
    },
    async hasRunning(seriesId) {
      const { totalDocs } = await payload.count({ collection: 'episodes', where: { and: [{ series: { equals: seriesId } }, { status: { equals: 'running' } }] }, overrideAccess: true })
      return totalDocs > 0
    },
    spentSince: (ownerId, since) => ownerSpentSince(payload, ownerId, since),
    async start(series) {
      const user = await payload.findByID({ collection: 'users', id: series.ownerId, depth: 0, overrideAccess: true })
      const { episodeId } = await startEpisode(payload, user, series.id)
      return { episodeId }
    },
    execute: (episodeId) => executeEpisode(payload, episodeId),
  }
}

let ticking = false

/** One scheduler pass. A second call while one is still running does nothing, so slow renders never pile up. */
export async function tick(payload: Payload, opts: { maxPerTick?: number } = {}): Promise<TickReport | { busy: true }> {
  if (ticking) return { busy: true }
  ticking = true
  try {
    return await runDueSeries(payloadSchedulerDeps(payload), { maxPerTick: opts.maxPerTick ?? (Number(process.env.SCHEDULER_MAX_PER_TICK) || 1) })
  } finally {
    ticking = false
  }
}
