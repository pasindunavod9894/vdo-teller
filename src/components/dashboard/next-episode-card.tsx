'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Lock, Play, Sparkles } from 'lucide-react'
import { formatCountdown } from '@/lib/daily-limit'

/** The Generate card. `left` / `limit` / `nextAt` come from the server (the daily limit, plan R1-C); the countdown runs here. */
export function NextEpisodeCard({
  left,
  limit,
  nextAt,
  onGenerate,
  onUnlocked,
  busy,
}: {
  left: number
  limit: number
  nextAt: string | null
  onGenerate: () => void
  onUnlocked: () => void
  busy: boolean
}) {
  const nextMs = nextAt ? new Date(nextAt).getTime() : null
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [])

  const remainingMs = now !== null && nextMs !== null ? nextMs - now : null
  // when the countdown reaches zero a slot has opened up, even before the page has asked the server again
  const opened = remainingMs !== null && remainingMs <= 0
  const leftNow = left > 0 ? left : opened ? 1 : 0
  const locked = leftNow === 0

  const told = useRef(false)
  useEffect(() => {
    if (left > 0 || !opened || told.current) return
    told.current = true
    onUnlocked()
  }, [left, opened, onUnlocked])

  return (
    <div
      className={`relative flex aspect-[9/16] max-h-80 flex-col items-center justify-center gap-3 overflow-hidden rounded-[var(--radius)] border p-5 text-center ${locked ? 'border-dashed border-border bg-card/50' : 'border-accent bg-card'}`}
    >
      <div
        className={`grid size-12 place-items-center rounded-full ${locked ? 'bg-muted text-muted-foreground' : 'bg-accent text-accent-foreground'}`}
      >
        {locked ? <Lock className="size-5" /> : <Sparkles className="size-5" />}
      </div>
      <div className="font-heading font-semibold">
        {locked ? 'Daily limit reached' : 'Generate a video'}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {locked ? (
          <>
            Next video available in{' '}
            <span className="font-mono text-foreground">
              {remainingMs !== null ? formatCountdown(remainingMs) : '…'}
            </span>
          </>
        ) : (
          `${leftNow} of ${limit} videos left today`
        )}
      </p>
      <button
        onClick={onGenerate}
        disabled={busy || locked}
        className="flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Play className="size-4" />
        )}{' '}
        Generate
      </button>
      <p className="text-[11px] text-muted-foreground">
        {limit} videos a day across all your series.
      </p>
    </div>
  )
}
