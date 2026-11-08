'use client'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, Check, Circle, Loader2, X } from 'lucide-react'

type Step = { key: string; agent: string; label: string; status: 'pending' | 'running' | 'done' | 'failed'; summary: string }
type Progress = { episode: { id: number | string; status: string; title: string | null; error: string | null; costUsd: number; mode: string | null }; steps: Step[] }

export function ProgressCard({ episodeId, onFinished, onDismiss }: { episodeId: number | string; onFinished: () => void; onDismiss: () => void }) {
  const [data, setData] = useState<Progress | null>(null)
  const [err, setErr] = useState('')
  const finished = useRef(false)

  useEffect(() => {
    finished.current = false
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const res = await fetch(`/api/pipeline/progress?episodeId=${episodeId}`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Could not read progress')
        if (stop) return
        setData(json); setErr('')
        if (json.episode.status !== 'running') {
          if (!finished.current) { finished.current = true; onFinished() }
          return
        }
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : 'Could not read progress')
      }
      if (!stop) timer = setTimeout(poll, 1000)
    }
    poll()
    return () => { stop = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  const status = data?.episode.status ?? 'running'
  const done = data?.steps.filter((s) => s.status === 'done').length ?? 0
  const total = data?.steps.length || 9
  const title = status === 'done' ? 'Episode ready' : status === 'running' ? 'Making your episode…' : status === 'needs-review' ? 'Needs a look' : 'Something went wrong'

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-live="polite" aria-label="Episode progress"
      className="rounded-[var(--radius)] border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">
            {data?.episode.title && data.episode.title !== 'New episode' ? `“${data.episode.title}” · ` : ''}{done}/{total} steps
            {data?.episode.mode === 'mock' && ' · practice run (no media is generated yet)'}
          </p>
        </div>
        {status !== 'running' && (
          <button onClick={onDismiss} aria-label="Dismiss" className="rounded-full p-1.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div className="h-full bg-accent" animate={{ width: `${(done / total) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </div>
      <ol className="mt-4 space-y-2.5">
        {(data?.steps ?? []).map((s) => (
          <li key={s.key} className="flex gap-3">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
              {s.status === 'done' ? (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid size-5 place-items-center rounded-full bg-accent text-accent-foreground"><Check className="size-3.5" /></motion.span>
              ) : s.status === 'running' ? <Loader2 className="size-5 animate-spin text-accent" />
              : s.status === 'failed' ? <AlertTriangle className="size-5 text-destructive" />
              : <Circle className="size-4 text-muted-foreground/50" />}
            </span>
            <div className="min-w-0">
              <div className={`text-sm ${s.status === 'pending' ? 'text-muted-foreground' : ''}`}><span className="font-medium">{s.agent}</span> <span className="text-muted-foreground">· {s.label}</span></div>
              <AnimatePresence>
                {s.summary && s.status !== 'pending' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className={`text-xs ${s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{s.summary}</motion.div>
                )}
              </AnimatePresence>
            </div>
          </li>
        ))}
        {!data && !err && <li className="text-sm text-muted-foreground">Starting…</li>}
      </ol>
      {data?.episode.error && <p className="mt-3 text-sm text-destructive">{data.episode.error}</p>}
      {err && <p className="mt-3 text-xs text-destructive">{err}</p>}
      {status === 'done' && <p className="mt-3 text-xs text-muted-foreground">Cost: ${data?.episode.costUsd.toFixed(3)}</p>}
    </motion.section>
  )
}
