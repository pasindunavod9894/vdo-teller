'use client'
import { useRef, useState } from 'react'
import { Play, Loader2 } from 'lucide-react'
import { TONE_PRESETS, VOICES } from '@/lib/voices'
import type { VoicePick } from '@/lib/wizard/store'
import { cn } from '@/lib/utils'

export function VoicePicker({ title, subtitle, value, onChange }: { title: string; subtitle?: string; value: VoicePick; onChange: (v: VoicePick) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [err, setErr] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)

  async function preview() {
    setState('loading'); setErr('')
    try {
      const res = await fetch('/api/tts-preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice: value.voice, instructions: value.instructions || undefined, name: title }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Preview failed')
      const url = URL.createObjectURL(await res.blob())
      audio.current?.pause()
      audio.current = new Audio(url)
      audio.current.onended = () => URL.revokeObjectURL(url)
      await audio.current.play()
      setState('idle')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Preview failed'); setState('error')
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="font-semibold">{title}</div>{subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}</div>
        <button type="button" onClick={preview} disabled={state === 'loading'}
          className="flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm text-accent-foreground disabled:opacity-60">
          {state === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Preview
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {VOICES.map((v) => (
          <button key={v.id} type="button" title={v.hint} onClick={() => onChange({ ...value, voice: v.id })}
            className={cn('rounded-full border px-3 py-1 text-xs capitalize', value.voice === v.id ? 'border-accent bg-accent/20' : 'border-border text-muted-foreground')}>
            {v.id}
          </button>
        ))}
      </div>
      <input value={value.instructions} maxLength={200} onChange={(e) => onChange({ ...value, instructions: e.target.value })}
        placeholder="Tone, e.g. playful and smug" className="mt-3 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TONE_PRESETS.map((t) => (
          <button key={t} type="button" onClick={() => onChange({ ...value, instructions: t })} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">{t}</button>
        ))}
      </div>
      {state === 'error' && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  )
}
