import 'server-only'
import { APIError, type Payload } from 'payload'
import { z } from 'zod'
import type { User } from '@/payload-types'
import { castProblems, characterProblems, cleanText, LIMITS, MAX_MAIN_CHARACTERS } from '@/lib/characters'
import { VOICE_IDS } from '@/lib/voices'
import { moderateTexts } from '@/pipeline/moderation'

/** A character that cannot be saved, with what to tell the person and the HTTP status for a route. */
export class CharacterError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- a character as Payload hands it to a hook
export type VetContext = {
  operation: 'create' | 'update'
  /** the character as it is stored, for an update */
  original?: Doc | null
  /** the other characters of a series */
  siblings: (seriesId: string | number) => Promise<{ id: string | number; name: string }[]>
  moderate: (texts: string[]) => Promise<{ flagged: boolean; reasons: string[] }>
}

const idOf = (v: unknown) => (v && typeof v === 'object' ? (v as { id: string | number }).id : (v as string | number))

/**
 * Checks and cleans a character before it is saved, whoever sends it (the wizard at signup, the dashboard, a script). Everything typed is
 * untrusted: it ends up in image prompts. The text is cleaned in place, then: it must describe an original character, a series has at most
 * three main characters with different names, and the free content check must not flag it. Throws a `CharacterError` to show the person.
 */
export async function vetCharacter(data: Doc, ctx: VetContext): Promise<void> {
  const touches = ['name', 'role', 'bible', 'canonicalDescription', 'voiceProfile'].some((k) => k in data)
  if (ctx.operation === 'update' && !touches) return

  const was = ctx.original ?? {}
  if ('name' in data || ctx.operation === 'create') data.name = cleanText(data.name, LIMITS.nameMax)
  if ('role' in data) data.role = cleanText(data.role, LIMITS.role)
  if (data.bible && typeof data.bible === 'object') {
    data.bible = { ...data.bible, look: cleanText(data.bible.look, LIMITS.lookMax), outfit: cleanText(data.bible.outfit, LIMITS.outfit), personality: cleanText(data.bible.personality, LIMITS.personality) }
  }
  if (typeof data.canonicalDescription === 'string') data.canonicalDescription = cleanText(data.canonicalDescription, 600)
  if (data.voiceProfile && typeof data.voiceProfile === 'object') {
    const v = data.voiceProfile
    if (v.voice && !(VOICE_IDS as readonly string[]).includes(v.voice)) throw new CharacterError('Pick one of the available voices.')
    if ('instructions' in v) v.instructions = cleanText(v.instructions, LIMITS.instructions)
  }

  // the whole character is judged, with whatever the update does not change taken from what is stored
  const name = data.name ?? was.name
  const bible = { ...(was.bible ?? {}), ...(data.bible ?? {}) }
  const draft = { name, role: data.role ?? was.role ?? '', look: bible.look ?? '', outfit: bible.outfit ?? '', personality: bible.personality ?? '' }
  const problem = characterProblems(draft)[0]
  if (problem) throw new CharacterError(problem)

  const seriesId = idOf(data.series ?? was.series)
  if (seriesId !== undefined && seriesId !== null) {
    const others = (await ctx.siblings(seriesId)).filter((c) => String(c.id) !== String(was.id ?? ''))
    if (ctx.operation === 'create' && others.length >= MAX_MAIN_CHARACTERS) throw new CharacterError(`A series has at most ${MAX_MAIN_CHARACTERS} main characters.`, 409)
    if (others.some((c) => c.name.trim().toLowerCase() === String(name).trim().toLowerCase())) throw new CharacterError(`There is already a character called "${name}" in this series. Give each its own name.`, 409)
  }

  const verdict = await ctx.moderate([draft.name, draft.role, draft.look, draft.outfit, draft.personality, data.voiceProfile?.instructions ?? ''])
  if (verdict.flagged) throw new CharacterError('That description was flagged by the content check, so it cannot be used. Try describing the character differently.', 422)
}

