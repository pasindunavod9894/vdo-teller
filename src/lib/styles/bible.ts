import { z } from 'zod'
import { scrubText } from '../../pipeline/brand-safety'
import { BASE_EXPRESSIONS, EXPRESSION_VOCAB, expressionsOf, isExpression } from '../expressions'
import { defaultExtraExpressions, EXTRA_EXPRESSIONS } from '../vibes'
import { TRANSITIONS, type CaptionStyle, type Look, type Transition } from '../../engine/timeline'
import { styleSpec, type StyleSpec } from './catalogue'

/**
 * The style bible (plan R1-A): one series' complete visual recipe, written once by the Style agent and stored on the series.
 * Every image prompt, video prompt, colour grade, caption and transition of every reel is derived from it, so all reels look alike.
 * The model only fills in descriptions and numbers; the FFmpeg filter is built here from clamped numbers, never taken from the model.
 */
const MOVES = TRANSITIONS.filter((t) => t !== 'cut') as [Exclude<Transition, 'cut'>, ...Exclude<Transition, 'cut'>[]]

/** What the model returns. Ranges are in the descriptions and enforced by `sanitizeBible` (strict output formats cannot carry them). */
export const StyleBibleSchema = z.object({
  palette: z.array(z.string()).describe('5 to 7 colours as #RRGGBB that define the series look'),
  lighting: z.string().describe('how scenes are lit, one short sentence'),
  cameraLanguage: z.string().describe('typical framing and camera moves, one short sentence'),
  lens: z.string().describe('lens and depth of field, a few words'),
  texture: z.string().describe('surface texture and level of detail, one short sentence'),
  characterRules: z.string().describe('how characters are drawn or rendered: proportions, face detail, outline, shading. One or two sentences.'),
  backgroundRules: z.string().describe('how backgrounds look and how busy they are. One short sentence.'),
  motionLanguage: z.string().describe('how things move in this series, one short sentence'),
  negative: z.array(z.string()).describe('up to 10 short things that must never appear in images or clips'),
  grade: z.object({
    saturation: z.number().describe('0.7 to 1.4, 1 = unchanged'),
    contrast: z.number().describe('0.85 to 1.3, 1 = unchanged'),
    warmth: z.number().describe('-0.08 (cool) to 0.08 (warm), 0 = neutral'),
    grain: z.number().describe('film grain 0 to 0.35'),
    vignette: z.number().describe('0 to 0.5'),
  }),
  caption: z.object({
    font: z.string().describe('a Google Fonts family name, letters and spaces only'),
    primary: z.string().describe('caption text colour, #RRGGBB'),
    highlight: z.string().describe('colour of the word being spoken, #RRGGBB'),
    uppercase: z.boolean(),
  }),
  transitions: z.array(z.enum(MOVES)).describe('1 to 5 transitions that suit the look'),
  expressions: z.array(z.enum(EXPRESSION_VOCAB)).describe('exactly 5 EXTRA facial expressions, beyond neutral, happy, surprised and sad, that the stories of this niche need most; the characters are drawn with them once'),
  keyframePromptPrefix: z.string().describe('one sentence put in front of every keyframe prompt to lock the look'),
  motionPromptSuffix: z.string().describe('one sentence put after every motion prompt to keep motion in character'),
})
export type StyleBibleDraft = z.infer<typeof StyleBibleSchema>

const hex = /^#[0-9a-fA-F]{6}$/
const FONT = /^[A-Za-z0-9 ]{1,40}$/
const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback)
const text = (s: unknown, fallback: string, max = 220) => {
  const t = typeof s === 'string' ? scrubText(s).replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return t || fallback
}

/** The stored, validated bible. Everything in it is safe to put into a prompt or a render command. */
export type StyleBible = {
  styleId: string
  palette: string[]
  lighting: string; cameraLanguage: string; lens: string; texture: string
  characterRules: string; backgroundRules: string; motionLanguage: string
  negative: string[]
  grade: { saturation: number; contrast: number; warmth: number; brightness: number; grain: number; vignette: number }
  caption: { font: string; primary: string; highlight: string; uppercase: boolean }
  transitions: Exclude<Transition, 'cut'>[]
  /** the extra expressions (beyond the base four) every character of this series is drawn with: none for a series made before they existed */
  expressions: string[]
  keyframePromptPrefix: string
  motionPromptSuffix: string
}

