import 'server-only'
import type { Payload } from 'payload'
import type { User } from '@/payload-types'
import { openWorkspace } from '../media/workspace'
import { isAspect, type Aspect } from '../engine/aspect'
import { renderExport } from './exports'
import { PipelineError } from './payload-store'

export type ExportEntry = { status: 'rendering' | 'ready' | 'failed'; file?: string; error?: string; at: string }
export type ExportMap = Partial<Record<Aspect, ExportEntry>>

const STALE_MS = 30 * 60 * 1000
const idOf = (v: unknown) => (typeof v === 'object' && v ? (v as { id: string | number }).id : (v as string | number))

type Files = { master?: string; publish?: unknown; exports?: ExportMap; [k: string]: unknown }

async function load(payload: Payload, user: User, episodeId: string | number) {
  const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!episode || idOf(episode.owner) !== user.id) throw new PipelineError('Episode not found', 404)
  return { episode, files: (episode.files ?? {}) as Files }
}

const save = (payload: Payload, episodeId: string | number, files: Files) =>
  payload.update({ collection: 'episodes', id: episodeId, data: { files: files as never }, overrideAccess: true })

/** Marks the export as rendering and rejects bad requests. The caller then runs `executeExport`. */
export async function startExport(payload: Payload, user: User, episodeId: string | number, aspect: unknown) {
  if (!isAspect(aspect)) throw new PipelineError('Unknown format', 400)
  const { episode, files } = await load(payload, user, episodeId)
  if (episode.status !== 'done' || !files.master) throw new PipelineError('This episode has no video to export yet.', 409)
  const exports = { ...(files.exports ?? {}) }
  // one render at a time per episode (renders are heavy; also keeps the stored list consistent)
  for (const e of Object.values(exports)) {
    if (e?.status === 'rendering' && Date.now() - new Date(e.at).getTime() < STALE_MS) throw new PipelineError('Another export of this episode is still rendering.', 409)
  }
  exports[aspect] = { status: 'rendering', at: new Date().toISOString() }
  await save(payload, episode.id, { ...files, exports })
  return { aspect }
}

/** Renders the export and records the result. Never throws. */
export async function executeExport(payload: Payload, user: User, episodeId: string | number, aspect: Aspect) {
  let entry: ExportEntry
  try {
    const { episode, files } = await load(payload, user, episodeId)
    const file = await renderExport({ episodeDir: openWorkspace(episode.id, idOf(episode.series)).episodeDir, aspect, master: files.master as string })
    entry = { status: 'ready', file, at: new Date().toISOString() }
  } catch (e) {
    console.error('[export] failed:', e instanceof Error ? e.message : e)
    entry = { status: 'failed', error: (e instanceof Error ? e.message : 'Export failed').slice(0, 200), at: new Date().toISOString() }
  }
  const { files } = await load(payload, user, episodeId)
  await save(payload, episodeId, { ...files, exports: { ...(files.exports ?? {}), [aspect]: entry } }).catch(() => {})
  return entry
}

export async function getExports(payload: Payload, user: User, episodeId: string | number): Promise<ExportMap> {
  const { files } = await load(payload, user, episodeId)
  const out: ExportMap = {}
  for (const [a, e] of Object.entries(files.exports ?? {})) {
    // a render that died with the server must not show "rendering" forever
    out[a as Aspect] = e && e.status === 'rendering' && Date.now() - new Date(e.at).getTime() >= STALE_MS ? { status: 'failed', error: 'Timed out', at: e.at } : e
  }
  return out
}
