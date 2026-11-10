'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react'
import { KeyframeThumb } from './review-card'
import type { QaData } from './episode-types'

/** "Needs a look" on a finished video: shots the vision check flagged, each with a paid "Fix shot" that asks first. */
export function QaFlags({ episodeId, data, onFixed }: { episodeId: number | string; data: QaData; onFixed: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  // the shot we just asked for, shown until the page data catches up with `files.fixing`
  const [asked, setAsked] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const fixingShot = data.fixing?.shot ?? asked

  // while a shot is being remade, look at the page data again every few seconds
  const fixingNow = useRef(data.fixing)
  const onFixedRef = useRef(onFixed)
  useEffect(() => { fixingNow.current = data.fixing; onFixedRef.current = onFixed })
  const asking = useRef(false) // true from the request until the page showed the remake or we gave up
  const waited = useRef(0) // refreshes since the request
  useEffect(() => {
    if (fixingShot === null) return
    const t = setInterval(() => {
      // asked a while ago but the page never showed the remake: it finished (or failed) quickly, so stop waiting
      waited.current += 1
      if (!fixingNow.current && asking.current && waited.current >= 4) { asking.current = false; setAsked(null); onFixedRef.current() }
      router.refresh()
    }, 5000)
    return () => clearInterval(t)
  }, [fixingShot, router])

  // when the remake ends, drop the local marker and let the player reload the video
  const wasFixing = useRef(false)
  useEffect(() => {
    if (data.fixing) { wasFixing.current = true; return }
    if (wasFixing.current) { wasFixing.current = false; asking.current = false; setAsked(null); onFixedRef.current() }
  }, [data.fixing])

  async function remake(shot: number) {
    setSending(true); setErr('')
    try {
      const res = await fetch(`/api/episodes/${episodeId}/fix-shot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shot, confirm: true }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not remake the shot')
      setConfirming(null); setAsked(shot); asking.current = true; waited.current = 0
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remake the shot')
    } finally { setSending(false) }
  }

  const price = (n: number) => `$${(data.estimates[n] ?? 0.5).toFixed(2)}`
  const fixError = data.fixError && fixingShot === null ? data.fixError : null

  return (
    <div className="space-y-1.5 text-xs">
      {data.flags.length > 0 && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-amber-500 hover:bg-amber-500/20">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" /> Needs a look
          <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}
      {fixingShot !== null && (
        <div role="status" className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Fixing shot {fixingShot}…</div>
      )}
      {fixError && <p role="alert" className="text-destructive">Could not fix the shot: {fixError}</p>}
      {open && (
        <ul className="space-y-2">
          {data.flags.map((f) => (
            <li key={f.shot} className="space-y-1.5 rounded-md border border-border p-2">
              <div className="flex gap-2">
                <KeyframeThumb episodeId={episodeId} shot={f.shot} className="w-12" />
                <div className="min-w-0">Shot {f.shot}: {f.issue} <span className="text-muted-foreground">({f.kind})</span></div>
              </div>
              {confirming === f.shot ? (
                <div className="space-y-1.5">
                  <p>Remake shot {f.shot}? It costs about {price(f.shot)} and takes a few minutes. The rest of the video stays as it is.</p>
                  <div className="flex gap-2">
                    <button onClick={() => remake(f.shot)} disabled={sending} className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-accent-foreground disabled:opacity-50">
                      {sending && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />} Remake it
                    </button>
                    <button onClick={() => setConfirming(null)} disabled={sending} className="rounded-full border border-border px-3 py-1 hover:border-accent disabled:opacity-50">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setConfirming(f.shot); setErr('') }} disabled={fixingShot !== null}
                  className="rounded-full border border-border px-3 py-1 hover:border-accent disabled:cursor-not-allowed disabled:opacity-50">Fix shot</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="text-destructive">{err}</p>}
    </div>
  )
}
