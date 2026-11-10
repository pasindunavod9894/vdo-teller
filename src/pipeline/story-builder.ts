import * as agents from './agents'
import type { AgentResult, Ctx, Usage } from './ctx'
import { addUsage, runTextAgent } from './llm'
import { castViolations } from './cast'
import { lengthViolations } from './length'
import { emptyMemory, hydrateRecurring, memoryBrief } from './memory'
import { moderateTexts, scriptTexts } from './moderation'
import { BudgetError } from './errors'
import { PickSchema, type Critique, type Idea, type Script } from './schemas'
import { attachStory, storyViolations } from './story-rules'
import { expressionsOf } from '../lib/expressions'
import { recentVibes } from '../lib/vibes'
import { MAX_REVISION_ROUNDS } from './steps'

/**
 * The Story Builder (plan R3): from the Creator's ideas to an approved script, as ONE agent step.
 *   1. pick the best idea (a small scoring call),
 *   2. write the script for the reel format,
 *   3. check the cast, length and story rules IN CODE (a failure goes straight back to the Writer without paying for the Critic),
 *   4. the Critic scores a rubric; approval is decided in code; only the failing beats are rewritten (patch revisions), at most 3 rounds,
 *   5. a free moderation check on the final texts.
 * It returns the script even if the Critic never approved it (the last attempt), like the loop it replaced; a policy or originality
 * risk is what stops an episode.
 */
export type StoryResult = { idea: Idea; script: Script; critique: Critique; rounds: number }

async function pickIdea(ctx: Ctx, ideas: Idea[]): Promise<{ idea: Idea; note: string; usage?: Usage }> {
  if (ideas.length <= 1 || ctx.mode !== 'text') return { idea: ideas[0], note: ideas.length > 1 ? 'first idea' : 'only idea' }
  const raw = await runTextAgent('picker', 'picker', PickSchema, ctx, { ideas, memory: memoryBrief(ctx.memory ?? emptyMemory()), avoidTitles: ctx.avoidTitles ?? [], avoidVibes: recentVibes(ctx.memory ?? emptyMemory()) })
  const i = Math.max(0, Math.min(ideas.length - 1, Math.round(raw.output.bestIndex)))
  return { idea: ideas[i], note: raw.output.reason, usage: raw.usage }
}

export async function storyBuilder(ctx: Ctx, ideas: Idea[]): Promise<AgentResult<StoryResult>> {
  if (!ideas.length) throw new Error('The Story Builder has no idea to write')
  const mainCast = ctx.profile.cast.length ? ctx.profile.cast.map((c) => c.name) : ['the hero']
  const memory = ctx.memory ?? emptyMemory()
  const allowedFaces = expressionsOf(ctx.profile.expressions)
  const usages: (Usage | undefined)[] = []
  const ask = async () => { if (ctx.canSpend && !(await ctx.canSpend(0.05))) throw new BudgetError() }

  await ask()
  const picked = await pickIdea(ctx, ideas)
  usages.push(picked.usage)
  const idea = picked.idea

  let script: Script | null = null
  let critique: Critique | null = null
  let notes: string[] = []
  let rounds = 0
  for (let round = 1; round <= MAX_REVISION_ROUNDS; round++) {
    rounds = round
    await ask()
    const w = await agents.writer(ctx, idea, notes, script)
    usages.push(w.usage)
    // the vibe of the idea is attached, and every beat's expression is fitted to the ones this series has
    script = attachStory(hydrateRecurring(w.output, memory, mainCast), idea.vibe, allowedFaces)
    // the cast, length and story rules are checked in code before the Critic sees the script: only the main cast and declared supporting
    // characters, only as many beats and spoken words as the reel can hold, and a story that changes how the character feels
    const problems = [...castViolations(mainCast, script).map((p) => `Cast rule: ${p}`), ...lengthViolations(script).map((p) => `Length rule: ${p}`), ...storyViolations(script).map((p) => `Story rule: ${p}`)]
    if (problems.length) { notes = problems; critique = null; continue }
    await ask()
    const c = await agents.critic(ctx, script, round)
    usages.push(c.usage)
    critique = c.output
    if (critique.approved) break
    notes = critique.notes
  }
  if (script && !critique) throw new Error(`The script still breaks the cast or length rule after ${MAX_REVISION_ROUNDS} tries: ${notes.join(' ')}`)
  if (!script || !critique) throw new Error('No script was produced')

  // the free content check, on everything a person will read or hear (real runs only)
  if (ctx.mode === 'text') {
    const verdict = await moderateTexts(scriptTexts(script))
    if (verdict.flagged) critique = { ...critique, approved: false, policyRisk: true, notes: [...critique.notes, `The content check flagged the script (${verdict.reasons.join(', ') || 'policy'}).`] }
  }

  const summary = `"${idea.title}" · ${script.beats.length} beats · ${rounds} round${rounds > 1 ? 's' : ''} · ${critique.approved ? `approved ${critique.score}/10` : critique.policyRisk || critique.originalityRisk ? 'flagged for review' : `not approved (${critique.score}/10), best attempt kept`}`
  return { output: { idea, script, critique, rounds }, summary, usage: addUsage(usages) }
}
