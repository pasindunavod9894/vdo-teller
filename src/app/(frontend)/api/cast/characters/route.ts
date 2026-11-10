import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { z } from 'zod'
import { addCharacter, CharacterError, removeCharacter } from '@/lib/art/characters'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), seriesId: z.union([z.string(), z.number()]), character: z.unknown() }),
  z.object({ action: z.literal('remove'), characterId: z.union([z.string(), z.number()]) }),
])

// Add a main character to a series, or remove one. This lives under /api/cast, NOT /api/characters: that path is Payload's own REST route for
// creating a character (signup posts there), and an app route of the same path would shadow it.
// The same rules apply as at signup: original, at most three, each with its own name.
// A new character's reference pack is built by the cast panel the next time the dashboard is open (nothing is spent here).
export async function POST(req: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    if (parsed.data.action === 'add') return NextResponse.json(await addCharacter(payload, user, parsed.data.seriesId, parsed.data.character))
    return NextResponse.json(await removeCharacter(payload, user, parsed.data.characterId))
  } catch (e) {
    if (e instanceof CharacterError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[characters]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
