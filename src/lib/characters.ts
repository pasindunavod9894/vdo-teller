import { hasBrand } from '../pipeline/brand-safety'
import type { CastCharacter } from './art/cast-options'

/**
 * The rules for a main character, one place for the wizard (which checks as you type), the dashboard (which adds one later) and the
 * server (which checks again, because anything typed is untrusted and ends up in image prompts). Pure.
 */
export const MAX_MAIN_CHARACTERS = 3

export const LIMITS = { nameMin: 2, nameMax: 40, role: 60, lookMin: 8, lookMax: 400, outfit: 120, personality: 120, instructions: 200 } as const

/** What a person writes for a character (the voice is chosen separately). */
export type CharacterDraft = { name: string; role: string; look: string; outfit: string; personality: string }

/** Text a person typed, made safe for a prompt: no control characters or angle brackets, one line of single spaces, cut to its length. */
export const cleanText = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export const cleanCharacter = (c: Partial<CharacterDraft>): CharacterDraft => ({
  name: cleanText(c.name, LIMITS.nameMax), role: cleanText(c.role, LIMITS.role), look: cleanText(c.look, LIMITS.lookMax),
  outfit: cleanText(c.outfit, LIMITS.outfit), personality: cleanText(c.personality, LIMITS.personality),
})

/** What is wrong with one character, in words for the person who typed it; empty means it can be used. */
export function characterProblems(input: Partial<CharacterDraft>): string[] {
  const c = cleanCharacter(input)
  const out: string[] = []
  if (c.name.length < LIMITS.nameMin) out.push(`Give the character a name (${LIMITS.nameMin} to ${LIMITS.nameMax} characters).`)
  if (c.look.length < LIMITS.lookMin) out.push('Describe what the character looks like: the species or age, colours and one signature detail.')
  for (const [field, text] of Object.entries(c)) {
    if (text && hasBrand(text)) { out.push(`The ${field} names a studio, brand or existing character. Please use an original name and description.`); break }
  }
  return out
}

/** What is wrong with a whole cast: how many characters it has, and two with the same name. */
export function castProblems(cast: Partial<CharacterDraft>[]): string[] {
  const out: string[] = []
  if (cast.length < 1) out.push('Add at least one main character.')
  if (cast.length > MAX_MAIN_CHARACTERS) out.push(`A series has at most ${MAX_MAIN_CHARACTERS} main characters.`)
  const names = cast.map((c) => cleanText(c.name, LIMITS.nameMax).toLowerCase()).filter(Boolean)
  if (new Set(names).size !== names.length) out.push('Two characters have the same name. Give each its own.')
  cast.forEach((c, i) => { const p = characterProblems(c)[0]; if (p) out.push(`Character ${i + 1}: ${p}`) })
  return out
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'character'

/** An id for a new character that none of the `taken` ones has (the wizard keys voices by it). */
export function uniqueCharacterId(name: string, taken: readonly string[]): string {
  const base = slug(name)
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/** A character made from what a person typed, ready for the wizard's cast: a voice is suggested and can be changed in the Voice step. */
export const castCharacterFrom = (draft: Partial<CharacterDraft>, taken: readonly string[], voice: string): CastCharacter => {
  const c = cleanCharacter(draft)
  return { id: uniqueCharacterId(c.name, taken), ...c, voice }
}

/** The Characters records a signup creates from the wizard's cast: the look and outfit become the description every prompt uses. */
export function characterRecords(cast: readonly CastCharacter[], voices: Record<string, { voice: string; instructions?: string }>, speaking: boolean, seriesId: string | number) {
  return cast.map((c) => {
    const v = speaking ? voices[c.id] : undefined
    return {
      series: seriesId, name: c.name, role: c.role,
      bible: { look: c.look, outfit: c.outfit, personality: c.personality },
      canonicalDescription: `${c.look} ${c.outfit}`.trim(),
      voiceProfile: v ? { voice: v.voice, instructions: v.instructions || undefined } : undefined,
    }
  })
}
