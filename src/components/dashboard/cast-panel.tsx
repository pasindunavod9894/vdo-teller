'use client'
/* eslint-disable @next/next/no-img-element -- reference images are user media served by the app, shown at fixed small sizes */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CharacterForm } from '@/components/wizard/character-form'
import { VoicePicker } from '@/components/wizard/voice-picker'
import { MAX_MAIN_CHARACTERS, type CharacterDraft } from '@/lib/characters'
import { defaultVoiceFor } from '@/lib/voices'
import type { VoicePick } from '@/lib/wizard/store'

type Item = { kind: string; name: string; done: boolean; url: string | null }
type Status = { hasReference: boolean; locked: boolean; packVersion: number; quality: string; costPerImage: number; remainingUsd: number; rebuildUsd: number; spentUsd: number; capUsd: number; items: Item[] }
type Cast = { id: number | string; name: string; role: string; referenceUrl: string | null; canonical: string; look: string; personality: string }
type Action = 'status' | 'reference' | 'expressions' | 'unlock'

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function call(characterId: number | string, action: Action, patch?: { look?: string; personality?: string }) {
  const res = await fetch('/api/character-art', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId, action, patch }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(json.error || 'Something went wrong', res.status)
  return json
}

function CharacterCard({ c, canRemove }: { c: Cast; canRemove: boolean }) {
  const router = useRouter()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [ref, setRef] = useState<string | null>(c.referenceUrl)
  const [canonical, setCanonical] = useState(c.canonical)
  const [busy, setBusy] = useState<'' | 'reference' | 'pack' | 'unlock'>('')
  const [err, setErr] = useState('')
  // the image API answers 503 when no image key is configured: then nothing is built and there is no error to show
  const [unavailable, setUnavailable] = useState(false)
  const [editing, setEditing] = useState(false)
  // what the character looks like now (the edit form starts from it, and Cancel goes back to it)
  const [saved, setSaved] = useState({ look: c.look, personality: c.personality })
  const [look, setLook] = useState(c.look)
  const [personality, setPersonality] = useState(c.personality)
  const autoStarted = useRef(false)

  const fail = useCallback((e: unknown, quiet = false) => {
    if (e instanceof ApiError && e.status === 503) { setUnavailable(true); return }
    if (!quiet) setErr(e instanceof Error ? e.message : 'Failed')
  }, [])
  const refresh = useCallback(() => call(c.id, 'status').then((s: Status) => { setStatus(s); return s }).catch((e) => { fail(e); return null }), [c.id, fail])

  /** Makes the reference sheet (unless `skipSheet`), then all the expressions in ONE request; the pack is then complete and locks itself. */
  const build = useCallback(async (skipSheet = false) => {
    setErr('')
    try {
      if (!skipSheet) {
        setBusy('reference')
        const r = await call(c.id, 'reference')
        setRef(r.url); setCanonical(r.canonicalDescription)
        await refresh()
      }
      setBusy('pack')
      await call(c.id, 'expressions')
      await refresh()
    } catch (e) { fail(e) }
    setBusy('')
  }, [c.id, refresh, fail])

  // A character that is not finished starts building on the first visit, with no extra click. All characters build at the same time.
  useEffect(() => {
    refresh().then((s) => {
      if (!s || autoStarted.current) return
      autoStarted.current = true
      if (s.locked) return
      if (!s.hasReference) void build()
      else if (s.items.some((i) => !i.done)) void build(true)
    })
  }, [refresh, build])

  async function saveEdit() {
    setBusy('unlock'); setErr('')
    try {
      await call(c.id, 'unlock', { look: look.trim() || undefined, personality: personality.trim() || undefined })
      setRef(null); setEditing(false)
      if (look.trim() !== saved.look.trim()) setCanonical('')
      setSaved({ look: look.trim() || saved.look, personality: personality.trim() || saved.personality })
      await refresh()
    } catch (e) { fail(e); setBusy(''); return }
    await build()
  }

  /** Removes the character with its pack and images (videos already made keep their look). */
  async function remove() {
    setRemoving(true); setErr('')
    try {
      const res = await fetch('/api/cast/characters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', characterId: c.id }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not remove the character')
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the character'); setRemoving(false); setConfirmRemove(false) }
  }

  const items = status?.items ?? []
  const total = status ? items.length + 1 : 0
  const done = status ? (status.hasReference ? 1 : 0) + items.filter((i) => i.done).length : 0
  const working = busy !== ''

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex gap-4">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
          {ref ? <img src={ref} alt={`${c.name} reference sheet`} className="size-full object-cover" /> : <Sparkles className="size-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.name} <span className="font-normal text-muted-foreground">· {c.role}</span></span>
            {status?.locked && (
              <span className="flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
                <Lock className="size-3" /> Locked (v{status.packVersion})
              </span>
            )}
          </div>
          {canonical && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{canonical}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status && !editing && (
              <button onClick={() => setEditing(true)} disabled={working}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs hover:border-accent disabled:opacity-60">
                <Pencil className="size-3" /> Edit character
              </button>
            )}
            {canRemove && !editing && !confirmRemove && (
              <button onClick={() => setConfirmRemove(true)} disabled={working || removing}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs hover:border-destructive hover:text-destructive disabled:opacity-60">
                <Trash2 className="size-3" /> Remove
              </button>
            )}
            {busy === 'reference' && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> Drawing the reference sheet…</span>}
            {busy === 'pack' && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> Drawing the expressions…</span>}
            {busy === 'unlock' && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> Unlocking…</span>}
          </div>
          {confirmRemove && (
            <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2 text-xs">
              <span className="flex-1">Remove {c.name} and its images? Videos you already made keep their look.</span>
              <button onClick={remove} disabled={removing} className="rounded-md bg-destructive px-3 py-1 text-destructive-foreground disabled:opacity-60">{removing ? 'Removing…' : 'Remove'}</button>
              <button onClick={() => setConfirmRemove(false)} disabled={removing} className="rounded-md px-3 py-1 text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          )}
          {unavailable && <p className="mt-2 text-xs text-muted-foreground">Character images need an OpenAI key and a fal.ai key, so the pack is not built yet.</p>}
        </div>
      </div>

      {editing && (
        <form className="mt-4 space-y-3 rounded-lg border border-dashed border-border p-3" onSubmit={(e) => { e.preventDefault(); saveEdit() }}>
          <label className="block text-xs text-muted-foreground">Look
            <textarea value={look} onChange={(e) => setLook(e.target.value)} maxLength={400} rows={3} className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="block text-xs text-muted-foreground">Personality
            <input value={personality} onChange={(e) => setPersonality(e.target.value)} maxLength={200} className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground" />
          </label>
          <p className="text-xs text-muted-foreground">
            Saving unlocks {c.name} and draws the reference sheet and expressions again{status ? ` (about $${status.rebuildUsd.toFixed(2)})` : ''}.
            Later videos will use the new look. Videos you already made keep the look they were made with.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={working || !look.trim()} className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-60">Unlock and rebuild</button>
            <button type="button" onClick={() => { setEditing(false); setLook(saved.look); setPersonality(saved.personality) }} disabled={working} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </form>
      )}

      {status && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span>Reference pack {done}/{total} <span className="text-xs text-muted-foreground">(sheet + {items.length} expressions)</span></span>
            {!ref && !working && !unavailable && (
              <button onClick={() => build()} className="flex items-center gap-2 rounded-md bg-accent px-3 py-1 text-xs text-accent-foreground">
                Create reference sheet <span className="opacity-70">(≈ ${(status?.costPerImage ?? 0).toFixed(2)})</span>
              </button>
            )}
            {ref && done < total && (
              <button onClick={() => build(true)} disabled={working} className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1 text-xs disabled:opacity-60">
                {busy === 'pack' && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />} Build pack (≈ ${status.remainingUsd.toFixed(2)})
              </button>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent transition-all motion-reduce:transition-none" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
          <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-8">
            <div title="Reference sheet" className="aspect-square overflow-hidden rounded-md bg-muted">
              {ref ? <img src={ref} alt="Reference sheet" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-[10px] text-muted-foreground">sheet</div>}
            </div>
            {items.map((i) => (
              <div key={`${i.kind}-${i.name}`} title={`${i.kind}: ${i.name}`} className="aspect-square overflow-hidden rounded-md bg-[repeating-conic-gradient(#222_0_25%,#2c2c2c_0_50%)] bg-[length:12px_12px]">
                {i.url ? <img src={i.url} alt={i.name} className="size-full object-contain" /> : <div className="grid size-full place-items-center text-[10px] text-muted-foreground">{i.name}</div>}
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

export function CastPanel({ cast, seriesId, speaks = false }: { cast: Cast[]; seriesId: number | string; /** the series has character voices: a new character needs one */ speaks?: boolean }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [voice, setVoice] = useState<VoicePick>({ voice: defaultVoiceFor(cast.length), instructions: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  /** Adds a main character to the series. Its pictures are drawn the next time this panel is open (the card below starts them by itself). */
  async function add(draft: CharacterDraft) {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/cast/characters', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add', seriesId, character: { ...draft, voice: voice.voice, voiceInstructions: voice.instructions } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not add the character')
      setAdding(false)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the character') }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      {cast.map((c) => <CharacterCard key={c.id} c={c} canRemove={cast.length > 1} />)}
      {adding ? (
        <CharacterForm submitLabel="Add character" busy={busy} error={err} onSubmit={add} onCancel={() => { setAdding(false); setErr('') }}>
          {speaks && <VoicePicker title="Voice" subtitle="How this character sounds in every video" value={voice} onChange={setVoice} />}
        </CharacterForm>
      ) : cast.length < MAX_MAIN_CHARACTERS ? (
        <Button variant="outline" onClick={() => { setVoice({ voice: defaultVoiceFor(cast.length), instructions: '' }); setAdding(true) }}>
          <Plus className="size-4" /> Add a character
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">A series has at most {MAX_MAIN_CHARACTERS} main characters. Remove one to add another.</p>
      )}
    </div>
  )
}
