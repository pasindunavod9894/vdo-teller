import { z } from 'zod'
import { BeatSchema, type Script } from './schemas'

/**
 * A revision from the Writer that carries ONLY what changed (plan §3b: output tokens cost the most). The Orchestrator merges
 * it into the previous script in code, so a one-line fix costs a one-line answer instead of the whole script again.
 */
export const ScriptPatchSchema = z.object({
  title: z.string().nullable().describe('new title, or null to keep it'),
  hook: z.string().nullable().describe('new hook, or null to keep it'),
  payoff: z.string().nullable().describe('new payoff, or null to keep it'),
  beats: z.array(BeatSchema).describe('ONLY the beats you changed or added, each complete, with the same "n" as the beat it replaces; empty if no beat changes'),
})
export type ScriptPatch = z.infer<typeof ScriptPatchSchema>

/** Applies a patch to a script: changed beats replace the beats with the same number, new numbers are added, order is by number. */
export function mergeScriptPatch(prev: Script, patch: ScriptPatch): Script {
  const beats = new Map(prev.beats.map((b) => [b.n, b]))
  for (const b of patch.beats) beats.set(b.n, b)
  return {
    title: patch.title ?? prev.title,
    hook: patch.hook ?? prev.hook,
    payoff: patch.payoff ?? prev.payoff,
    beats: [...beats.values()].sort((a, b) => a.n - b.n),
  }
}
