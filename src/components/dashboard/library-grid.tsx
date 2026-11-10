'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NextEpisodeCard } from './next-episode-card'
import { ProgressCard } from './progress-card'
import { FolderBar } from './folder-bar'
import { ExportMenu, type ExportInfo } from './export-menu'
import { ReviewCard } from './review-card'
import { QaFlags } from './qa-flags'
import type { QaData, ReviewData } from './episode-types'
import { useLocalFolder } from '@/lib/local-folder/use-local-folder'
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'

/** What the continuity check found across an episode's checked clips; null when nothing was checked. */
export type OnModel = { ok: boolean; /** the first problem, when not ok */ issue: string | null; /** a clip ended up off-model (not just flagged) */ drifted: boolean }
export type EpisodeCard = { id: number | string; title: string; status: string; hook: string | null; hasVideo: boolean; meta?: unknown; exports?: ExportInfo; onModel?: OnModel | null; /** the saved story and pictures of a video waiting for approval */ review?: ReviewData | null; /** flagged shots and the remake in progress */ qa?: QaData | null; /** a failed video: why, and what the retry button says */ failure?: { reason: string; label: string } | null }
const STATUS_LABEL: Record<string, string> = { 'awaiting-approval': 'Waiting for your review' }
/** The daily limit as the server computed it; `nextAt` is an ISO time or null while at least one video is left. */
export type Daily = { used: number; limit: number; left: number; nextAt: string | null }

function OnModelIndicator({ m }: { m: OnModel }) {
  if (m.ok) return <div className="flex items-center gap-1 text-xs text-emerald-500"><CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" /> Characters on-model</div>
  return (
    <div className={`flex items-start gap-1 text-xs ${m.drifted ? 'text-destructive' : 'text-amber-500'}`}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>Characters may be off-model{m.issue ? `: ${m.issue}` : ''}</span>
    </div>
  )
}

