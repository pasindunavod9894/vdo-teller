'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/** If the series has no saved theme yet, ask the server to pick one (one cheap call), then refresh. */
export function ThemeBootstrap({ seriesId, hasTheme }: { seriesId: number | string; hasTheme: boolean }) {
  const router = useRouter()
  const started = useRef(false)
  useEffect(() => {
    if (hasTheme || started.current) return
    started.current = true
    fetch('/api/series-theme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seriesId }) })
      .then((r) => r.ok && router.refresh())
      .catch(() => {})
  }, [hasTheme, seriesId, router])
  return null
}