/** A bible made from the catalogue alone, used until the Style agent has written one (and when there is no AI key). */
export function bibleFromSpec(spec: StyleSpec): StyleBible {
  return {
    styleId: spec.id, palette: [...spec.palette],
    lighting: 'soft, readable light that suits the mood', cameraLanguage: 'clear, readable framing with the subject in the middle', lens: 'natural lens, gentle depth of field', texture: 'consistent texture and level of detail in every frame',
    characterRules: 'characters keep exactly the same proportions, face, colours and outfit in every image',
    backgroundRules: 'uncluttered backgrounds that leave room for the characters',
    motionLanguage: spec.motionLanguage, negative: spec.negativePrompt.split(',').map((s) => s.trim()).filter(Boolean),
    grade: { saturation: spec.grade.saturation, contrast: spec.grade.contrast, warmth: spec.grade.warmth, brightness: spec.grade.brightness ?? 0, grain: spec.grade.grain, vignette: spec.grade.vignette },
    caption: { font: spec.caption.font ?? 'Montserrat', primary: spec.caption.primary ?? '#FFFFFF', highlight: spec.caption.highlight ?? '#FFE14D', uppercase: spec.caption.uppercase ?? false },
    transitions: [...spec.transitions],
    expressions: [],
    keyframePromptPrefix: `Keep the look consistent across the whole series.`,
    motionPromptSuffix: `Motion stays in character for this look.`,
  }
}

/** Turns the model's draft into a safe bible: clamps numbers, validates colours and font names, scrubs brand names, falls back per field. */
export function sanitizeBible(draft: StyleBibleDraft, styleId: string, fill?: { niche: string; subNiche?: string | null }): StyleBible {
  const spec = styleSpec(styleId)
  const base = bibleFromSpec(spec)
  const palette = (draft.palette ?? []).filter((c) => hex.test(c))
  const colour = (c: string, fb: string) => (hex.test(c) ? c.toUpperCase() : fb)
  const transitions = [...new Set((draft.transitions ?? []).filter((t) => (MOVES as readonly string[]).includes(t)))].slice(0, 5)
  // the extra expressions: known words only, none of the base four, no repeats; when a niche is given the list is filled up to five from its vibes
  const picked = [...new Set((Array.isArray(draft.expressions) ? draft.expressions : []).filter((e) => isExpression(e) && !(BASE_EXPRESSIONS as readonly string[]).includes(e)))].slice(0, EXTRA_EXPRESSIONS)
  const expressions = fill ? [...picked, ...defaultExtraExpressions(fill.niche, fill.subNiche, EXTRA_EXPRESSIONS + picked.length).filter((e) => !picked.includes(e))].slice(0, EXTRA_EXPRESSIONS) : picked
  return {
    styleId: spec.id,
    palette: palette.length >= 5 ? palette.slice(0, 7).map((c) => c.toUpperCase()) : base.palette,
    lighting: text(draft.lighting, base.lighting), cameraLanguage: text(draft.cameraLanguage, base.cameraLanguage), lens: text(draft.lens, base.lens, 80), texture: text(draft.texture, base.texture),
    characterRules: text(draft.characterRules, base.characterRules, 320), backgroundRules: text(draft.backgroundRules, base.backgroundRules),
    motionLanguage: text(draft.motionLanguage, base.motionLanguage),
    negative: (draft.negative ?? []).map((n) => text(n, '', 40)).filter(Boolean).slice(0, 10).concat(base.negative).slice(0, 14),
    grade: {
      saturation: clamp(draft.grade?.saturation, 0.7, 1.4, base.grade.saturation), contrast: clamp(draft.grade?.contrast, 0.85, 1.3, base.grade.contrast),
      warmth: clamp(draft.grade?.warmth, -0.08, 0.08, base.grade.warmth), brightness: base.grade.brightness,
      grain: clamp(draft.grade?.grain, 0, 0.35, base.grade.grain), vignette: clamp(draft.grade?.vignette, 0, 0.5, base.grade.vignette),
    },
    caption: {
      font: FONT.test(draft.caption?.font ?? '') ? draft.caption.font.trim() : base.caption.font,
      primary: colour(draft.caption?.primary, base.caption.primary), highlight: colour(draft.caption?.highlight, base.caption.highlight), uppercase: Boolean(draft.caption?.uppercase),
    },
    transitions: transitions.length ? transitions : base.transitions,
    expressions,
    keyframePromptPrefix: text(draft.keyframePromptPrefix, base.keyframePromptPrefix, 240), motionPromptSuffix: text(draft.motionPromptSuffix, base.motionPromptSuffix, 240),
  }
}

