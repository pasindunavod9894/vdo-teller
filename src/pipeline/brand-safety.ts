// Agent output must never name existing studios, franchises or brands (plan: monetization guardrails).
// The prompts already forbid it; this is the safety net for when a model slips anyway.
const BRANDS = [
  'pixar', 'disney', 'dreamworks', 'illumination', 'ghibli', 'marvel', 'nintendo', 'pokemon', 'pokémon', 'sanrio', 'hello kitty',
  'looney tunes', 'tom and jerry', 'garfield', 'shrek', 'minions', 'netflix', 'youtube', 'tiktok',
  // well-known characters, for names a person types. Only distinctive ones: a word people use every day (goofy, bluey) must never be on this list,
  // because a description like "a goofy puppy" would be refused
  'mickey mouse', 'minnie mouse', 'donald duck', 'winnie the pooh', 'spongebob', 'patrick star', 'pikachu', 'mario bros', 'super mario', 'luigi',
  'sonic the hedgehog', 'peppa pig', 'paw patrol', 'spider-man', 'spiderman', 'batman', 'superman', 'wonder woman', 'iron man', 'harry potter',
  'bugs bunny', 'daffy duck', 'scooby-doo', 'scooby doo', 'woody and buzz', 'buzz lightyear', 'mr. potato head', 'hello kitty',
]
// substring match on purpose: brands glued into hashtags (#PixarStyle) must be caught too, so no entry may be an everyday word
const BRAND_RE = new RegExp(`(?:${BRANDS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')

export const hasBrand = (text: string) => { BRAND_RE.lastIndex = 0; return BRAND_RE.test(text) }

export function scrubText(text: string): string {
  return text.replace(BRAND_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim()
}

const FILLER_TAGS = ['#AnimatedStories', '#Shorts', '#Cartoon']

/** Drops hashtags that contain a brand and tops the list up to exactly 3 neutral tags. */
export function cleanHashtags(tags: string[]): string[] {
  const kept = tags.map((t) => t.trim()).filter((t) => t.startsWith('#') && !hasBrand(t))
  for (const f of FILLER_TAGS) if (kept.length < 3 && !kept.includes(f)) kept.push(f)
  return kept.slice(0, 3)
}

/** Recursively scrubs every string in a JSON-like value (scripts, ideas, captions). */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as T
  if (Array.isArray(value)) return value.map(scrubDeep) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)])) as T
  return value
}
