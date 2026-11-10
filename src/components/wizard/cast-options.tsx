'use client'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { CastCharacter, CastOption } from '@/lib/art/cast-options'
import { OptionCard } from '@/components/wizard/option-card'
import { Button } from '@/components/ui/button'
import { startCastFetch, subNicheLabel, useCastFetch } from '@/lib/wizard/cast-fetch'
import { useWizard } from '@/lib/wizard/store'
import { CharacterForm } from '@/components/wizard/character-form'
import { castCharacterFrom, castProblems, MAX_MAIN_CHARACTERS, type CharacterDraft } from '@/lib/characters'
import { defaultVoiceFor } from '@/lib/voices'

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()

/** Group portrait of a cast, or a card of initials when no picture could be made. */
function Portrait({ option }: { option: CastOption }) {
  if (option.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={option.image} alt={`Group portrait: ${option.characters.map((c) => c.name).join(', ')}`} className="aspect-[3/2] w-full object-cover" />
  }
  return (
    <div className="flex aspect-[3/2] w-full items-center justify-center gap-3 bg-muted/60" aria-hidden="true">
      {option.characters.map((c) => (
        <span key={c.id} className="grid size-14 place-items-center rounded-full bg-accent/20 text-lg font-semibold text-accent">{initials(c.name)}</span>
      ))}
    </div>
  )
}

function CastingLoader({ regenerating }: { regenerating: boolean }) {
  return (
    <div role="status" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="aspect-[3/2] animate-pulse bg-muted motion-reduce:animate-none" />
            <div className="space-y-2 p-5">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-center gap-3 text-sm text-muted-foreground">
        <motion.div
          className="size-5 rounded-full border-2 border-accent border-t-transparent"
          animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
        />
        {regenerating ? 'Casting three new options…' : 'The casting director is drawing your characters. This takes a moment.'}
      </div>
    </div>
  )
}

/**
 * The Characters step: three AI casts to start from, and the person's own characters. Picking a cast gives you its characters; each can be
 * changed or removed, and you can add your own, up to three main characters in all. The casts are made in the background as soon as a style is picked.
 */
