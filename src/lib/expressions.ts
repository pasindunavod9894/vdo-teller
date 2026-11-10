/**
 * The faces a character can show. Every beat of a script names the expression the main character has in that shot, and the keyframe is
 * drawn with it. A character's pack has the four base expressions; a series can add more (see the style bible), so a script only uses
 * the ones the series has, and anything else is moved to the nearest one that exists. Pure, so the prompts, the code rules and the
 * image step all read the same list.
 */
export const BASE_EXPRESSIONS = ['neutral', 'happy', 'surprised', 'sad'] as const
export type BaseExpression = (typeof BASE_EXPRESSIONS)[number]

/** Everything a script may ask for. A series only has the ones in its pack (the base four, plus any extra its niche needs). */
export const EXPRESSION_VOCAB = [
  'neutral', 'happy', 'surprised', 'sad',
  'excited', 'determined', 'scared', 'angry', 'curious', 'proud', 'embarrassed', 'sleepy',
  'peaceful', 'smug', 'suspicious', 'worried', 'relieved', 'confused', 'mischievous', 'loving',
  'tearful', 'shocked', 'laughing', 'disgusted',
] as const
export type Expression = (typeof EXPRESSION_VOCAB)[number]

export const isExpression = (v: unknown): v is Expression => typeof v === 'string' && (EXPRESSION_VOCAB as readonly string[]).includes(v)

/** Which base expression each of the others is closest to; the others of a group stand in for each other before a base one does. */
const GROUPS: Record<BaseExpression, readonly Expression[]> = {
  happy: ['happy', 'excited', 'proud', 'relieved', 'loving', 'laughing', 'mischievous', 'smug'],
  surprised: ['surprised', 'scared', 'shocked', 'confused'],
  sad: ['sad', 'worried', 'tearful', 'embarrassed', 'angry', 'disgusted'],
  neutral: ['neutral', 'determined', 'curious', 'peaceful', 'sleepy', 'suspicious'],
}

/** The base expression a face is nearest to. */
export function baseOf(e: string): BaseExpression {
  return (Object.keys(GROUPS) as BaseExpression[]).find((b) => (GROUPS[b] as readonly string[]).includes(e)) ?? 'neutral'
}

/**
 * The expression to use for `wanted` when a series only has `allowed` ones: the same one, else a close relative from its group, else the
 * base one of its group, else neutral, else whatever the series has.
 */
export function closestExpression(wanted: string, allowed: readonly string[]): string {
  if (allowed.includes(wanted)) return wanted
  const base = baseOf(wanted)
  // relatives of its own group first (excited stands in for proud), then the base one, then neutral
  const candidates = [...GROUPS[base].filter((g) => g !== base), base, 'neutral']
  return candidates.find((c) => allowed.includes(c)) ?? allowed[0] ?? 'neutral'
}

/** What a series offers when it has not added any: the four that every character has. */
export const expressionsOf = (list: readonly string[] | undefined | null): string[] => {
  const ok = (list ?? []).filter(isExpression)
  return ok.length ? [...new Set<string>([...BASE_EXPRESSIONS, ...ok])] : [...BASE_EXPRESSIONS]
}
