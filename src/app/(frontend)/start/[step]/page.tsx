'use client'
import { use, useEffect } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { useWizard, useWizardHydrated } from '@/lib/wizard/store'
import { STEPS } from '@/components/wizard/steps'
import { StepFooter } from '@/components/wizard/step-footer'
import { OptionCard } from '@/components/wizard/option-card'
import type { StyleOption } from '@/lib/wizard/mock-data'
import { useOptions, useSubNiches } from '@/lib/research/client'
import { Researching, SourceBadge } from '@/components/wizard/research-status'
import { CastOptions } from '@/components/wizard/cast-options'
import { castProblems } from '@/lib/characters'
import { ensureCastFetch, subNicheLabel, useCastFetch } from '@/lib/wizard/cast-fetch'
import { sizeFor } from '@/engine/aspect'
import { VoicePicker } from '@/components/wizard/voice-picker'
import { defaultVoiceFor, VOICE_IDS } from '@/lib/voices'

const TITLES: Record<string, { h: string; p: string }> = {
  'sub-niche': { h: 'Pick a sub-niche', p: 'Ranked by popularity and how well it can earn on Facebook and YouTube.' },
  style: { h: 'Choose a visual style', p: 'Only styles that suit your niche are shown first.' },
  characters: { h: 'Choose your cast', p: 'Pick one of three casts. These main characters keep the same look in every video.' },
  voice: { h: 'How should it sound?', p: 'Characters can talk with lip-sync and facial expressions. Every video is a short story of 25 to 30 seconds.' },
}

/** The voice the casting director suggested, if it is one we can speak with; otherwise a default by position. */
const suggestedVoice = (voice: string, index: number) => ((VOICE_IDS as readonly string[]).includes(voice) ? voice : defaultVoiceFor(index))

