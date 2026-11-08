// Curated themes (plan §5): the AI only PICKS from these, so every dashboard stays professional and readable.
export type FontPairId = 'modern' | 'playful' | 'elegant' | 'bold' | 'tech'
export type Palette = {
  id: string; name: string; mood: string
  colors: { bg: string; card: string; fg: string; muted: string; accent: string; accent2: string; border: string; accentFg: string }
}

export const PALETTES: Palette[] = [
  { id: 'neon-night', name: 'Neon night', mood: 'edgy, meme energy, nightlife', colors: { bg: '#0a0714', card: '#141026', fg: '#f4f1ff', muted: '#9a93b8', accent: '#ff3df2', accent2: '#35f0ff', border: '#2a2147', accentFg: '#12001a' } },
  { id: 'cozy-cafe', name: 'Cosy café', mood: 'warm, friendly, slice-of-life', colors: { bg: '#1c1411', card: '#2a1e18', fg: '#fff3e6', muted: '#c4a893', accent: '#ff9f43', accent2: '#ffd8a8', border: '#43302a', accentFg: '#2a1400' } },
  { id: 'sunny-play', name: 'Sunny playground', mood: 'bright, playful, kids and family', colors: { bg: '#fff8e7', card: '#ffffff', fg: '#2a2340', muted: '#7b7394', accent: '#ff6b6b', accent2: '#ffd43b', border: '#f0e2c0', accentFg: '#ffffff' } },
  { id: 'forest-calm', name: 'Forest calm', mood: 'gentle, nature, bedtime', colors: { bg: '#0d1a14', card: '#15281f', fg: '#e9f7ee', muted: '#8fb5a0', accent: '#5fd68a', accent2: '#c9f5d9', border: '#23402f', accentFg: '#05200f' } },
  { id: 'ocean-clear', name: 'Ocean clear', mood: 'clean, trustworthy, explainers', colors: { bg: '#07131f', card: '#0e2236', fg: '#eaf6ff', muted: '#8fb0c9', accent: '#38bdf8', accent2: '#7dd3fc', border: '#1a3a57', accentFg: '#02121f' } },
  { id: 'money-green', name: 'Money green', mood: 'finance, growth, business', colors: { bg: '#07140e', card: '#0d2418', fg: '#ecfff4', muted: '#86b79b', accent: '#2ee59d', accent2: '#f5c542', border: '#17402b', accentFg: '#03160d' } },
  { id: 'noir-red', name: 'Noir red', mood: 'dark, suspense, horror', colors: { bg: '#0b0b0d', card: '#16161a', fg: '#f2f2f4', muted: '#9a9aa5', accent: '#e63946', accent2: '#ff8a8a', border: '#2a2a31', accentFg: '#ffffff' } },
  { id: 'royal-gold', name: 'Royal gold', mood: 'history, epic, ancient worlds', colors: { bg: '#14101f', card: '#1f1830', fg: '#fbf3dd', muted: '#b8a98a', accent: '#e9b949', accent2: '#8b5cf6', border: '#372c52', accentFg: '#1c1200' } },
  { id: 'candy-pop', name: 'Candy pop', mood: 'cute, pastel, whimsical', colors: { bg: '#fff0f7', card: '#ffffff', fg: '#3b1f3a', muted: '#9a7391', accent: '#ff5fa2', accent2: '#8ec5ff', border: '#f7d3e6', accentFg: '#ffffff' } },
  { id: 'violet-studio', name: 'Violet studio', mood: 'neutral, modern, general', colors: { bg: '#0b0b10', card: '#14141c', fg: '#f5f5f7', muted: '#9a9aab', accent: '#7c5cff', accent2: '#c4b5fd', border: '#272735', accentFg: '#ffffff' } },
]

