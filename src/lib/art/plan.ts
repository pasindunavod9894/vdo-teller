import { BASE_EXPRESSIONS } from '../expressions'
export type AssetKind = 'expression'
export type AssetSpec = { kind: AssetKind; name: string; prompt: string }
export type Quality = 'low' | 'medium' | 'high'

// Approximate USD per 1024px image (see plan §1; verify on the OpenAI pricing page).
export const IMAGE_COST: Record<Quality, number> = { low: 0.015, medium: 0.05, high: 0.17 }
/** Character references are made once and every later image depends on them, so they get the best quality. */
export const REFERENCE_QUALITY: Quality = 'high'
/** Keyframes are shown at 720p and then animated, so medium is enough. */
export const KEYFRAME_QUALITY: Quality = 'medium'

/**
 * Character images can come from fal.ai's open FLUX.2 models instead of gpt-image-2 (`CHARACTER_IMAGE_PROVIDER`).
 * fal bills FLUX.2 per megapixel ($0.012, input and output both count); these are rounded-up estimates, check fal's pricing page.
 *  - sheet: text to image, 1536x1024 (about 1.6 MP)
 *  - expressions: ONE edit of the sheet that draws all four faces as a 2x2 grid (1280x1280 out + the sheet in, about 2.6 MP), cut apart with FFmpeg
 */
export const FAL_SHEET_USD = 0.03
export const FAL_EXPRESSIONS_USD = 0.04 // the four base faces in one 2 x 2 grid; see `falExpressionsUsd` for the others
export const FAL_SHEET_SIZE = { width: 1536, height: 1024 }

/** The expressions every character has a reference for, at the least. A series can add more (see `assetPlan`). Together with the reference sheet they keep a face on-model. */
export const EXPRESSIONS = BASE_EXPRESSIONS
export type Expression = (typeof EXPRESSIONS)[number]

/** The prompt that draws one expression from the reference sheet (used when each expression is made on its own). */
export const expressionPrompt = (e: string) =>
  `The same character as in the reference image, head and shoulders close-up, facing the camera, a clearly ${e} facial expression, on a plain light-grey background. Keep the exact eye colour, fur or skin pattern and markings, proportions, outfit and every accessory. No text, no other characters.`

/**
 * A character's reference pack (plan R1-B): the reference sheet (front, side and three-quarter views, made when the character is
 * created) plus an expression close-up for every face the series uses: the base four, and the extras its niche needs (nine in all for a
 * new series). Each is an edit of the sheet; they are made once per character and then locked.
 */
export function assetPlan(expressions: readonly string[] = BASE_EXPRESSIONS): AssetSpec[] {
  return [...new Set<string>([...BASE_EXPRESSIONS, ...expressions])].map((e) => ({ kind: 'expression' as const, name: e, prompt: expressionPrompt(e) }))
}

/**
 * The picture that holds all the faces of a pack at once: the smallest grid that has a panel for each (2 x 2 for four, 3 x 2 for five or
 * six, 3 x 3 for seven to nine). Sizes are multiples of the grid, between fal's limits of 512 and 2048, so a panel is cut out exactly.
 */
export function gridShape(count: number): { cols: number; rows: number; width: number; height: number } {
  if (count <= 4) return { cols: 2, rows: 2, width: 1280, height: 1280 }
  if (count <= 6) return { cols: 3, rows: 2, width: 2046, height: 1364 }
  return { cols: 3, rows: 3, width: 2046, height: 2046 }
}

/** What the one grid picture costs on fal: about $0.012 per megapixel of the picture plus the sheet that goes in (rounded up). */
export const falExpressionsUsd = (count: number): number => {
  const g = gridShape(count)
  return Math.ceil(((g.width * g.height) / 1e6 + 1) * 0.012 * 100) / 100
}

export const specKey = (s: { kind: string; name: string }) => `${s.kind}:${s.name}`
