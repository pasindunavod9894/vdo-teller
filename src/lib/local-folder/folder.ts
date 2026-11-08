/**
 * The local video folder (plan §6): logic written against small interfaces, so it runs on the browser's File System
 * Access API and in tests with an in-memory folder. Nothing here touches the network except the `download` it is given.
 */
export type WritableLike = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
export type FileLike = { getFile(): Promise<File>; createWritable(): Promise<WritableLike> }
export type Permission = 'granted' | 'denied' | 'prompt'
export type DirLike = {
  name: string
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirLike>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileLike>
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>
  queryPermission?(d: { mode: 'readwrite' }): Promise<Permission>
  requestPermission?(d: { mode: 'readwrite' }): Promise<Permission>
}

export const ROOT_NAME = 'VDO Teller'

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'series'

/** The folder for one series: `VDO Teller/<series-slug>/` inside the folder the user picked (an existing "VDO Teller" folder is reused). */
export async function openSeriesDir(picked: DirLike, title: string): Promise<DirLike> {
  const root = picked.name === ROOT_NAME ? picked : await picked.getDirectoryHandle(ROOT_NAME, { create: true })
  return root.getDirectoryHandle(slugify(title), { create: true })
}

export const episodeFileName = (ep: { id: number | string; title: string }) => `episode-${ep.id}-${slugify(ep.title || 'episode')}.mp4`

export type FolderErrorKind = 'missing' | 'denied' | 'cancelled' | 'other'
export function classifyFolderError(e: unknown): FolderErrorKind {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotFoundError') return 'missing'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'AbortError') return 'cancelled'
  return 'other'
}

export type FolderCheck = 'ok' | 'missing' | 'needs-permission' | 'error'

/** Is the saved folder still there and can we write to it? A deleted folder reports 'missing'. */
export async function checkFolder(dir: DirLike): Promise<FolderCheck> {
  try {
    const perm = (await dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
    if (perm !== 'granted') return 'needs-permission'
    await dir.values()[Symbol.asyncIterator]().next() // throws NotFoundError when the folder was deleted
    return 'ok'
  } catch (e) {
    const k = classifyFolderError(e)
    return k === 'missing' ? 'missing' : k === 'denied' ? 'needs-permission' : 'error'
  }
}

export async function listVideos(dir: DirLike): Promise<Set<string>> {
  const names = new Set<string>()
  for await (const e of dir.values()) if (e.kind === 'file' && e.name.endsWith('.mp4')) names.add(e.name)
  return names
}

export type SyncEpisode = { id: number | string; title: string; hasVideo: boolean; meta?: unknown }
export type SyncResult = { saved: (number | string)[]; failed: { id: number | string; message: string }[] }

/**
 * Copies every finished episode that is not in the folder yet, one at a time. A file is only visible once it is fully
 * written (the browser commits on close), so an interrupted download never leaves a broken video behind.
 */
export async function syncEpisodes(dir: DirLike, episodes: SyncEpisode[], download: (id: number | string) => Promise<Response>): Promise<SyncResult> {
  const have = await listVideos(dir)
  const result: SyncResult = { saved: [], failed: [] }
  for (const ep of episodes) {
    if (!ep.hasVideo || have.has(episodeFileName(ep))) continue
    let out: WritableLike | null = null
    try {
      const res = await download(ep.id)
      if (!res.ok || !res.body) throw new Error(`The server answered ${res.status}`)
      out = await (await dir.getFileHandle(episodeFileName(ep), { create: true })).createWritable()
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await out.write(value)
      }
      await out.close()
      out = null
      if (ep.meta !== undefined) {
        const meta = await (await dir.getFileHandle(`episode-${ep.id}-${slugify(ep.title || 'episode')}.json`, { create: true })).createWritable()
        await meta.write(new TextEncoder().encode(JSON.stringify(ep.meta, null, 2)))
        await meta.close()
      }
      result.saved.push(ep.id)
    } catch (e) {
      await out?.abort?.().catch(() => {})
      if (classifyFolderError(e) === 'missing') throw e // the whole folder is gone: let the caller handle that
      result.failed.push({ id: ep.id, message: e instanceof Error ? e.message : 'Could not save' })
    }
  }
  return result
}

/** A playable URL for an episode that is already in the folder, or null. */
export async function localVideoUrl(dir: DirLike, ep: { id: number | string; title: string }): Promise<string | null> {
  try {
    return URL.createObjectURL(await (await dir.getFileHandle(episodeFileName(ep))).getFile())
  } catch {
    return null
  }
}
