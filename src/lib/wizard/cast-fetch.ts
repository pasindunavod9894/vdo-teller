'use client'
import { create } from 'zustand'
import type { CastOption } from '@/lib/art/cast-options'
import type { StyleBible } from '@/lib/styles/bible'
import { useWizard } from './store'

/**
 * The background work that starts the moment a style card is clicked: the style bible, then the three cast options (their group
 * portraits take a while). It lives in memory only (the portraits are big data URLs), so the Characters step is usually ready
 * when the user arrives, and a style change throws the old result away.
 */
export type CastFetchState = {
  /** niche | sub-niche | style the current result belongs to */
  key: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  options: CastOption[]
  source: 'ai' | 'mock' | null
  error: string
  /** the current load is a "Regenerate options" one */
  regenerating: boolean
}

const idle: CastFetchState = { key: '', status: 'idle', options: [], source: null, error: '', regenerating: false }
export const useCastFetch = create<CastFetchState>()(() => idle)

export type CastFetchInput = { niche: string; subNiche: string; style: string }
const keyOf = (i: CastFetchInput) => [i.niche, i.subNiche, i.style].join('|')

let token = 0

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'Could not make the cast options')
  return json as T
}

/** Starts the fetch (always). A newer call makes every older one stale, so late answers are ignored. */
export function startCastFetch(input: CastFetchInput, regenerate = false) {
  const key = keyOf(input)
  const mine = ++token
  const stale = () => mine !== token
  useCastFetch.setState({ key, status: 'loading', options: [], source: null, error: '', regenerating: regenerate })
  const body = { niche: input.niche, subNiche: input.subNiche || undefined, style: input.style }
  ;(async () => {
    if (!regenerate) {
      // The bible is needed at signup. If it fails here the cast call still researches it itself.
      try {
        const { bible } = await post<{ bible: StyleBible }>('/api/style', body)
        if (!stale() && useWizard.getState().style === input.style) useWizard.getState().set({ styleBible: bible })
      } catch { /* keep going */ }
      if (stale()) return
    }
    const r = await post<{ options: CastOption[]; source: 'ai' | 'mock' }>('/api/cast-options', { ...body, regenerate: regenerate || undefined })
    if (!stale()) useCastFetch.setState({ key, status: 'ready', options: r.options, source: r.source, error: '', regenerating: false })
  })().catch((e) => {
    if (!stale()) useCastFetch.setState({ key, status: 'error', options: [], source: null, error: e instanceof Error ? e.message : 'Could not make the cast options', regenerating: false })
  })
}

/** Starts the fetch unless the same one is already running or done. */
export function ensureCastFetch(input: CastFetchInput) {
  const s = useCastFetch.getState()
  if (s.key === keyOf(input) && (s.status === 'loading' || s.status === 'ready')) return
  startCastFetch(input)
}

/** What the wizard sends as the sub-niche: the readable name, falling back to the id. */
export const subNicheLabel = (w: { subNicheName: string; subNiche: string }) => w.subNicheName || w.subNiche
