'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useEffect, useState } from 'react'

export type VoicePick = { voice: string; instructions: string }
export type WizardCharacter = { id: string; name: string; role: string; look: string; personality: string; voice?: VoicePick }

export type WizardState = {
  niche: string
  subNiche: string
  style: string
  format: string
  characters: WizardCharacter[]
  narrator: VoicePick | null
  voiceMode: string
  frequency: string
  qualityTier: string
  aspect: string
  set: (patch: Partial<Omit<WizardState, 'set' | 'reset'>>) => void
  reset: () => void
}

const initial = {
  niche: '', subNiche: '', style: '', format: '', characters: [], narrator: null, voiceMode: '',
  frequency: '', qualityTier: 'standard', aspect: '9:16',
}

export const useWizard = create<WizardState>()(
  persist(
    (set) => ({ ...initial, set: (patch) => set(patch), reset: () => set({ ...initial }) }),
    { name: 'vdo-teller-wizard' },
  ),
)

/** True once the persisted choices have been read from localStorage (avoids redirecting on a reload). */
export function useWizardHydrated() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (useWizard.persist.hasHydrated()) setHydrated(true)
    return useWizard.persist.onFinishHydration(() => setHydrated(true))
  }, [])
  return hydrated
}
