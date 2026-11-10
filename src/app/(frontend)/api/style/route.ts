import { NextResponse } from 'next/server'
import { z } from 'zod'
import { STYLE_IDS } from '@/lib/styles/catalogue'
import { cleanNiche, researchStyleBible, topicAllowed } from '@/lib/research/service'

const Body = z.object({ niche: z.string().min(2).max(120), subNiche: z.string().max(120).optional(), style: z.enum(STYLE_IDS) })

// The wizard is public (before signup), so protect the paid API with a small per-IP limit.
const hits = new Map<string, number[]>()
const LIMIT = 40
function limited(ip: string) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > LIMIT
}

/** Writes (or returns the cached) style bible for a niche + style, as soon as the user picks a style in the wizard. */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (limited(ip)) return NextResponse.json({ error: 'Too many requests, try again later.' }, { status: 429 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const niche = cleanNiche(parsed.data.niche)
  if (niche.length < 2) return NextResponse.json({ error: 'Invalid topic' }, { status: 400 })
  if (!(await topicAllowed(niche))) return NextResponse.json({ error: 'That topic is not allowed.' }, { status: 422 })
  return NextResponse.json(await researchStyleBible(niche, cleanNiche(parsed.data.subNiche ?? ''), parsed.data.style))
}
