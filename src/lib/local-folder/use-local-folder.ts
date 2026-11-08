'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkFolder, classifyFolderError, localVideoUrl, openSeriesDir, ROOT_NAME, slugify, syncEpisodes, type DirLike, type SyncEpisode } from './folder'
import { forgetHandle, loadHandle, saveHandle } from './handles'

export type FolderStatus = 'checking' | 'unsupported' | 'no-folder' | 'needs-permission' | 'connected' | 'missing'

type Picker = (o?: { id?: string; mode?: 'readwrite' }) => Promise<DirLike>
const picker = (): Picker | null => (typeof window !== 'undefined' && 'showDirectoryPicker' in window ? ((window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker.bind(window)) : null)

async function post(seriesId: number | string, action: string) {
  const res = await fetch(`/api/series/${seriesId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not update the series')
}

/** Everything the dashboard needs from the local folder: its state, choosing/reconnecting, syncing videos and local playback URLs. */
export function useLocalFolder(opts: { seriesId: number | string; title: string; episodes: (SyncEpisode & { id: number | string })[]; onLinked?: () => void }) {
  const { seriesId, title } = opts
  const [status, setStatus] = useState<FolderStatus>('checking')
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({})
  const dirRef = useRef<DirLike | null>(null)
  const onLinked = useRef(opts.onLinked)
  useEffect(() => { onLinked.current = opts.onLinked })

  // what is in the library that should be on disk: re-sync only when a finished video is added
  const episodes = opts.episodes
  const syncKey = useMemo(() => episodes.filter((e) => e.hasVideo).map((e) => `${e.id}:${(e.exports ?? []).join('+')}`).join(','), [episodes])

  const inspect = useCallback(async () => {
    if (!picker()) { setStatus('unsupported'); return }
    const dir = await loadHandle(seriesId)
    if (!dir) { dirRef.current = null; setStatus('no-folder'); return }
    dirRef.current = dir
    const c = await checkFolder(dir)
    setStatus(c === 'ok' ? 'connected' : c === 'missing' ? 'missing' : c === 'needs-permission' ? 'needs-permission' : 'no-folder')
  }, [seriesId])

  useEffect(() => { inspect() }, [inspect])

  const choose = useCallback(async () => {
    const pick = picker()
    if (!pick) { setStatus('unsupported'); return }
    setError('')
    try {
      const picked = await pick({ id: 'vdo-teller', mode: 'readwrite' })
      const dir = await openSeriesDir(picked, title)
      if (!(await saveHandle(seriesId, dir))) throw new Error('This browser would not remember the folder (is private browsing on?).')
      await post(seriesId, 'link-folder')
      dirRef.current = dir
      setStatus('connected')
      onLinked.current?.()
    } catch (e) {
      const k = classifyFolderError(e)
      if (k !== 'cancelled') setError(k === 'denied' ? 'Access to that folder was refused.' : e instanceof Error ? e.message : 'Could not use that folder.')
    }
  }, [seriesId, title])

  const reconnect = useCallback(async () => {
    const dir = dirRef.current
    if (!dir?.requestPermission) return
    try {
      const p = await dir.requestPermission({ mode: 'readwrite' })
      if (p === 'granted') await inspect()
      else setError('Access to the folder was not granted.')
    } catch { setError('Could not reconnect the folder.') }
  }, [inspect])

  const forget = useCallback(async () => { await forgetHandle(seriesId); dirRef.current = null; setStatus('no-folder') }, [seriesId])

  // copy finished videos into the folder, then point the library at the local copies
  useEffect(() => {
    const dir = dirRef.current
    if (status !== 'connected' || !dir) return
    let cancelled = false
    const urls: string[] = []
    ;(async () => {
      setSyncing(true)
      try {
        const r = await syncEpisodes(dir, episodes, (id, aspect) => fetch(`/api/episodes/${id}/video${aspect ? `?aspect=${encodeURIComponent(aspect)}` : ''}`))
        if (r.failed.length) setError(`${r.failed.length} video(s) could not be saved: ${r.failed[0].message}`)
        const next: Record<string, string> = {}
        for (const e of episodes) {
          if (!e.hasVideo) continue
          const u = await localVideoUrl(dir, e)
          if (u) { next[String(e.id)] = u; urls.push(u) }
        }
        if (!cancelled) setLocalUrls(next)
      } catch (e) {
        if (classifyFolderError(e) === 'missing') setStatus('missing')
        else if (!cancelled) setError('Could not save to the folder.')
      } finally {
        if (!cancelled) setSyncing(false)
      }
    })()
    return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `episodes` content is summarised by syncKey
  }, [status, syncKey])

  return { status, error, syncing, localUrls, choose, reconnect, forget, folderPath: `${ROOT_NAME}/${slugify(title)}` }
}
