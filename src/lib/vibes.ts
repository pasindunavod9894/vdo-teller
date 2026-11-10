import { BASE_EXPRESSIONS, closestExpression, EXPRESSION_VOCAB, type Expression } from './expressions'
import { detectKind } from './wizard/mock-data'
import type { Mood } from '../engine/music'

/**
 * The vibes (plan: every reel is a short story with ONE of them). A vibe is the feeling of the whole reel: what kind of story it tells, how
 * the characters' faces change from the first beat to the last (`arc`), and how it moves and sounds. The Creator proposes three ideas with
 * three different vibes that suit the series' niche; the memory keeps the last ones so the next reel feels different; the Writer follows the
 * arc beat by beat; the Style agent and the music follow the vibe. Pure data, so every agent reads the same palette.
 */
export const VIBE_IDS = ['adventure', 'calm', 'comedy', 'mystery', 'heartwarming', 'thrill', 'whimsical', 'triumph', 'discovery', 'bittersweet'] as const
export type VibeId = (typeof VIBE_IDS)[number]

export type NicheKind = 'animals' | 'kids' | 'finance' | 'generic'

export type Vibe = {
  id: VibeId
  label: string
  /** the story it tells, in one sentence: what the character wants, what is in the way, how it ends */
  story: string
  /** how the character's face changes from the first beat to the last (words from the expression vocabulary) */
  arc: readonly Expression[]
  /** how the camera and the cuts feel */
  pace: string
  music: Mood
  /** niche kinds this vibe should not be offered to */
  notFor?: readonly NicheKind[]
}

export const VIBES: Record<VibeId, Vibe> = {
  adventure: { id: 'adventure', label: 'Adventure', story: 'a journey with a goal, a risk on the way, and a win', arc: ['curious', 'determined', 'scared', 'excited', 'proud'], pace: 'wide shots, moving camera, building speed', music: 'upbeat' },
  calm: { id: 'calm', label: 'Calm and cosy', story: 'a slow, soft moment with one small worry that melts into peace', arc: ['peaceful', 'curious', 'surprised', 'happy', 'peaceful'], pace: 'slow gentle moves, soft close-ups, long holds', music: 'calm' },
  comedy: { id: 'comedy', label: 'Funny', story: 'a confident plan that goes wrong in the best way', arc: ['smug', 'confused', 'shocked', 'embarrassed', 'happy'], pace: 'quick cuts, big reactions, a snap payoff', music: 'playful' },
  mystery: { id: 'mystery', label: 'Mystery', story: 'a small puzzle, a clue, and a reveal that explains it', arc: ['curious', 'suspicious', 'scared', 'shocked', 'relieved'], pace: 'slow reveals, low angles, tension then release', music: 'tense' },
  heartwarming: { id: 'heartwarming', label: 'Heartwarming', story: 'someone needs help, someone gives it, and it matters', arc: ['neutral', 'worried', 'tearful', 'loving', 'happy'], pace: 'close faces, warm light, unhurried', music: 'calm' },
  thrill: { id: 'thrill', label: 'Thrilling', story: 'a chase or a race against time with a close escape', arc: ['worried', 'scared', 'determined', 'shocked', 'relieved'], pace: 'fast cuts, low angles, hard motion', music: 'tense', notFor: ['kids'] },
  whimsical: { id: 'whimsical', label: 'Whimsical and magical', story: 'something impossible turns up and makes the day delightful', arc: ['curious', 'surprised', 'excited', 'mischievous', 'laughing'], pace: 'floating camera, bright surprises, playful rhythm', music: 'playful' },
  triumph: { id: 'triumph', label: 'Inspiring', story: 'try, fail, try again, and finally win', arc: ['determined', 'sad', 'worried', 'determined', 'proud'], pace: 'steady build, a held beat after the fall, a big finish', music: 'upbeat' },
  discovery: { id: 'discovery', label: 'Curious discovery', story: 'a question, a surprising answer, and the joy of knowing', arc: ['curious', 'confused', 'shocked', 'excited', 'proud'], pace: 'clear framing, a reveal on the turn, an easy finish', music: 'playful' },
  bittersweet: { id: 'bittersweet', label: 'Bittersweet', story: 'a small loss or goodbye that turns into warmth', arc: ['happy', 'confused', 'sad', 'tearful', 'loving'], pace: 'quiet close-ups, long holds, a gentle release', music: 'calm', notFor: ['kids'] },
}

