import { VOICES } from '../lib/voices'
import type { Script, ShotList } from './schemas'

/**
 * The cast rule (plan R1-B.4): the series' main characters lead every reel, the Story Builder may add supporting characters
 * (declared in the script, each one gets a reference image before any keyframe), and nobody else may speak or appear.
 */
export const NARRATOR = 'narrator'

/** Names a reel may use: the main cast plus the supporting cast its own script declares. */
export function allowedNames(main: string[], script: Pick<Script, 'supportingCast'>): Set<string> {
  return new Set([...main, ...script.supportingCast.map((s) => s.name)])
}

/** Everything wrong with the cast of a script (and optionally its shot list); an empty list means it is fine. Pure. */
export function castViolations(main: string[], script: Script, shots?: ShotList): string[] {
  const out: string[] = []
  const allowed = allowedNames(main, script)
  const mainSet = new Set(main)
  for (const s of script.supportingCast) {
    if (mainSet.has(s.name)) out.push(`Supporting character "${s.name}" has the same name as a main character.`)
  }
  const names = script.supportingCast.map((s) => s.name.toLowerCase())
  if (new Set(names).size !== names.length) out.push('Two supporting characters share a name.')
  for (const b of script.beats) {
    if (b.speaker && b.speaker !== NARRATOR && !allowed.has(b.speaker)) out.push(`Beat ${b.n}: "${b.speaker}" is not in the cast.`)
  }
  for (const sh of shots?.shots ?? []) {
    for (const c of sh.characters) if (!allowed.has(c)) out.push(`Shot ${sh.n}: "${c}" is not in the cast.`)
  }
  if (shots && main.length && !shots.shots.some((sh) => sh.characters.some((c) => mainSet.has(c)))) out.push('No shot features a main character.')
  return out
}

/** A voice for a supporting character: the one the script asks for if it is a real voice, else the first voice nobody in the main cast uses. */
export function voiceForSupporting(requested: string | null, usedVoices: string[]): string {
  const ids: string[] = VOICES.map((v) => v.id)
  if (requested && ids.includes(requested)) return requested
  return ids.find((v) => !usedVoices.includes(v) && v !== 'fable') ?? ids[0]
}
