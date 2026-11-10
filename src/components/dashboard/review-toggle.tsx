'use client'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'

/** The series setting "Review before video": pause after the story and the pictures so the user can approve or ask for another idea. */
export function ReviewToggle({ seriesId, initial }: { seriesId: number | string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function toggle() {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/series/${seriesId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: on ? 'review-off' : 'review-on' }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not change this setting')
      setOn(Boolean(json.reviewBeforeVideo))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not change this setting')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-border bg-card p-4">
      <div>
        <div id="review-toggle-label" className="text-sm font-medium">Review before video</div>
        <p id="review-toggle-help" className="mt-0.5 text-xs text-muted-foreground">
          Pause after the story and the pictures, before any video is paid for, so you can approve it or ask for a different idea. Off by default.
        </p>
        {err && <p role="alert" className="mt-1 text-xs text-destructive">{err}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
        <button type="button" role="switch" aria-checked={on} aria-labelledby="review-toggle-label" aria-describedby="review-toggle-help" onClick={toggle} disabled={busy}
          className={`relative h-6 w-11 rounded-full border border-border transition-colors motion-reduce:transition-none disabled:opacity-60 ${on ? 'bg-accent' : 'bg-muted'}`}>
          <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${on ? 'translate-x-5' : ''}`} />
        </button>
      </div>
    </div>
  )
}
