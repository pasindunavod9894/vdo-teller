import { closestExpression } from '../lib/expressions'
import type { VibeId } from '../lib/vibes'
import type { Idea, Script } from './schemas'

/** Fewest different expressions a reel must show: a story changes how its characters feel, so one or two faces is not a story. */
export const MIN_DISTINCT_EXPRESSIONS = 3

/**
 * A script's beats name an expression each. The model is told which ones the series has, but a wrong one is not worth a rewrite: it is moved
 * to the nearest expression the series does have (a missing one becomes neutral). Pure.
 */
export function normalizeExpressions(script: Script, allowed: readonly string[]): Script {
  return { ...script, beats: script.beats.map((b) => ({ ...b, expression: closestExpression(String(b.expression ?? 'neutral'), allowed) as Script['beats'][number]['expression'] })) }
}

/** The script with its expressions fitted to the series and the vibe of its idea attached (the Writer does not write the vibe: the idea has it). */
export const attachStory = (script: Script, vibe: VibeId | undefined, allowed: readonly string[]): Script =>
  ({ ...normalizeExpressions(script, allowed), ...(vibe ? { vibe } : {}) })

/**
 * The story rule, checked in code before the Critic sees a script (like the cast and length rules): the reel must show at least three
 * different expressions, because a story changes how its characters feel. Empty means fine. Pure.
 */
export function storyViolations(script: Script): string[] {
  const out: string[] = []
  const faces = script.beats.map((b) => b.expression)
  const distinct = new Set(faces).size
  if (distinct < MIN_DISTINCT_EXPRESSIONS) out.push(`The beats show only ${distinct} different expression${distinct === 1 ? '' : 's'}; a story changes how the character feels, so use at least ${MIN_DISTINCT_EXPRESSIONS}, following the vibe's arc.`)
  return out
}

/**
 * What is wrong with the Creator's three ideas, in words the Creator can act on; empty means they are fine: every vibe is one this series
 * offers, no two ideas share a vibe, and none repeats the vibe of a recent reel (unless there are not enough other vibes to choose from).
 */
export function ideaProblems(ideas: Idea[], allowed: readonly VibeId[], avoid: readonly VibeId[]): string[] {
  const out: string[] = []
  ideas.forEach((idea, i) => { if (!allowed.includes(idea.vibe)) out.push(`Idea ${i + 1} uses the vibe "${idea.vibe}", which this series does not offer. Choose from: ${allowed.join(', ')}.`) })
  const seen = new Map<string, number>()
  ideas.forEach((idea, i) => {
    const first = seen.get(idea.vibe)
    if (first !== undefined) out.push(`Ideas ${first + 1} and ${i + 1} have the same vibe "${idea.vibe}"; every idea needs a different vibe.`)
    else seen.set(idea.vibe, i)
  })
  if (allowed.filter((v) => !avoid.includes(v)).length >= ideas.length) {
    ideas.forEach((idea, i) => { if (avoid.includes(idea.vibe)) out.push(`Idea ${i + 1} uses the vibe "${idea.vibe}" of a recent reel; use a different vibe.`) })
  }
  return out
}
