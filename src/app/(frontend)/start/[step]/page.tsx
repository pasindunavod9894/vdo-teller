'use client'
import { use, useEffect } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { useWizard, useWizardHydrated } from '@/lib/wizard/store'
import { STEPS } from '@/components/wizard/steps'
import { StepFooter } from '@/components/wizard/step-footer'
import { OptionCard } from '@/components/wizard/option-card'
import { FREQUENCIES, QUALITIES } from '@/lib/wizard/mock-data'
import { useOptions, useSubNiches } from '@/lib/research/client'
import { Researching, SourceBadge } from '@/components/wizard/research-status'
import { cn } from '@/lib/utils'
import { VoicePicker } from '@/components/wizard/voice-picker'
import { defaultVoiceFor } from '@/lib/voices'

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
  const hydrated = useWizardHydrated()
  const valid = STEPS.some((s) => s.slug === step)
  const isSub = step === 'sub-niche'
  const needsOptions = ['style', 'format', 'characters', 'voice', 'frequency'].includes(step)
  const subs = useSubNiches(valid && isSub, w.niche)
  const opts = useOptions(valid && needsOptions, w.niche, w.subNiche)
  useEffect(() => { if (hydrated && valid && !w.niche) router.replace('/start') }, [hydrated, valid, w.niche, router])
  // Persist the default voices that the pickers display, so what the user sees is what gets saved.
  useEffect(() => {
    if (step !== 'voice') return
    const { voiceMode, characters, narrator } = useWizard.getState()
    const speaking = voiceMode === 'character_voices' || voiceMode === 'narrator_and_characters'
    const narrates = voiceMode === 'narrator' || voiceMode === 'narrator_and_characters'
    const patch: Partial<{ characters: typeof characters; narrator: typeof narrator }> = {}
    if (speaking && characters.some((c) => !c.voice)) {
      patch.characters = characters.map((c, i) => (c.voice ? c : { ...c, voice: { voice: defaultVoiceFor(i), instructions: '' } }))
    }
    if (narrates && !narrator) patch.narrator = { voice: 'fable', instructions: 'Warm storyteller' }
    if (patch.characters || patch.narrator) useWizard.getState().set(patch)
  }, [step, w.voiceMode, w.characters, w.narrator])
  if (!valid) notFound()
  if (!hydrated || !w.niche) return null

  const t = TITLES[step]
  const research = isSub ? subs : needsOptions ? opts : null
  let body: React.ReactNode = null
  let canContinue = false

  if (step === 'sub-niche') {
    canContinue = !!w.subNiche
    body = (
      <div className="grid gap-4 sm:grid-cols-2">
        {(subs.data?.subNiches ?? []).map((s) => (
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
    const list = opts.data?.styles ?? []
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
        {(opts.data?.formats ?? []).map((f) => (
          <OptionCard key={f.id} selected={w.format === f.id} onClick={() => w.set({ format: f.id })}
            title={f.name} subtitle={f.blurb} badge={f.recommended ? 'Recommended' : f.length} badgeTone={f.recommended ? 'accent' : 'muted'}>
            <div className="text-xs text-muted-foreground">{f.length}</div>
          </OptionCard>
        ))}
      </div>
    )
  } else if (step === 'characters') {
    canContinue = w.characters.length > 0
    const ideas = opts.data?.characters ?? []
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {ideas.map((c) => {
            const on = w.characters.some((x) => x.id === c.id)
            return (
              <OptionCard key={c.id} selected={on} title={c.name} subtitle={c.look} badge={c.role} badgeTone="muted"
                onClick={() => { const cur = useWizard.getState().characters; w.set({ characters: cur.some((x) => x.id === c.id) ? cur.filter((x) => x.id !== c.id) : [...cur, c] }) }}>
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
    const speaking = w.voiceMode === 'character_voices' || w.voiceMode === 'narrator_and_characters'
    const narrates = w.voiceMode === 'narrator' || w.voiceMode === 'narrator_and_characters'
    canContinue = !!w.voiceMode
    body = (
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {(opts.data?.voices ?? []).map((v) => (
            <OptionCard key={v.id} selected={w.voiceMode === v.id} onClick={() => w.set({ voiceMode: v.id })} dim={v.status === 'not_suitable'}
              title={v.name} subtitle={v.blurb} badge={v.status === 'recommended' ? 'Recommended' : v.status === 'suitable' ? 'Suitable' : 'Weak fit'} badgeTone={v.status === 'recommended' ? 'accent' : 'muted'}>
              <div className="text-xs text-muted-foreground">{v.why}</div>
            </OptionCard>
          ))}
        </div>
        {(narrates || speaking) && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Pick each voice</h2>
            <p className="mb-4 text-sm text-muted-foreground">Each voice stays the same in every episode. Press Preview to listen.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {narrates && (
                <VoicePicker title="Narrator" subtitle="Tells the story" value={w.narrator ?? { voice: 'fable', instructions: 'Warm storyteller' }} onChange={(v) => w.set({ narrator: v })} />
              )}
              {speaking && w.characters.map((c, i) => (
                <VoicePicker key={c.id} title={c.name} subtitle={c.role} value={c.voice ?? { voice: defaultVoiceFor(i), instructions: '' }}
                  onChange={(v) => w.set({ characters: useWizard.getState().characters.map((x) => (x.id === c.id ? { ...x, voice: v } : x)) })} />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  } else if (step === 'frequency') {
    canContinue = !!w.frequency
    body = (
      <div className="grid gap-4 sm:grid-cols-2">
        {(opts.data?.frequencies ?? FREQUENCIES).map((f) => (
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
      <p className="mt-2 text-muted-foreground">{t.p} <span className="text-foreground/70">· {w.niche}</span>{research && <SourceBadge source={research.source} />}</p>
      <div className="mt-8">
        {research?.loading ? <Researching /> : research?.error ? (
          <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{research.error}</p>
        ) : body}
      </div>
      <StepFooter slug={step} canContinue={canContinue && !research?.loading} />
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
        w.set({ characters: [...useWizard.getState().characters, { id: `custom-${Date.now()}`, name, role: 'Custom', look, personality: '' }] })
        e.currentTarget.reset()
      }}
    >
      <input name="name" placeholder="Create your own: name" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />
      <input name="look" placeholder="Look and personality" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />
      <button className="h-9 rounded-md bg-secondary px-4 text-sm">Add</button>
    </form>
  )
}
