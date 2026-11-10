import { NextResponse } from 'next/server'
import { z } from 'zod'
import { castProblems, cleanCharacter } from '@/lib/characters'
import { moderateTexts } from '@/pipeline/moderation'

const Draft = z.object({ name: z.string().max(200), role: z.string().max(200).optional().default(''), look: z.string().max(2000), outfit: z.string().max(500).optional().default(''), personality: z.string().max(500).optional().default('') })
const Body = z.object({ characters: z.array(Draft).min(1).max(3) })

// The wizard asks this when a character is saved, before the person has an account, so a refusal shows at once and not at signup: the same
// originality rules as the server applies when the character is stored, and the free content check. Nothing is stored here.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const drafts = parsed.data.characters.map((c) => cleanCharacter(c))
  const problems = castProblems(drafts)
  if (problems.length) return NextResponse.json({ problems })
  const verdict = await moderateTexts(drafts.flatMap((c) => [c.name, c.role, c.look, c.outfit, c.personality]))
  return NextResponse.json({ problems: verdict.flagged ? ['That description was flagged by the content check, so it cannot be used. Try describing the character differently.'] : [] })
}
