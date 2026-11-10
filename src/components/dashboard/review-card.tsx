'use client'
import { useState } from 'react'
import { motion } from 'motion/react'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import type { ReviewData } from './episode-types'

/** A thumbnail of one shot's keyframe. Quietly leaves out the picture when there is none. */
export function KeyframeThumb({ episodeId, shot, caption, className = 'w-20' }: { episodeId: number | string; shot: number; caption?: string; className?: string }) {
  const [missing, setMissing] = useState(false)
  return (
    <figure className={`shrink-0 ${className}`}>
      <div className="aspect-[9/16] overflow-hidden rounded-md bg-muted/40">
        {!missing && /* eslint-disable-next-line @next/next/no-img-element */ (
          <img src={`/api/episodes/${episodeId}/keyframe?shot=${shot}`} alt={`Shot ${shot}${caption ? `: ${caption}` : ''}`} loading="lazy" onError={() => setMissing(true)} className="size-full object-cover" />
        )}
      </div>
      <figcaption className="mt-1 truncate text-[11px] text-muted-foreground">{shot}{caption ? ` · ${caption}` : ''}</figcaption>
    </figure>
  )
}

const usd = (n: number) => `$${n.toFixed(2)}`

/** A video that paused after the story and the pictures: read it, then make the video or ask for another idea. */
export function ReviewCard({ episodeId, data, onApproved, onNewIdea }: {
  episodeId: number | string; data: ReviewData
  onApproved: () => void; onNewIdea: (newEpisodeId: number | string) => void
}) {
  const [busy, setBusy] = useState<'approve' | 'new-idea' | null>(null)
  const [err, setErr] = useState('')

  async function send(action: 'approve' | 'new-idea') {
    setBusy(action); setErr('')
    try {
      const res = await fetch(`/api/episodes/${episodeId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Something went wrong')
      if (action === 'approve') onApproved(); else onNewIdea(json.episodeId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
      setBusy(null)
    }
  }

  const { idea } = data
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-label="Review before video"
      className="space-y-4 rounded-[var(--radius)] border border-accent bg-card p-5">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-accent">Waiting for your review</div>
        <h3 className="font-heading mt-1 text-xl font-semibold">{data.title || `Episode ${episodeId}`}</h3>
        {idea?.premise && <p className="mt-1 text-sm text-foreground/90">{idea.premise}</p>}
        <dl className="mt-2 space-y-1 text-sm">
          {idea?.hook && <div><dt className="inline font-medium">Hook: </dt><dd className="inline text-muted-foreground">{idea.hook}</dd></div>}
          {idea?.emotionalCore && <div><dt className="inline font-medium">Emotional core: </dt><dd className="inline text-muted-foreground">{idea.emotionalCore}</dd></div>}
        </dl>
      </div>

      {data.beats.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-sm font-medium">The script</h4>
          <ol className="space-y-1.5 text-sm">
            {data.beats.map((b) => (
              <li key={b.n} className="flex gap-2.5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] text-muted-foreground">{b.n}</span>
                <div className="min-w-0">
                  <span className="text-muted-foreground">{b.action}</span>
                  {b.line && <div><span className="font-medium">{b.speaker ?? 'Narrator'}:</span> “{b.line}”</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.shots.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-sm font-medium">The pictures each shot starts from</h4>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.shots.map((s) => <KeyframeThumb key={s.n} episodeId={episodeId} shot={s.n} caption={s.caption} />)}
          </div>
        </div>
      )}

      {data.otherIdeas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Other ideas the Creator had: {data.otherIdeas.map((i) => i.title + (i.premise ? ` (${i.premise})` : '')).join('; ')}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        {usd(data.costUsd)} spent so far (the story and the pictures). Making the video costs about {usd(data.videoEstimateUsd)}.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => send('approve')} disabled={busy !== null} className="flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50">
          {busy === 'approve' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Play className="size-4" />} Make the video
        </button>
        <button onClick={() => send('new-idea')} disabled={busy !== null} className="flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-50">
          {busy === 'new-idea' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-4" />} Try another idea
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Trying another idea drops this one and starts a new story. It does not use an extra video from today&apos;s limit.</p>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    </motion.section>
  )
}
