'use client'
import { useEffect, useState } from 'react'
import type { OptionsPayload } from './service-types'
import type { SubNiche } from '@/lib/wizard/mock-data'

type State<T> = { data: T | null; loading: boolean; error: string; source: 'ai' | 'mock' | null }

const memory = new Map<string, unknown>()

function useResearch<T extends { source: 'ai' | 'mock' }>(enabled: boolean, cacheKey: string, body: object): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: enabled, error: '', source: null })
  useEffect(() => {
    if (!enabled) return
    const hit = memory.get(cacheKey) as T | undefined
    if (hit) { setState({ data: hit, loading: false, error: '', source: hit.source }); return }
    let cancelled = false
    setState({ data: null, loading: true, error: '', source: null })
    fetch('/api/research', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Research failed')
        return j as T
      })
      .then((j) => { memory.set(cacheKey, j); if (!cancelled) setState({ data: j, loading: false, error: '', source: j.source }) })
      .catch((e) => { if (!cancelled) setState({ data: null, loading: false, error: e.message, source: null }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey])
  return state
}

export const useSubNiches = (enabled: boolean, niche: string) =>
  useResearch<{ subNiches: SubNiche[]; source: 'ai' | 'mock' }>(enabled && !!niche, `sub:${niche}`, { kind: 'sub-niches', niche })

export const useOptions = (enabled: boolean, niche: string, subNiche: string) =>
  useResearch<OptionsPayload & { source: 'ai' | 'mock' }>(enabled && !!niche, `opt:${niche}:${subNiche}`, { kind: 'options', niche, subNiche })
