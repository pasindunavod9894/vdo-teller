'use client'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { useSyncExternalStore } from 'react'
import type { CastCharacter, CastOption } from '@/lib/art/cast-options'
import type { StyleBible } from '@/lib/styles/bible'

export type VoicePick = { voice: string; instructions: string }
/** How the Showrunner rated the chosen style or voice mode for this niche; saved with the series. */
export type Applicability = { status: 'recommended' | 'suitable' | 'not_suitable'; why: string }

export type WizardState = {
  niche: string
  /** the sub-niche id (as the research returned it) and its readable name; the name is what the series saves */
  subNiche: string
  subNicheName: string
  style: string
  styleApplicability: Applicability | null
  /** the Style agent's recipe for the chosen style, fetched in the background when the style is picked */
  styleBible: StyleBible | null
  /** the AI cast the person started from (its portrait is shown), or null when they wrote their own */
  castOption: CastOption | null
  /** the series' main characters, 1 to 3: the ones from a cast option, changed or not, and any the person added themselves */
  cast: CastCharacter[]
  narrator: VoicePick | null
  /** one voice per main character of the chosen cast, by character id */
  voices: Record<string, VoicePick>
  voiceMode: string
  voiceApplicability: Applicability | null
  /** every video is vertical 9:16; this is a fixed value, never a choice */
  aspect: '9:16'
  set: (patch: Partial<Omit<WizardState, 'set' | 'reset'>>) => void
  reset: () => void
}

const initial = {
  niche: '', subNiche: '', subNicheName: '', style: '', styleApplicability: null, styleBible: null, castOption: null, cast: [],
  narrator: null, voices: {}, voiceMode: '', voiceApplicability: null, aspect: '9:16' as const,
}

/** localStorage that never throws (private windows, blocked storage, quota), so the wizard still works from memory. */
const safeStorage: StateStorage = {
  getItem: (name) => { try { return localStorage.getItem(name) } catch { return null } },
  setItem: (name, value) => { try { localStorage.setItem(name, value) } catch { /* quota or blocked: keep the choices in memory only */ } },
  removeItem: (name) => { try { localStorage.removeItem(name) } catch { /* ignore */ } },
}

export const useWizard = create<WizardState>()(
  persist(
    (set) => ({ ...initial, set: (patch) => set(patch), reset: () => set({ ...initial }) }),
    {
      name: 'vdo-teller-wizard',
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      // The group portrait is a large data URL and is not needed once the cast is chosen, so it is not saved.
      partialize: (s) => ({ ...s, castOption: s.castOption ? { ...s.castOption, image: null } : null }),
      // Version 2 saved the chosen cast whole: its characters become the editable cast. Older versions saved a posting schedule, a quality tier and
      // a custom character list; those answers start again.
      migrate: (old, version) => {
        if (version === 2 && old && typeof old === 'object') {
          const o = old as Partial<WizardState>
          return { ...o, cast: o.castOption?.characters ?? [] } as unknown as WizardState
        }
        return { ...initial, niche: String((old as { niche?: string } | null)?.niche ?? '') } as unknown as WizardState
      },
    },
  ),
)

/** True once the persisted choices have been read from localStorage (avoids redirecting on a reload). */
export function useWizardHydrated() {
  return useSyncExternalStore(
    (onChange) => useWizard.persist.onFinishHydration(onChange),
    () => useWizard.persist.hasHydrated(),
    () => false,
  )
}
