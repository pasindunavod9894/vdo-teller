'use client'
import { useEffect, useState } from 'react'
import { Lock, Play, Sparkles } from 'lucide-react'
import { FREQUENCY_LABEL, formatCountdown, nextState, type Frequency } from '@/lib/schedule'

export function NextEpisodeCard({ frequency, lastEpisodeAt }: { frequency: Frequency; lastEpisodeAt: string | null }) {
  const last = lastEpisodeAt ? new Date(lastEpisodeAt) : null
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const s = now ? nextState(frequency, last, now) : null
  const locked = s?.state === 'locked'

  return (
    <div className={`relative flex aspect-[9/16] max-h-80 flex-col items-center justify-center gap-3 overflow-hidden rounded-[var(--radius)] border p-5 text-center ${locked ? 'border-dashed border-border bg-card/50' : 'border-accent bg-card'}`}>
      <div className={`grid size-12 place-items-center rounded-full ${locked ? 'bg-muted text-muted-foreground' : 'bg-accent text-accent-foreground'}`}>
        {locked ? <Lock className="size-5" /> : <Sparkles className="size-5" />}
      </div>
      <div className="font-heading font-semibold">{s?.state === 'first' ? 'First episode' : locked ? 'Next episode' : 'Ready to generate'}</div>
      <p className="text-xs text-muted-foreground">
        {locked && s ? <>Unlocks in <span className="font-mono text-foreground">{formatCountdown(s.remainingMs)}</span><br />Posting {FREQUENCY_LABEL[frequency]}</> : `Posting ${FREQUENCY_LABEL[frequency]}`}
      </p>
      <button disabled title="Video generation arrives with the next release" className="flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40">
        <Play className="size-4" /> Generate
      </button>
      <p className="text-[11px] text-muted-foreground">Generation is coming soon.</p>
    </div>
  )
}
