import { REEL } from '../lib/format'
import type { Script } from './schemas'

/** All the words the script has people say (characters and narrator together). */
export function spokenWords(script: Pick<Script, 'beats'>): number {
  return script.beats.reduce((n, b) => n + (b.line ? b.line.split(/\s+/).filter(Boolean).length : 0), 0)
}

/**
 * The length rule: a reel of 25 to 30 seconds can only hold so many beats and so many spoken words. Checked in code before the
 * Critic sees a script, like the cast rule, so a script that is too long goes straight back to the Writer. Empty means fine. Pure.
 */
export function lengthViolations(script: Pick<Script, 'beats'>): string[] {
  const spec = REEL
  const out: string[] = []
  const n = script.beats.length
  const [min, max] = spec.beats
  if (n < min || n > max) out.push(`The script has ${n} beats; a ${spec.label} reel needs ${min === max ? min : `${min} to ${max}`} (one shot each).`)
  const words = spokenWords(script)
  if (words > spec.maxSpokenWords) out.push(`The spoken lines have ${words} words in total; a ${spec.label} reel can carry at most ${spec.maxSpokenWords}. Shorten the lines.`)
  return out
}
