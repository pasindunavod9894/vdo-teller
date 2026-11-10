'use client'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { characterProblems, cleanCharacter, LIMITS, type CharacterDraft } from '@/lib/characters'

/**
 * The form for one main character, used by the wizard (to add or change a character of the cast) and the dashboard (to add one to a series
 * that exists). The person writes the name, what the character looks like, what they wear and their personality; the text is checked as it
 * is saved (and again on the server). A voice is chosen elsewhere: the Voice step, or `children` here.
 */
export function CharacterForm({ initial, submitLabel, busy = false, error = '', onSubmit, onCancel, children }: {
  initial?: Partial<CharacterDraft>
  submitLabel: string
  busy?: boolean
  /** a problem found after the form was sent (for example by the server's content check) */
  error?: string
  onSubmit: (c: CharacterDraft) => void
  onCancel: () => void
  /** extra fields under the personality, such as a voice picker */
  children?: React.ReactNode
}) {
  const id = useId()
  const [v, setV] = useState<CharacterDraft>({ name: initial?.name ?? '', role: initial?.role ?? '', look: initial?.look ?? '', outfit: initial?.outfit ?? '', personality: initial?.personality ?? '' })
  const [tried, setTried] = useState(false)
  const problems = characterProblems(v)
  const field = (k: keyof CharacterDraft) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value }) })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setTried(true)
    if (problems.length) return
    onSubmit(cleanCharacter(v))
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Character details" className="space-y-4 rounded-xl border border-dashed border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input id={`${id}-name`} {...field('name')} maxLength={LIMITS.nameMax} placeholder="e.g. Pip" autoComplete="off" aria-required="true" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-role`}>Who are they? <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={`${id}-role`} {...field('role')} maxLength={LIMITS.role} placeholder="e.g. the clumsy best friend" autoComplete="off" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-look`}>What do they look like?</Label>
        <textarea id={`${id}-look`} {...field('look')} maxLength={LIMITS.lookMax} rows={3} aria-required="true"
          placeholder="The species or age, the colours and markings, and one detail people will remember. e.g. a small round otter with soft brown fur and a bright red scarf"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
        <p className="text-xs text-muted-foreground">{v.look.length}/{LIMITS.lookMax}. The same description is used for every picture of this character, so be concrete.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-outfit`}>What do they wear? <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={`${id}-outfit`} {...field('outfit')} maxLength={LIMITS.outfit} placeholder="e.g. a red scarf and tiny boots" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-personality`}>Personality <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={`${id}-personality`} {...field('personality')} maxLength={LIMITS.personality} placeholder="e.g. shy, curious, secretly brave" autoComplete="off" />
        </div>
      </div>
      {children}
      <p className="text-xs text-muted-foreground">Describe an original character: names of studios, brands or existing characters are not allowed.</p>
      {tried && problems.length > 0 && <p role="alert" className="text-sm text-destructive">{problems[0]}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="bg-accent text-accent-foreground hover:bg-accent/90">{busy ? 'Checking…' : submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  )
}
