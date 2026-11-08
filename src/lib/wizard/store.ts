'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WizardState = {
  niche: string
  subNiche: string
  style: string
  format: string
  characters: { id: string; name: string; role: string; look: string; personality: string }[]
  voiceMode: string
  frequency: string
  qualityTier: string
  aspect: string
  set: (patch: Partial<Omit<WizardState, 'set' | 'reset'>>) => void
  reset: () => void
}

const initial = {
  niche: '', subNiche: '', style: '', format: '', characters: [], voiceMode: '',
  frequency: '', qualityTier: 'standard', aspect: '9:16',
}

export const useWizard = create<WizardState>()(
  persist(
    (set) => ({ ...initial, set: (patch) => set(patch), reset: () => set({ ...initial }) }),
    { name: 'vdo-teller-wizard' },
  ),
)
