import OpenAI from 'openai'

/**
 * The free Moderation API check (plan R3): ideas and the final script are checked before any image or video money is spent. A flag ends the
 * episode for a human. If the check itself cannot be made (no key, network), it does not block: it is a safety net on top of the prompts and
 * the policy flags of the Critic, not the only guard.
 */
export type ModerationResult = { flagged: boolean; reasons: string[] }

export async function moderateTexts(texts: string[], client?: Pick<OpenAI, 'moderations'>): Promise<ModerationResult> {
  const input = texts.map((t) => t.trim()).filter(Boolean)
  if (!input.length) return { flagged: false, reasons: [] }
  const c = client ?? (process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null)
  if (!c) return { flagged: false, reasons: [] }
  try {
    const r = await c.moderations.create({ model: 'omni-moderation-latest', input })
    const reasons = new Set<string>()
    for (const x of r.results) if (x.flagged) for (const [k, v] of Object.entries(x.categories)) if (v) reasons.add(k)
    return { flagged: r.results.some((x) => x.flagged), reasons: [...reasons] }
  } catch (e) {
    console.error('[moderation] check failed, continuing:', e instanceof Error ? e.message.slice(0, 120) : e)
    return { flagged: false, reasons: [] }
  }
}

/** Every text of a script that a person will read or hear. */
export function scriptTexts(script: { title: string; hook: string; payoff: string; beats: { action: string; line: string | null; onScreenText: string | null }[]; supportingCast: { canonicalLook: string; role: string }[] }): string[] {
  return [script.title, script.hook, script.payoff, ...script.beats.flatMap((b) => [b.action, b.line ?? '', b.onScreenText ?? '']), ...script.supportingCast.flatMap((s) => [s.role, s.canonicalLook])]
}
