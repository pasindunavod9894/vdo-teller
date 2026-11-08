import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from 'zod'
import { VOICE_IDS } from '@/lib/voices'

const Body = z.object({ voice: z.enum(VOICE_IDS), instructions: z.string().max(200).optional(), name: z.string().max(40).optional() })

// Public wizard endpoint -> small per-IP limit, fixed sample line, and an in-memory cache so the same preview is never paid for twice.
const hits = new Map<string, number[]>()
const cache = new Map<string, Buffer>()
function limited(ip: string) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 40
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'Voice preview needs an OpenAI key.' }, { status: 503 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (limited(ip)) return NextResponse.json({ error: 'Too many previews, try again later.' }, { status: 429 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { voice, instructions, name } = parsed.data
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  if (instructions || name) {
    const m = await client.moderations.create({ model: 'omni-moderation-latest', input: `${name ?? ''} ${instructions ?? ''}` })
    if (m.results[0]?.flagged) return NextResponse.json({ error: 'That text is not allowed.' }, { status: 422 })
  }
  const who = (name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim()
  const text = who ? `Hi, I'm ${who}. This is how I will sound in every episode.` : `Hi there! This is how I will sound in every episode.`
  const key = `${voice}|${instructions ?? ''}|${text}`
  let audio = cache.get(key)
  if (!audio) {
    const res = await client.audio.speech.create({ model: 'gpt-4o-mini-tts', voice, input: text, instructions, response_format: 'mp3' })
    audio = Buffer.from(await res.arrayBuffer())
    if (cache.size > 200) cache.clear()
    cache.set(key, audio)
  }
  return new NextResponse(new Uint8Array(audio), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600' } })
}
