import { NextResponse } from 'next/server'
import { z } from 'zod'
import { STYLE_IDS } from '@/lib/styles/catalogue'
import { cleanNiche, researchCastOptions, topicAllowed } from '@/lib/research/service'

const Body = z.object({ niche: z.string().min(2).max(120), subNiche: z.string().max(120).optional(), style: z.enum(STYLE_IDS), regenerate: z.boolean().optional() })

// The wizard is public (before signup) and this call makes images, so the per-IP limit is small.
const hits = new Map<string, number[]>()
const LIMIT = 12
function limited(ip: string) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > LIMIT
}

/** Proposes (or returns the cached) three cast options with group portraits, as soon as the user picks a style. */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const niche = cleanNiche(parsed.data.niche)
  if (niche.length < 2) return NextResponse.json({ error: 'Invalid topic' }, { status: 400 })
  // cached answers cost nothing; only a fresh proposal (or a regeneration) counts against the limit
  if (parsed.data.regenerate && limited(ip)) return NextResponse.json({ error: 'Too many new cast requests, try again later.' }, { status: 429 })
  if (!(await topicAllowed(niche))) return NextResponse.json({ error: 'That topic is not allowed.' }, { status: 422 })
  return NextResponse.json(await researchCastOptions(niche, cleanNiche(parsed.data.subNiche ?? ''), parsed.data.style, parsed.data.regenerate === true))
}
