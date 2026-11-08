'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pause, Play } from 'lucide-react'

/** Turns automatic generation on or off for a series (the Generate button on the next-episode card still works when it is off). */
export function AutoToggle({ seriesId, paused }: { seriesId: number | string; paused: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function toggle() {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/series/${seriesId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: paused ? 'resume' : 'pause' }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not change this')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not change this')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={toggle} disabled={busy} aria-pressed={!paused} title={paused ? 'Automatic generation is paused' : 'New episodes are generated automatically when due'}
        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50">
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        {paused ? 'Resume automatic episodes' : 'Automatic episodes: on'}
      </button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  )
}
