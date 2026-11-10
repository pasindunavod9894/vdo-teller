'use client'
import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { ASPECTS, ASPECT_LABEL, sizeFor, type Aspect } from '@/engine/aspect'

export type ExportInfo = Partial<Record<Aspect, { status: 'rendering' | 'ready' | 'failed'; error?: string }>>

/** Export one episode in another aspect ratio. The main format is the video itself; the others are rendered on request. */
/** Every video is made vertical, so the main format is fixed. */
const MAIN: Aspect = '9:16'

export function ExportMenu({ episodeId, initial }: { episodeId: number | string; initial: ExportInfo }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<ExportInfo>(initial)
  const [err, setErr] = useState('')
  const rendering = Object.values(info).some((e) => e?.status === 'rendering')

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/episodes/${episodeId}/export`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setInfo((await res.json()).exports ?? {})
  }, [episodeId])

  // while something renders, look again every few seconds
  useEffect(() => {
    if (!rendering) return
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [rendering, refresh])

  async function start(aspect: Aspect) {
    setErr('')
    setInfo((i) => ({ ...i, [aspect]: { status: 'rendering' } }))
    const res = await fetch(`/api/episodes/${episodeId}/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aspect }) })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Could not start the export'); refresh() }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:border-accent">
        {rendering ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Export
      </button>
      {open && (
        <div className="absolute left-0 z-10 mt-2 w-72 rounded-xl border border-border bg-card p-2 shadow-xl">
          {ASPECTS.map((a) => {
            const e = info[a]
            const { width, height } = sizeFor(a)
            const isMain = a === MAIN
            const ready = isMain || e?.status === 'ready'
            return (
              <div key={a} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{a}</span> <span className="text-xs text-muted-foreground">{ASPECT_LABEL[a]} · {width}×{height}</span>
                  {isMain && <span className="ml-1 rounded-full bg-accent/20 px-2 text-[10px] text-accent">main</span>}
                  {e?.status === 'failed' && <span className="block text-[11px] text-destructive">{e.error || 'Failed'}</span>}
                </span>
                {ready ? (
                  <a href={`/api/episodes/${episodeId}/video?${isMain ? '' : `aspect=${encodeURIComponent(a)}&`}download=1`} className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">Download</a>
                ) : e?.status === 'rendering' ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Rendering</span>
                ) : (
                  <button onClick={() => start(a)} disabled={rendering} className="rounded-full border border-border px-3 py-1 text-xs hover:border-accent disabled:opacity-50">{e?.status === 'failed' ? 'Retry' : 'Render'}</button>
                )}
              </div>
            )
          })}
          {err && <p className="px-3 pb-1 pt-1 text-xs text-destructive">{err}</p>}
        </div>
      )}
    </div>
  )
}