/** Reads a stored bible (json from the database or the wizard). Anything that is not a valid bible for this style becomes the catalogue's. */
export function resolveBible(raw: unknown, styleId: string): StyleBible {
  const spec = styleSpec(styleId)
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<StyleBible>
    if (r.styleId === spec.id && Array.isArray(r.palette) && r.grade && r.caption && Array.isArray(r.transitions)) {
      // re-sanitize: the json column could have been edited, and this keeps every value inside its safe range
      return sanitizeBible(r as unknown as StyleBibleDraft, spec.id)
    }
  }
  return bibleFromSpec(spec)
}

// ---------- helpers every consumer uses (they replace stylePrompt(id)) ----------

/** The full look, for image prompts (keyframes, references, plates, the hero banner). */
export function imageStyle(raw: unknown, styleId: string): string {
  const b = resolveBible(raw, styleId)
  return `${styleSpec(styleId).imagePrompt}. ${b.keyframePromptPrefix} Colour palette: ${b.palette.join(', ')}. Lighting: ${b.lighting} Lens: ${b.lens} Texture: ${b.texture} Characters: ${b.characterRules} Backgrounds: ${b.backgroundRules}`
}

/** A short version for the text agents' cached prefix. */
export function styleSummary(raw: unknown, styleId: string): string {
  const b = resolveBible(raw, styleId)
  return `${styleSpec(styleId).imagePrompt}. Palette: ${b.palette.join(', ')}. Lighting: ${b.lighting} Motion: ${b.motionLanguage}`
}

/** What every video prompt gets added: how things move in this series. */
export function motionStyle(raw: unknown, styleId: string): string {
  const b = resolveBible(raw, styleId)
  return `${b.motionLanguage}. ${b.motionPromptSuffix}`
}

/** What must not appear, for keyframes and clips. */
export function negativeList(raw: unknown, styleId: string): string {
  return resolveBible(raw, styleId).negative.join(', ')
}

/** The FFmpeg colour-grade filter, built from clamped numbers (never from model text). */
export function gradeFilter(raw: unknown, styleId: string): string {
  const g = resolveBible(raw, styleId).grade
  const f = (n: number) => n.toFixed(3)
  return `eq=saturation=${f(g.saturation)}:contrast=${f(g.contrast)}:brightness=${f(g.brightness)},colorbalance=rs=${f(g.warmth)}:bs=${f(-g.warmth)}:rm=${f(g.warmth / 2)}:bm=${f(-g.warmth / 2)}`
}

/** The look the assembler uses: grade, grain, vignette and caption style. */
export function lookFor(raw: unknown, styleId: string): Look {
  const b = resolveBible(raw, styleId)
  const spec = styleSpec(styleId)
  const caption: Partial<CaptionStyle> = { ...spec.caption, font: b.caption.font, primary: b.caption.primary, highlight: b.caption.highlight, uppercase: b.caption.uppercase }
  return { gradeFilter: gradeFilter(raw, styleId), grain: b.grade.grain, vignette: b.grade.vignette, caption: { font: 'Montserrat', size: 0.05, primary: '#FFFFFF', highlight: '#FFE14D', outline: '#000000', bold: true, uppercase: false, position: 'bottom', ...caption } }
}

export function transitionsFor(raw: unknown, styleId: string): Transition[] {
  return resolveBible(raw, styleId).transitions
}

/** A bible with the niche's extra expressions filled in when it has none (a catalogue bible, or one cached before expressions existed). */
export function withExpressions(bible: StyleBible, niche: string, subNiche?: string | null): StyleBible {
  return Array.isArray(bible.expressions) && bible.expressions.length ? bible : { ...bible, expressions: defaultExtraExpressions(niche, subNiche) }
}

/** Every expression a series' characters are drawn with: the base four, then the extras of its bible. The base four alone for an older series. */
export function expressionsOfBible(raw: unknown, styleId: string): string[] {
  return expressionsOf(resolveBible(raw, styleId).expressions)
}