export function LibraryGrid({ seriesId, title, daily, episodes, runningEpisodeId, autoStart }: {
  seriesId: number | string; title: string; daily: Daily
  episodes: EpisodeCard[]; runningEpisodeId: number | string | null; autoStart: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [runId, setRunId] = useState<number | string | null>(runningEpisodeId)
  // true from the moment a run starts until it finishes (disables the Generate button)
  const [active, setActive] = useState(runningEpisodeId !== null)
  // bumps when the live progress card must start polling again (after an approval, even for the same episode)
  const [runKey, setRunKey] = useState(0)
  // episodes the user just approved: their review card goes away at once, before the page data catches up
  const [approved, setApproved] = useState<Set<string>>(new Set())
  // per-episode counter that changes the video URL after a shot was remade
  const [videoVer, setVideoVer] = useState<Record<string, number>>({})
  const [err, setErr] = useState('')
  // the failed video whose retry was just asked for
  const [retrying, setRetrying] = useState<string | null>(null)
  const started = useRef(false)
  const pendingAuto = useRef(false)

  const generate = useCallback(async () => {
    setActive(true); setErr('')
    try {
      const res = await fetch('/api/pipeline/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seriesId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not start the episode')
      setRunId(json.episodeId)
      router.refresh() // the new video counts against today's limit
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the episode')
      setActive(false)
    }
  }, [seriesId, router])

  const approve = useCallback((id: number | string) => {
    setApproved((s) => new Set(s).add(String(id)))
    setRunId(id); setRunKey((k) => k + 1); setActive(true); setErr('')
    router.refresh()
  }, [router])

  const newIdea = useCallback((newId: number | string) => {
    setRunId(newId); setRunKey((k) => k + 1); setActive(true); setErr('')
    router.refresh() // the dropped video leaves the review list
  }, [router])

  /** Runs a failed video again from the step where it stopped (the same video, what it already made is kept). */
  const retry = useCallback(async (id: number | string) => {
    setRetrying(String(id)); setErr('')
    try {
      const res = await fetch(`/api/episodes/${id}/retry`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not retry this video')
      setRunId(id); setRunKey((k) => k + 1); setActive(true)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not retry this video')
    }
    setRetrying(null)
  }, [router])

  const fixed = useCallback((id: number | string) => setVideoVer((v) => ({ ...v, [String(id)]: (v[String(id)] ?? 0) + 1 })), [])

  const refreshDaily = useCallback(() => router.refresh(), [router])

  // The folder where videos are saved. Generation starts only once it is chosen (plan §6).
  const folder = useLocalFolder({
    seriesId, title,
    episodes: episodes.map((e) => ({ ...e, exports: Object.entries(e.exports ?? {}).filter(([, v]) => v?.status === 'ready').map(([k]) => k) })),
    onLinked: () => { if (pendingAuto.current) { pendingAuto.current = false; generate() } },
  })

  // The first video starts by itself right after signup (plan §Context step 11), as soon as a folder is linked.
  useEffect(() => {
    if (!autoStart || started.current || folder.status === 'checking') return
    started.current = true
    router.replace(pathname)
    if (episodes.length > 0 || runningEpisodeId) return
    if (folder.status === 'connected' || folder.status === 'needs-permission') queueMicrotask(generate)
    else pendingAuto.current = true
  }, [autoStart, folder.status, episodes.length, runningEpisodeId, generate, router, pathname])

  const reviewing = episodes.filter((e) => e.status === 'awaiting-approval' && e.review && !approved.has(String(e.id)))
  const reviewIds = new Set(reviewing.map((e) => String(e.id)))
  const showProgress = runId !== null && !reviewIds.has(String(runId))

  return (
    <div className="space-y-4">
      <FolderBar seriesId={seriesId} status={folder.status} error={folder.error} syncing={folder.syncing} folderPath={folder.folderPath} onChoose={folder.choose} onReconnect={folder.reconnect} onForget={folder.forget} />
      {reviewing.map((e) => (
        <ReviewCard key={e.id} episodeId={e.id} data={e.review!} onApproved={() => approve(e.id)} onNewIdea={newIdea} />
      ))}
      {showProgress && (
        <ProgressCard key={`${runId}-${runKey}`} episodeId={runId} onFinished={() => { setActive(false); router.refresh() }} onDismiss={() => setRunId(null)}
          onRetry={() => retry(runId)} retrying={retrying === String(runId)} />
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {episodes.filter((e) => !reviewIds.has(String(e.id))).map((e) => (
          <div key={e.id} className="flex flex-col gap-1 rounded-[var(--radius)] border border-border bg-card p-3 text-sm">
            {e.hasVideo ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- captions are burned into the picture
              <video controls preload="metadata" playsInline className="aspect-[9/16] max-h-96 w-full rounded-md bg-black object-contain" src={folder.localUrls[String(e.id)] ?? `/api/episodes/${e.id}/video${videoVer[String(e.id)] ? `?v=${videoVer[String(e.id)]}` : ''}`} />
            ) : (
              <div className="flex aspect-[9/16] max-h-96 w-full items-center justify-center rounded-md bg-muted/40 px-2 text-center text-xs text-muted-foreground">
                {e.status === 'done' ? 'Practice run (no video file)' : (STATUS_LABEL[e.status] ?? e.status)}
              </div>
            )}
            <div className="font-medium">{e.title || `Episode ${e.id}`}</div>
            <div className="text-xs text-muted-foreground">{e.status === 'done' ? (e.hasVideo ? 'Ready' : 'Ready (practice run)') : (STATUS_LABEL[e.status] ?? e.status)}</div>
            {e.onModel && <OnModelIndicator m={e.onModel} />}
            {e.hasVideo && e.qa && <QaFlags episodeId={e.id} data={e.qa} onFixed={() => fixed(e.id)} />}
            {e.hasVideo && <ExportMenu episodeId={e.id} initial={e.exports ?? {}} />}
            {e.hook && !e.hasVideo && <p className="mt-1 line-clamp-5 text-xs text-muted-foreground">{e.hook}</p>}
            {e.failure && !(showProgress && String(e.id) === String(runId)) && (
              <div className="mt-1 space-y-2">
                {e.failure.reason && <p className="line-clamp-4 text-xs text-destructive" title={e.failure.reason}>{e.failure.reason}</p>}
                <button onClick={() => retry(e.id)} disabled={active || retrying !== null}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-60">
                  {retrying === String(e.id) ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <RotateCcw className="size-3.5" />}
                  {e.failure.label}
                </button>
              </div>
            )}
          </div>
        ))}
        <NextEpisodeCard left={daily.left} limit={daily.limit} nextAt={daily.nextAt} onGenerate={generate} onUnlocked={refreshDaily} busy={active} />
      </div>
    </div>
  )
}
