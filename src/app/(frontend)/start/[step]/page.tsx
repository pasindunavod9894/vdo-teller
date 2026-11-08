'use client'
import { use, useEffect } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { useWizard } from '@/lib/wizard/store'
import { STEPS } from '@/components/wizard/steps'
import { StepFooter } from '@/components/wizard/step-footer'
import { OptionCard } from '@/components/wizard/option-card'
import {
  charactersFor, formatsFor, FREQUENCIES, QUALITIES, stylesFor, subNichesFor, voicesFor,
} from '@/lib/wizard/mock-data'
import { cn } from '@/lib/utils'

const TITLES: Record<string, { h: string; p: string }> = {
  'sub-niche': { h: 'Pick a sub-niche', p: 'Ranked by popularity and how well it can earn on Facebook and YouTube.' },
  style: { h: 'Choose a visual style', p: 'Only styles that suit your niche are shown first.' },
  format: { h: 'Choose a content format', p: 'How long and how story-driven each video is.' },
  characters: { h: 'Build your cast', p: 'Characters keep the same look and voice in every episode.' },
  voice: { h: 'How should it sound?', p: 'Characters can talk with lip-sync and facial expressions.' },
  frequency: { h: 'How often should we post?', p: 'More videos grow faster but cost more.' },
  quality: { h: 'Pick the video quality', p: 'Cost per video and per month is shown for your schedule.' },
}

