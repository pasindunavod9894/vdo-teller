import type { Layer, Timeline } from './timeline'

/**
 * Re-composition for other aspect ratios (plan §8). The episode is composed once, as a vertical 9:16 "column". For a wider
 * frame the column stays full height in the middle: characters keep their size relative to the HEIGHT (not the wider
 * width), keep their place inside the column, and anything that enters from off-screen still enters from beyond the real
 * frame edge. Scenery fills the whole frame. Nothing is cropped away from a character.
 */
export const ASPECTS = ['9:16', '16:9', '1:1', '4:5'] as const
export type Aspect = (typeof ASPECTS)[number]
export const isAspect = (v: unknown): v is Aspect => typeof v === 'string' && (ASPECTS as readonly string[]).includes(v)

/** `9:16` -> `9x16`: safe in file names. */
export const aspectSlug = (a: Aspect) => a.replace(':', 'x')

export const ASPECT_LABEL: Record<Aspect, string> = {
  '9:16': 'Reels / Shorts / TikTok', '16:9': 'YouTube', '1:1': 'Square', '4:5': 'Feed',
}

/** Pixel size of an aspect at the quality tier (Budget 720p class, otherwise 1080p class). Even numbers only (H.264). */
export function sizeFor(aspect: Aspect, tier: string): { width: number; height: number } {
  const short = tier === 'budget' ? 720 : 1080
  const even = (n: number) => Math.round(n / 2) * 2
  switch (aspect) {
    case '16:9': return { width: even((short * 16) / 9), height: short }
    case '1:1': return { width: short, height: short }
    case '4:5': return { width: short, height: even((short * 5) / 4) }
    default: return { width: short, height: even((short * 16) / 9) }
  }
}

/** How much narrower the composed column is than the target frame (1 = same width). */
export function columnFactor(ref: { width: number; height: number }, target: { width: number; height: number }): number {
  const column = Math.min(target.width, (target.height * ref.width) / ref.height)
  return column / target.width
}

const EDGE = 0.04 // how far past the frame edge off-screen characters wait

function mapLayer(l: Layer, k: number): Layer {
  if (l.kind !== 'character' || k === 1) return l
  const width = l.width * k
  // in-frame positions move with the column; positions outside the frame stay outside it
  const mapX = (x: number) => (x < 0 ? -width / 2 - EDGE : x > 1 ? 1 + width / 2 + EDGE : 0.5 + (x - 0.5) * k)
  return {
    ...l, width, x: mapX(l.x),
    ...(l.path ? { path: { ...l.path, from: { ...l.path.from, x: mapX(l.path.from.x) }, to: { ...l.path.to, x: mapX(l.path.to.x) } } } : {}),
  }
}

/** The same episode for another frame size. Returns the timeline unchanged (same object) when the size already matches. */
export function recompose(t: Timeline, target: { width: number; height: number }): Timeline {
  if (t.width === target.width && t.height === target.height) return t
  const k = columnFactor(t, target)
  return { ...t, width: target.width, height: target.height, shots: t.shots.map((s) => ({ ...s, layers: s.layers.map((l) => mapLayer(l, k)) })) }
}

/** True for frames wider than the 9:16 column, where video clips are shown whole over a blurred fill instead of cropped. */
export const isWide = (width: number, height: number) => width / height > 0.75