export const FONT_PAIRS: Record<FontPairId, { heading: string; body: string; label: string }> = {
  modern: { heading: 'var(--font-space-grotesk)', body: 'var(--font-inter)', label: 'Modern' },
  playful: { heading: 'var(--font-baloo)', body: 'var(--font-nunito)', label: 'Playful' },
  elegant: { heading: 'var(--font-playfair)', body: 'var(--font-inter)', label: 'Elegant' },
  bold: { heading: 'var(--font-poppins)', body: 'var(--font-inter)', label: 'Bold' },
  tech: { heading: 'var(--font-space-grotesk)', body: 'var(--font-space-grotesk)', label: 'Tech' },
}

export type Theme = { paletteId: string; fontPair: FontPairId; radius: 'sharp' | 'soft' | 'round'; mood: string; tagline?: string; heroPrompt?: string }

const RADIUS = { sharp: '0.35rem', soft: '0.75rem', round: '1.4rem' } as const
export const PALETTE_IDS = PALETTES.map((p) => p.id) as [string, ...string[]]
export const FONT_PAIR_IDS = Object.keys(FONT_PAIRS) as [FontPairId, ...FontPairId[]]

export function paletteOf(id: string) {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[PALETTES.length - 1]
}

export function isTheme(x: unknown): x is Theme {
  const t = x as Theme | null
  return !!t && typeof t === 'object' && typeof t.paletteId === 'string' && typeof t.fontPair === 'string' && t.fontPair in FONT_PAIRS
}

/** CSS variables applied on the dashboard wrapper (`data-series-theme`). Only curated values ever reach CSS. */
export function themeVars(theme: Theme): Record<string, string> {
  const c = paletteOf(theme.paletteId).colors
  const f = FONT_PAIRS[theme.fontPair] ?? FONT_PAIRS.modern
  return {
    '--background': c.bg, '--foreground': c.fg, '--card': c.card, '--card-foreground': c.fg,
    '--muted': c.card, '--muted-foreground': c.muted, '--accent': c.accent, '--accent-foreground': c.accentFg,
    '--secondary': c.card, '--secondary-foreground': c.fg, '--primary': c.accent, '--primary-foreground': c.accentFg,
    '--border': c.border, '--input': c.border, '--ring': c.accent, '--radius': RADIUS[theme.radius] ?? RADIUS.soft,
    '--accent2': c.accent2, '--font-heading': f.heading, '--font-body': f.body,
  }
}

/** Free, instant fallback used before (or without) the AI pick. */
export function heuristicTheme(niche: string, style: string): Theme {
  const n = `${niche} ${style}`.toLowerCase()
  const pick = (paletteId: string, fontPair: FontPairId, radius: Theme['radius'], mood: string): Theme => ({ paletteId, fontPair, radius, mood })
  if (/(thug|meme|neon|cyber|night)/.test(n)) return pick('neon-night', 'tech', 'soft', 'edgy')
  if (/(horror|scary|ghost|creep|suspense)/.test(n)) return pick('noir-red', 'bold', 'sharp', 'dark')
  if (/(financ|money|invest|business|crypto|saving|budget)/.test(n)) return pick('money-green', 'modern', 'soft', 'growth')
  if (/(histor|ancient|empire|myth|epic)/.test(n)) return pick('royal-gold', 'elegant', 'soft', 'epic')
  if (/(bedtime|fable|forest|nature|calm|sleep)/.test(n)) return pick('forest-calm', 'elegant', 'round', 'gentle')
  if (/(kid|child|nursery|fairy|play)/.test(n)) return pick('sunny-play', 'playful', 'round', 'playful')
  if (/(caf|cook|food|recipe|kitchen|bak)/.test(n)) return pick('cozy-cafe', 'playful', 'round', 'warm')
  if (/(cat|dog|pet|animal|puppy|kitten)/.test(n)) return pick('candy-pop', 'playful', 'round', 'cute')
  if (/(explain|science|tech|learn|fact)/.test(n)) return pick('ocean-clear', 'modern', 'soft', 'clear')
  return pick('violet-studio', 'modern', 'soft', 'modern')
}
