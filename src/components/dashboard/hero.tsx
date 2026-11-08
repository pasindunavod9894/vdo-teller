'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, Loader2 } from 'lucide-react'

export function Hero({ seriesId, title, tagline, chips, heroUrl, heroCost }: {
  seriesId: number | string; title: string; tagline?: string; chips: string[]; heroUrl: string | null; heroCost: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function makeBanner() {
    setBusy(true); setErr('')
    const res = await fetch('/api/series-hero', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seriesId }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(json.error || 'Something went wrong'); else router.refresh()
    setBusy(false)
  }

  return (
    <section className="relative overflow-hidden rounded-[var(--radius)] border border-border">
      <div className="absolute inset-0" style={{ background: 'linear-gradient(120deg, color-mix(in srgb, var(--accent) 35%, var(--background)), color-mix(in srgb, var(--accent2) 25%, var(--background)))' }} />
      {heroUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={heroUrl} alt="" className="absolute inset-0 size-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/55 to-transparent" />
      <div className="relative flex min-h-64 flex-col justify-end gap-3 p-6 pt-16 sm:p-10">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        {tagline && <p className="max-w-xl text-lg text-foreground/80">{tagline}</p>}
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => <span key={c} className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs backdrop-blur">{c}</span>)}
        </div>
      </div>
      {!heroUrl && (
        <button onClick={makeBanner} disabled={busy} className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 text-xs backdrop-blur hover:bg-background disabled:opacity-60">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />} Generate banner (≈ ${heroCost.toFixed(2)})
        </button>
      )}
      {err && <p className="relative px-6 pb-3 text-xs text-destructive sm:px-10">{err}</p>}
    </section>
  )
}
