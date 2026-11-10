import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { z } from 'zod'
import { ArtError, createExpressions, createNextAsset, createReference, packStatus, unlockCharacter } from '@/lib/art/service'
import { characterImageProvider } from '@/lib/art/fal-images'

const Body = z.object({
  characterId: z.union([z.string(), z.number()]),
  action: z.enum(['status', 'reference', 'expressions', 'next-asset', 'unlock']),
  /** for 'unlock' (Edit character): what to change; the reference sheet and expressions are then made again from it */
  patch: z.object({ name: z.string().max(60).optional(), look: z.string().max(400).optional(), personality: z.string().max(200).optional() }).optional(),
})

export async function POST(req: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  // the text model that writes each character's description is OpenAI; the pictures come from fal.ai or OpenAI (CHARACTER_IMAGE_PROVIDER)
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'Image generation needs an OpenAI key.' }, { status: 503 })
  if (characterImageProvider() === 'fal' && !process.env.FAL_KEY) return NextResponse.json({ error: 'Image generation needs a fal.ai key.' }, { status: 503 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { characterId, action, patch } = parsed.data
  try {
    if (action === 'status') return NextResponse.json(await packStatus(payload, user, characterId))
    if (action === 'reference') return NextResponse.json(await createReference(payload, user, characterId))
    if (action === 'expressions') return NextResponse.json(await createExpressions(payload, user, characterId))
    if (action === 'unlock') return NextResponse.json(await unlockCharacter(payload, user, characterId, patch ?? {}))
    return NextResponse.json(await createNextAsset(payload, user, characterId))
  } catch (e) {
    if (e instanceof ArtError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[character-art]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Image generation failed. Try again.' }, { status: 502 })
  }
}