export function CastOptions() {
  const w = useWizard()
  const cast = useCastFetch()
  const loading = cast.status === 'loading' || cast.status === 'idle'
  // the character being changed (its id), or 'new'; and the cast the person clicked while their own changes were not saved anywhere else
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [replacing, setReplacing] = useState<CastOption | null>(null)
  const [checking, setChecking] = useState(false)
  const [formError, setFormError] = useState('')

  // When the options arrive, keep the choice only if it is one of them (and take the full version, with its portrait).
  useEffect(() => {
    if (cast.status !== 'ready') return
    const chosen = useWizard.getState().castOption
    if (!chosen) return
    const fresh = cast.options.find((o) => o.id === chosen.id)
    // new options never take the person's characters away: only the portrait of the cast they started from can change or go
    if (!fresh) useWizard.getState().set({ castOption: null })
    else if (fresh !== chosen) useWizard.getState().set({ castOption: fresh })
  }, [cast.status, cast.options])

  const sameAsOption = (team: CastCharacter[], o: CastOption | null) => !!o && JSON.stringify(team) === JSON.stringify(o.characters)
  const customised = w.cast.length > 0 && !sameAsOption(w.cast, w.castOption)

  function apply(o: CastOption) {
    // another cast means other characters, so the voices picked for the old ones no longer apply
    w.set({ castOption: o, cast: o.characters.map((c) => ({ ...c })), voices: {} })
    setReplacing(null); setEditing(null); setFormError('')
  }
  function pick(o: CastOption) {
    const cur = useWizard.getState()
    if (cur.castOption?.id === o.id && !customised) return
    // characters the person changed or wrote themselves are not thrown away without asking
    if (customised) { setReplacing(o); return }
    apply(o)
  }

  /** Saves a character the person wrote or changed, after the same checks the server makes (originality, name, content check). */
  async function save(draft: CharacterDraft) {
    const cur = useWizard.getState()
    const target = editing
    const next = target && target !== 'new'
      ? cur.cast.map((c) => (c.id === target ? { ...c, ...draft } : c))
      : [...cur.cast, castCharacterFrom(draft, cur.cast.map((c) => c.id), defaultVoiceFor(cur.cast.length))]
    const problems = castProblems(next)
    if (problems.length) { setFormError(problems[0]); return }
    setChecking(true); setFormError('')
    try {
      const res = await fetch('/api/cast/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characters: next.map(({ name, role, look, outfit, personality }) => ({ name, role, look, outfit, personality })) }) })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.problems?.length) { setFormError(json.problems[0]); setChecking(false); return }
    } catch { /* the check could not be made: the server checks again when the series is created */ }
    setChecking(false)
    w.set({ cast: next })
    setEditing(null)
  }
  function remove(id: string) {
    const cur = useWizard.getState()
    const voices = { ...cur.voices }
    delete voices[id]
    w.set({ cast: cur.cast.filter((c) => c.id !== id), voices })
    if (editing === id) setEditing(null)
  }

  function retry() { startCastFetch({ niche: w.niche, subNiche: subNicheLabel(w), style: w.style }) }

  function regenerate() {
    // three new casts to start from; the characters the person already has stay
    w.set({ castOption: null })
    startCastFetch({ niche: w.niche, subNiche: subNicheLabel(w), style: w.style }, true)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = cast.options.length
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step || n === 0) return
    e.preventDefault()
    const j = (i + step + n) % n
    pick(cast.options[j])
    ;(e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus()
  }

  const selectedIndex = cast.options.findIndex((o) => o.id === w.castOption?.id)
  return (
    <div className="space-y-6">
      {loading ? <CastingLoader regenerating={cast.regenerating} /> : cast.status === 'error' ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive" role="alert">{cast.error}</p>
        </div>
      ) : (
        <div role="radiogroup" aria-label="Choose one cast" className="grid gap-4 sm:grid-cols-3">
          {cast.options.map((o, i) => (
            <OptionCard
              key={o.id} radio selected={i === selectedIndex} onClick={() => pick(o)}
              tabIndex={i === (selectedIndex >= 0 ? selectedIndex : 0) ? 0 : -1} onKeyDown={(e) => onKeyDown(e, i)}
              media={<Portrait option={o} />}
              title={o.concept} subtitle={o.relationship} badge={`${o.characters.length} main ${o.characters.length === 1 ? 'character' : 'characters'}`} badgeTone="muted"
            >
              <ul className="space-y-2">
                {o.characters.map((c) => (
                  <li key={c.id}>
                    <div className="font-medium">{c.name} <span className="font-normal text-muted-foreground">· {c.role}</span></div>
                    <div className="text-xs text-muted-foreground">{c.personality}</div>
                  </li>
                ))}
              </ul>
            </OptionCard>
          ))}
        </div>
      )}
      {replacing && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm">
          <span className="flex-1">Use this cast instead? The characters you changed or wrote will be replaced.</span>
          <Button size="sm" onClick={() => apply(replacing)}>Use this cast</Button>
          <Button size="sm" variant="ghost" onClick={() => setReplacing(null)}>Keep my characters</Button>
        </div>
      )}

      <section aria-labelledby="my-cast" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="my-cast" className="text-lg font-semibold">Your main characters</h2>
          <span className="text-sm text-muted-foreground">{w.cast.length} of {MAX_MAIN_CHARACTERS}</span>
        </div>
        {w.cast.length === 0 && editing !== 'new' && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Pick one of the casts above, or create your own character. You need at least one.</p>
        )}
        <ul className="space-y-3">
          {w.cast.map((c) => (
            <li key={c.id}>
              {editing === c.id ? (
                <CharacterForm initial={c} submitLabel="Save character" busy={checking} error={formError} onSubmit={save} onCancel={() => { setEditing(null); setFormError('') }} />
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/20 text-sm font-semibold text-accent" aria-hidden="true">{initials(c.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.name}{c.role && <span className="font-normal text-muted-foreground"> · {c.role}</span>}</div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{c.look}</p>
                    {c.personality && <p className="text-xs text-muted-foreground">{c.personality}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(c.id); setFormError('') }} aria-label={`Edit ${c.name}`}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {editing === 'new' && <CharacterForm submitLabel="Add character" busy={checking} error={formError} onSubmit={save} onCancel={() => { setEditing(null); setFormError('') }} />}
        {editing === null && (
          <Button variant="outline" onClick={() => { setEditing('new'); setFormError('') }} disabled={w.cast.length >= MAX_MAIN_CHARACTERS}>
            <Plus className="size-4" /> {w.cast.length === 0 ? 'Create your own character' : 'Add a character'}
            {w.cast.length >= MAX_MAIN_CHARACTERS && <span className="text-muted-foreground"> (3 of 3)</span>}
          </Button>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          These main characters stay the same in every video. The story team may also add supporting characters to individual videos, so you don&apos;t need to pick them.
        </p>
        <Button variant="outline" onClick={cast.status === 'error' ? retry : regenerate} disabled={loading}>
          <RefreshCw className="size-4" /> {cast.status === 'error' ? 'Try again' : 'Regenerate options'}
        </Button>
      </div>
    </div>
  )
}