export default function StepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = use(params)
  const router = useRouter()
  const w = useWizard()
  const valid = STEPS.some((s) => s.slug === step)
  useEffect(() => { if (valid && !w.niche) router.replace('/start') }, [valid, w.niche, router])
  if (!valid) notFound()
  if (!w.niche) return null

  const t = TITLES[step]
  let body: React.ReactNode = null
  let canContinue = false

  if (step === 'sub-niche') {
    canContinue = !!w.subNiche
    body = (
      <div className="grid gap-4 sm:grid-cols-2">
        {subNichesFor(w.niche).map((s) => (
          <OptionCard key={s.id} selected={w.subNiche === s.id} onClick={() => w.set({ subNiche: s.id })}
            title={s.name} subtitle={s.blurb} badge={s.trend === 'rising' ? 'Rising' : s.trend === 'stable' ? 'Stable' : 'Falling'}>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent" style={{ width: `${s.popularity}%` }} /></div>
              <span className="text-xs text-muted-foreground">{s.popularity}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{s.monetization}</p>
          </OptionCard>
        ))}
      </div>
    )
  } else if (step === 'style') {
    canContinue = !!w.style
    const list = stylesFor(w.niche)
    body = (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.filter((s) => s.status !== 'not_suitable').map((s) => (
          <OptionCard key={s.id} selected={w.style === s.id} onClick={() => w.set({ style: s.id })}
            title={s.name} subtitle={s.look} badge={s.status === 'recommended' ? 'Recommended' : 'Suitable'} badgeTone={s.status === 'recommended' ? 'accent' : 'muted'}>
            <div className="text-xs text-muted-foreground">{s.why} · Engine fit {'★'.repeat(s.engineFit)}</div>
          </OptionCard>
        ))}
        {list.filter((s) => s.status === 'not_suitable').length > 0 && (
          <details className="col-span-full text-sm text-muted-foreground">
            <summary className="cursor-pointer">Show styles that don&apos;t fit this niche</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.filter((s) => s.status === 'not_suitable').map((s) => (
                <OptionCard key={s.id} dim selected={w.style === s.id} onClick={() => w.set({ style: s.id })} title={s.name} subtitle={s.look} badge="Not suitable" badgeTone="muted">
                  <div className="text-xs">{s.why}</div>
                </OptionCard>
              ))}
            </div>
          </details>
        )}
      </div>
    )
  } else if (step === 'format') {
    canContinue = !!w.format
    body = (
      <div className="grid gap-4 sm:grid-cols-3">
        {formatsFor().map((f) => (
          <OptionCard key={f.id} selected={w.format === f.id} onClick={() => w.set({ format: f.id })}
            title={f.name} subtitle={f.blurb} badge={f.recommended ? 'Recommended' : f.length} badgeTone={f.recommended ? 'accent' : 'muted'}>
            <div className="text-xs text-muted-foreground">{f.length}</div>
          </OptionCard>
        ))}
      </div>
    )
  } else if (step === 'characters') {
    canContinue = w.characters.length > 0
    const ideas = charactersFor(w.niche)
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {ideas.map((c) => {
            const on = w.characters.some((x) => x.id === c.id)
            return (
              <OptionCard key={c.id} selected={on} title={c.name} subtitle={c.look} badge={c.role} badgeTone="muted"
                onClick={() => w.set({ characters: on ? w.characters.filter((x) => x.id !== c.id) : [...w.characters, c] })}>
                <div className="text-xs text-muted-foreground">{c.personality}</div>
              </OptionCard>
            )
          })}
        </div>
        <CustomCharacter />
        {w.characters.filter((c) => c.id.startsWith('custom-')).map((c) => (
          <p key={c.id} className="text-sm text-muted-foreground">Custom: <span className="text-foreground">{c.name}</span> — {c.look}</p>
        ))}
      </div>
    )
  } else if (step === 'voice') {
    canContinue = !!w.voiceMode
    body = (
      <div className="grid gap-4 sm:grid-cols-2">
        {voicesFor(w.niche).map((v) => (
          <OptionCard key={v.id} selected={w.voiceMode === v.id} onClick={() => w.set({ voiceMode: v.id })} dim={v.status === 'not_suitable'}
            title={v.name} subtitle={v.blurb} badge={v.status === 'recommended' ? 'Recommended' : v.status === 'suitable' ? 'Suitable' : 'Weak fit'} badgeTone={v.status === 'recommended' ? 'accent' : 'muted'}>
            <div className="text-xs text-muted-foreground">{v.why}</div>
          </OptionCard>
        ))}
      </div>
    )
  } else if (step === 'frequency') {
    canContinue = !!w.frequency
    body = (
      <div className="grid gap-4 sm:grid-cols-2">
        {FREQUENCIES.map((f) => (
          <OptionCard key={f.id} selected={w.frequency === f.id} onClick={() => w.set({ frequency: f.id })}
            title={f.name} subtitle={f.blurb} badge={f.recommended ? 'Best for growth' : `${f.perMonth} videos / month`} badgeTone={f.recommended ? 'accent' : 'muted'}>
            <div className="text-xs text-muted-foreground">{f.perMonth} videos / month</div>
          </OptionCard>
        ))}
      </div>
    )
  } else if (step === 'quality') {
    canContinue = !!w.qualityTier
    const perMonth = FREQUENCIES.find((f) => f.id === w.frequency)?.perMonth ?? 15
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {QUALITIES.map((q) => (
            <OptionCard key={q.id} selected={w.qualityTier === q.id} onClick={() => w.set({ qualityTier: q.id })} title={q.name} subtitle={q.blurb} badge={q.output} badgeTone="muted">
              <div className="text-sm">≈ ${q.costPerReel.toFixed(2)} per video</div>
              <div className="text-xs text-muted-foreground">≈ ${(q.costPerReel * perMonth).toFixed(0)} / month at your schedule</div>
            </OptionCard>
          ))}
        </div>
        <div>
          <div className="mb-2 text-sm text-muted-foreground">Main aspect ratio</div>
          <div className="flex flex-wrap gap-2">
            {[['9:16', 'Reels / Shorts'], ['16:9', 'YouTube'], ['1:1', 'Square'], ['4:5', 'Feed']].map(([a, l]) => (
              <button key={a} onClick={() => w.set({ aspect: a })}
                className={cn('rounded-full border px-4 py-1.5 text-sm', w.aspect === a ? 'border-accent bg-accent/20' : 'border-border text-muted-foreground')}>
                {a} · {l}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Costs are estimates. Other videos can be exported in any ratio.</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{t.h}</h1>
      <p className="mt-2 text-muted-foreground">{t.p} <span className="text-foreground/70">· {w.niche}</span></p>
      <div className="mt-8">{body}</div>
      <StepFooter slug={step} canContinue={canContinue} />
    </div>
  )
}

function CustomCharacter() {
  const w = useWizard()
  return (
    <form
      className="grid gap-2 rounded-xl border border-dashed border-border p-4 sm:grid-cols-[1fr_2fr_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const name = String(f.get('name') || '').trim()
        const look = String(f.get('look') || '').trim()
        if (!name) return
        w.set({ characters: [...w.characters, { id: `custom-${Date.now()}`, name, role: 'Custom', look, personality: '' }] })
        e.currentTarget.reset()
      }}
    >
      <input name="name" placeholder="Create your own: name" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />
      <input name="look" placeholder="Look and personality" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />
      <button className="h-9 rounded-md bg-secondary px-4 text-sm">Add</button>
    </form>
  )
}