export const isVibe = (v: unknown): v is VibeId => typeof v === 'string' && (VIBE_IDS as readonly string[]).includes(v)

/** The vibes that suit a kind of niche: all of them, except the few a kind should not get (no thriller for a bedtime series). */
export function vibesFor(kind: NicheKind): Vibe[] {
  return VIBE_IDS.map((id) => VIBES[id]).filter((v) => !v.notFor?.includes(kind))
}

/** The vibes a series offers, from its niche and sub-niche. */
export const allowedVibes = (niche: string, subNiche?: string | null): Vibe[] => vibesFor(detectKind(`${niche} ${subNiche ?? ''}`))

/** The vibes of the last reels, newest first: the next reel should not repeat them. */
export const recentVibes = (memory: { recent: { vibe?: VibeId | null }[] }, n = 2): VibeId[] =>
  memory.recent.map((e) => e.vibe).filter((v): v is VibeId => isVibe(v)).slice(0, n)

/** Three different vibes from the allowed ones, skipping the recent ones (they come back only when nothing else is left). Deterministic. */
export function pickVibes(allowed: readonly VibeId[], avoid: readonly VibeId[], count = 3, offset = 0): VibeId[] {
  const fresh = allowed.filter((v) => !avoid.includes(v))
  const pool = fresh.length >= count ? fresh : [...fresh, ...allowed.filter((v) => avoid.includes(v))]
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(i + offset) % pool.length])
}

/** The arc of a vibe spread over `beats` beats, each moved to an expression the series has: the beat-by-beat faces of a story. */
export function expressionPlan(vibe: VibeId, beats: number, allowed: readonly string[]): string[] {
  const arc = VIBES[vibe].arc
  return Array.from({ length: beats }, (_, i) => closestExpression(arc[Math.min(arc.length - 1, Math.floor((i * arc.length) / Math.max(1, beats)))], allowed))
}

/** One line per vibe for a prompt: what it is, and how the feeling changes. Same text every time, so it can be cached. */
export function vibesLine(list: readonly Vibe[]): string {
  return list.map((v) => `${v.id} = ${v.story} [${v.arc.join(' > ')}]`).join('; ')
}

/** What a vibe needs the Writer and the Critic to know. */
export const vibeBrief = (id: VibeId) => ({ vibe: id, label: VIBES[id].label, story: VIBES[id].story, arc: VIBES[id].arc.join(' > '), pace: VIBES[id].pace })

/** How many extra expressions a series adds to the base four: together they fill one 3 x 3 grid of nine faces. */
export const EXTRA_EXPRESSIONS = 5

/**
 * The extra expressions a niche's stories use most, when the Style agent has not chosen (no AI key, or an answer with too few): the feelings
 * that appear most often in the arcs of the vibes this niche offers, beyond the base four. Deterministic, so a series always gets the same ones.
 */
export function defaultExtraExpressions(niche: string, subNiche?: string | null, count = EXTRA_EXPRESSIONS): Expression[] {
  const tally = new Map<Expression, number>()
  for (const v of allowedVibes(niche, subNiche)) for (const e of new Set(v.arc)) if (!(BASE_EXPRESSIONS as readonly string[]).includes(e)) tally.set(e, (tally.get(e) ?? 0) + 1)
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1] || EXPRESSION_VOCAB.indexOf(a[0]) - EXPRESSION_VOCAB.indexOf(b[0])).map(([e]) => e)
  const rest = EXPRESSION_VOCAB.filter((e) => !(BASE_EXPRESSIONS as readonly string[]).includes(e) && !ranked.includes(e))
  return [...ranked, ...rest].slice(0, count)
}
