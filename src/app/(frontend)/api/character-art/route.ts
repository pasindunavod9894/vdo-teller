import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { z } from 'zod'
import { ArtError, createNextAsset, createReference, packStatus } from '@/lib/art/service'

const Body = z.object({ characterId: z.union([z.string(), z.number()]), action: z.enum(['status', 'reference', 'next-asset']) })

export async function POST(req: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'Image generation needs an OpenAI key.' }, { status: 503 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { characterId, action } = parsed.data
  try {
    if (action === 'status') return NextResponse.json(await packStatus(payload, user, characterId))
    if (action === 'reference') return NextResponse.json(await createReference(payload, user, characterId))
    return NextResponse.json(await createNextAsset(payload, user, characterId))
  } catch (e) {
    if (e instanceof ArtError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[character-art]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Image generation failed. Try again.' }, { status: 502 })
  }
}
