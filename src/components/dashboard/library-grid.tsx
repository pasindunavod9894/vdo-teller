'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NextEpisodeCard } from './next-episode-card'
import { ProgressCard } from './progress-card'
import type { Frequency } from '@/lib/schedule'

export type EpisodeCard = { id: number | string; title: string; status: string; hook: string | null }

export function LibraryGrid({ seriesId, frequency, lastEpisodeAt, episodes, runningEpisodeId, autoStart }: {
  seriesId: number | string; frequency: Frequency; lastEpisodeAt: string | null
  episodes: EpisodeCard[]; runningEpisodeId: number | string | null; autoStart: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [runId, setRunId] = useState<number | string | null>(runningEpisodeId)
  // true from the moment a run starts until it finishes (disables the Generate button)
  const [active, setActive] = useState(runningEpisodeId !== null)
  const [err, setErr] = useState('')
  const started = useRef(false)

  const generate = useCallback(async () => {
    setActive(true); setErr('')
    try {
      const res = await fetch('/api/pipeline/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seriesId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not start the episode')
      setRunId(json.episodeId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the episode')
      setActive(false)
    }
  }, [seriesId])

  // The first video starts by itself right after signup (plan §Context step 11).
  useEffect(() => {
    if (!autoStart || started.current) return
    started.current = true
    router.replace(pathname)
    if (episodes.length === 0 && !runningEpisodeId) generate()
  }, [autoStart, episodes.length, runningEpisodeId, generate, router, pathname])

  return (
    <div className="space-y-4">
      {runId !== null && (
        <ProgressCard episodeId={runId} onFinished={() => { setActive(false); router.refresh() }} onDismiss={() => setRunId(null)} />
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {episodes.map((e) => (
          <div key={e.id} className="flex aspect-[9/16] max-h-80 flex-col gap-1 rounded-[var(--radius)] border border-border bg-card p-3 text-sm">
            <div className="font-medium">{e.title || `Episode ${e.id}`}</div>
            <div className="text-xs text-muted-foreground">{e.status === 'done' ? 'Ready (practice run)' : e.status}</div>
            {e.hook && <p className="mt-1 line-clamp-5 text-xs text-muted-foreground">{e.hook}</p>}
          </div>
        ))}
        <NextEpisodeCard frequency={frequency} lastEpisodeAt={lastEpisodeAt} onGenerate={generate} busy={active} />
      </div>
    </div>
  )
}