/** The hook of the Characters collection: vets a character with the real database and the free moderation check, and shows a `CharacterError` as a public message. */
export async function vetCharacterHook(args: { data: Doc; req: { payload: Payload }; operation: string; originalDoc?: Doc }): Promise<void> {
  if (args.operation !== 'create' && args.operation !== 'update') return
  try {
    await vetCharacter(args.data, {
      operation: args.operation, original: args.originalDoc,
      siblings: async (seriesId) => (await args.req.payload.find({ collection: 'characters', where: { series: { equals: seriesId } }, depth: 0, limit: 20, overrideAccess: true })).docs.map((d) => ({ id: d.id, name: d.name })),
      moderate: (texts) => moderateTexts(texts),
    })
  } catch (e) {
    if (e instanceof CharacterError) throw new APIError(e.message, e.status, undefined, true)
    throw e
  }
}

// ---------- add and remove a character of a series that exists ----------

export const CharacterInputSchema = z.object({
  name: z.string().max(200), role: z.string().max(200).optional().default(''), look: z.string().max(2000), outfit: z.string().max(500).optional().default(''),
  personality: z.string().max(500).optional().default(''), voice: z.enum(VOICE_IDS), voiceInstructions: z.string().max(500).optional().default(''),
})
export type CharacterInput = z.infer<typeof CharacterInputSchema>

async function ownedSeries(payload: Payload, user: User, seriesId: string | number) {
  const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!series || idOf(series.owner) !== user.id || series.status === 'removed') throw new CharacterError('Series not found', 404)
  return series
}

/** Adds a main character to a series. The vetting rules (originality, at most three, own name, content check) run when it is saved. */
export async function addCharacter(payload: Payload, user: User, seriesId: string | number, raw: unknown) {
  const series = await ownedSeries(payload, user, seriesId)
  const parsed = CharacterInputSchema.safeParse(raw)
  if (!parsed.success) throw new CharacterError('Check the character: every field must be filled in as asked.')
  const c = parsed.data
  const problems = castProblems([c])
  if (problems.length) throw new CharacterError(problems[0].replace(/^Character 1: /, ''))
  try {
    const doc = await payload.create({
      collection: 'characters', overrideAccess: false, user,
      data: {
        series: series.id, owner: user.id, name: c.name, role: c.role,
        bible: { look: c.look, outfit: c.outfit, personality: c.personality }, canonicalDescription: `${c.look} ${c.outfit}`.trim(),
        voiceProfile: { voice: c.voice, instructions: c.voiceInstructions || undefined },
      } as never,
    })
    return { id: doc.id, name: doc.name }
  } catch (e) {
    if (e instanceof APIError) throw new CharacterError(e.message, e.status)
    throw e
  }
}

/** Removes a main character and its reference images. A series keeps at least one; videos already made keep their look. */
export async function removeCharacter(payload: Payload, user: User, characterId: string | number) {
  const character = await payload.findByID({ collection: 'characters', id: characterId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!character || idOf(character.owner) !== user.id) throw new CharacterError('Character not found', 404)
  const seriesId = idOf(character.series)
  const { docs: mates } = await payload.find({ collection: 'characters', where: { series: { equals: seriesId } }, depth: 0, limit: 20, overrideAccess: true })
  if (mates.length <= 1) throw new CharacterError('A series needs at least one main character.', 409)

  const mediaIds = new Set<string | number>((character.referenceImages ?? []).map(idOf))
  const { docs: packs } = await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 0, limit: 5, overrideAccess: true })
  for (const pack of packs) {
    for (const item of pack.items ?? []) if (item.image) mediaIds.add(idOf(item.image))
    await payload.delete({ collection: 'asset-packs', id: pack.id, overrideAccess: true })
  }
  await payload.delete({ collection: 'characters', id: character.id, overrideAccess: true })
  for (const id of mediaIds) await payload.delete({ collection: 'media', id, overrideAccess: true }).catch(() => undefined)
  return { removed: true as const, name: character.name }
}
