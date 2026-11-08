'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

type Item = { kind: string; name: string; done: boolean; url: string | null }
type Status = { hasReference: boolean; quality: string; costPerImage: number; spentUsd: number; capUsd: number; items: Item[] }
type Cast = { id: number | string; name: string; role: string; referenceUrl: string | null; canonical: string }

async function call(characterId: number | string, action: 'status' | 'reference' | 'next-asset') {
  const res = await fetch('/api/character-art', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId, action }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong')
  return json
}

function CharacterCard({ c }: { c: Cast }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [ref, setRef] = useState<string | null>(c.referenceUrl)
  const [canonical, setCanonical] = useState(c.canonical)
  const [busy, setBusy] = useState<'' | 'reference' | 'pack'>('')
  const [err, setErr] = useState('')
  const stop = useRef(false)

  const refresh = useCallback(() => call(c.id, 'status').then(setStatus).catch((e) => setErr(e.message)), [c.id])
  useEffect(() => { refresh() }, [refresh])

  async function makeReference() {
    setBusy('reference'); setErr('')
    try { const r = await call(c.id, 'reference'); setRef(r.url); setCanonical(r.canonicalDescription); await refresh() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    setBusy('')
  }

  async function buildPack() {
    setBusy('pack'); setErr(''); stop.current = false
    try {
      for (let i = 0; i < 20 && !stop.current; i++) {
        const r = await call(c.id, 'next-asset')
        await refresh()
        if (r.done) break
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    setBusy('')
  }

  const total = status?.items.length ?? 0
  const done = status?.items.filter((i) => i.done).length ?? 0
  const remaining = total - done

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex gap-4">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
          {ref ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={ref} alt={`${c.name} reference sheet`} className="size-full object-cover" /> : <Sparkles className="size-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{c.name} <span className="font-normal text-muted-foreground">· {c.role}</span></div>
          {canonical && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{canonical}</p>}
          {!ref && (
            <button onClick={makeReference} disabled={busy !== '' || !status} className="mt-3 flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-60">
              {busy === 'reference' && <Loader2 className="size-4 animate-spin" />} Create reference sheet
              {status && <span className="opacity-70">(≈ ${status.costPerImage.toFixed(2)})</span>}
            </button>
          )}
        </div>
      </div>
      {ref && status && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span>Asset pack {done}/{total}</span>
            {remaining > 0 && (
              <button onClick={buildPack} disabled={busy !== ''} className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1 text-xs disabled:opacity-60">
                {busy === 'pack' && <Loader2 className="size-3 animate-spin" />} Build pack (≈ ${(remaining * status.costPerImage).toFixed(2)})
              </button>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
          <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-8">
            {status.items.map((i) => (
              <div key={`${i.kind}-${i.name}`} title={`${i.kind}: ${i.name}`} className="aspect-square overflow-hidden rounded-md bg-[repeating-conic-gradient(#222_0_25%,#2c2c2c_0_50%)] bg-[length:12px_12px]">
                {i.url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={i.url} alt={i.name} className="size-full object-contain" /> : <div className="grid size-full place-items-center text-[10px] text-muted-foreground">{i.name}</div>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Quality: {status.quality} · spent ${status.spentUsd.toFixed(2)} of ${status.capUsd.toFixed(2)} cap</p>
        </div>
      )}
      {err && <p className="mt-3 text-xs text-destructive">{err}</p>}
    </div>
  )
}

export function CastPanel({ cast }: { cast: Cast[] }) {
  return <div className="space-y-4">{cast.map((c) => <CharacterCard key={c.id} c={c} />)}</div>
}