export default function StepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = use(params)
  const router = useRouter()
  const w = useWizard()
  const hydrated = useWizardHydrated()
  const valid = STEPS.some((s) => s.slug === step)
  const isSub = step === 'sub-niche'
  const needsOptions = ['style', 'voice'].includes(step)
  const subs = useSubNiches(valid && isSub, w.niche)
  const opts = useOptions(valid && needsOptions, w.niche, w.subNiche)
  const cast = useCastFetch()
  useEffect(() => {
    if (!hydrated || !valid) return
    if (!w.niche) router.replace('/start')
    else if (step === 'characters' && !w.style) router.replace('/start/style')
    else if (step === 'voice' && w.cast.length === 0) router.replace('/start/characters')
  }, [hydrated, valid, step, w.niche, w.style, w.cast.length, router])
  // The cast options are normally already being made (they start when a style is picked); this covers a reload or a direct visit.
  useEffect(() => {
    if (hydrated && valid && step === 'characters' && w.niche && w.style) ensureCastFetch({ niche: w.niche, subNiche: subNicheLabel(useWizard.getState()), style: w.style })
  }, [hydrated, valid, step, w.niche, w.style, w.subNiche, w.subNicheName])
  // Persist the default voices that the pickers display, so what the user sees is what gets saved.
  useEffect(() => {
    if (step !== 'voice') return
    const { voiceMode, cast: team, voices, narrator } = useWizard.getState()
    const speaking = voiceMode === 'character_voices' || voiceMode === 'narrator_and_characters'
    const narrates = voiceMode === 'narrator' || voiceMode === 'narrator_and_characters'
    const patch: Partial<{ voices: typeof voices; narrator: typeof narrator }> = {}
    const missing = speaking ? team.map((c, i) => [c, i] as const).filter(([c]) => !voices[c.id]) : []
    if (missing.length > 0) {
      patch.voices = { ...voices, ...Object.fromEntries(missing.map(([c, i]) => [c.id, { voice: suggestedVoice(c.voice, i), instructions: '' }])) }
    }
    if (narrates && !narrator) patch.narrator = { voice: 'fable', instructions: 'Warm storyteller' }
    if (patch.voices || patch.narrator) useWizard.getState().set(patch)
  }, [step, w.voiceMode, w.cast, w.voices, w.narrator])
  if (!valid) notFound()
  if (!hydrated || !w.niche) return null

  const t = TITLES[step]
  const research = isSub ? subs : needsOptions ? opts : null
  const badgeSource = step === 'characters' ? cast.source : research?.source ?? null
  let body: React.ReactNode = null
  let canContinue = false

  // A different sub-niche means different style research and different casts, so the answers that depend on it start again.
  function pickSubNiche(id: string, name: string) {
    if (useWizard.getState().subNiche === id) return
    w.set({ subNiche: id, subNicheName: name, style: '', styleApplicability: null, styleBible: null, castOption: null, cast: [], voices: {} })
  }

  // Picking a style also starts the style bible and the three cast options in the background.
  function pickStyle(s: StyleOption) {
    const cur = useWizard.getState()
    if (cur.style !== s.id) cur.set({ style: s.id, styleApplicability: { status: s.status, why: s.why }, styleBible: null, castOption: null, cast: [], voices: {} })
    ensureCastFetch({ niche: cur.niche, subNiche: subNicheLabel(cur), style: s.id })
  }

  if (step === 'sub-niche') {
    canContinue = !!w.subNiche
    body = (
      <div className="grid gap-4 sm:grid-cols-2">
        {(subs.data?.subNiches ?? []).map((s) => (
          <OptionCard key={s.id} selected={w.subNiche === s.id} onClick={() => pickSubNiche(s.id, s.name)}
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
          <OptionCard key={s.id} selected={w.style === s.id} onClick={() => pickStyle(s)}
            title={s.name} subtitle={s.look} badge={s.status === 'recommended' ? 'Recommended' : 'Suitable'} badgeTone={s.status === 'recommended' ? 'accent' : 'muted'}>
            <div className="text-xs text-muted-foreground">{s.why}</div>
          </OptionCard>
        ))}
        {list.filter((s) => s.status === 'not_suitable').length > 0 && (
          <details className="col-span-full text-sm text-muted-foreground">
            <summary className="cursor-pointer">Show styles that don&apos;t fit this niche</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.filter((s) => s.status === 'not_suitable').map((s) => (
                <OptionCard key={s.id} dim selected={w.style === s.id} onClick={() => pickStyle(s)} title={s.name} subtitle={s.look} badge="Not suitable" badgeTone="muted">
                  <div className="text-xs">{s.why}</div>
                </OptionCard>
              ))}
            </div>
          </details>
        )}
      </div>
    )
  } else if (step === 'characters') {
    canContinue = w.cast.length >= 1 && castProblems(w.cast).length === 0
    body = <CastOptions />
  } else if (step === 'voice') {
    const speaking = w.voiceMode === 'character_voices' || w.voiceMode === 'narrator_and_characters'
    const narrates = w.voiceMode === 'narrator' || w.voiceMode === 'narrator_and_characters'
    canContinue = !!w.voiceMode
    body = (
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {(opts.data?.voices ?? []).map((v) => (
            <OptionCard key={v.id} selected={w.voiceMode === v.id} onClick={() => w.set({ voiceMode: v.id, voiceApplicability: { status: v.status, why: v.why } })} dim={v.status === 'not_suitable'}
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
              {speaking && w.cast.map((c, i) => (
                <VoicePicker key={c.id} title={c.name} subtitle={c.role} value={w.voices[c.id] ?? { voice: suggestedVoice(c.voice, i), instructions: '' }}
                  onChange={(v) => w.set({ voices: { ...useWizard.getState().voices, [c.id]: v } })} />
              ))}
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">Every video is vertical ({w.aspect}, {sizeFor(w.aspect).width}×{sizeFor(w.aspect).height}), made for Reels and Shorts. Other shapes can be exported later. You can make up to 3 videos a day.</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{t.h}</h1>
      <p className="mt-2 text-muted-foreground">{t.p} <span className="text-foreground/70">· {w.niche}</span><SourceBadge source={badgeSource} /></p>
      <div className="mt-8">
        {research?.loading ? <Researching /> : research?.error ? (
          <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{research.error}</p>
        ) : body}
      </div>
      <StepFooter slug={step} canContinue={canContinue && !research?.loading} />
    </div>
  )
}
