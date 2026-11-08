export type AssetKind = 'pose' | 'emotion' | 'mouth'
export type AssetSpec = { kind: AssetKind; name: string; prompt: string }
export type Quality = 'low' | 'medium' | 'high'

// Approximate USD per 1024px image (see plan §1; verify on the OpenAI pricing page).
export const IMAGE_COST: Record<Quality, number> = { low: 0.015, medium: 0.05, high: 0.17 }
export const QUALITY_FOR_TIER = { budget: 'low', standard: 'medium', premium: 'high' } as const

const POSES: [string, string][] = [
  ['standing-front', 'standing, facing the camera, relaxed pose, full body'],
  ['sitting', 'sitting down, three-quarter view, full body'],
  ['walking-side', 'walking, side view, mid-stride, full body'],
]
const EMOTIONS = ['happy', 'sad', 'surprised', 'angry', 'scared', 'smug']
const MOUTHS: [string, string][] = [
  ['closed', 'mouth closed'],
  ['slightly-open', 'mouth slightly open'],
  ['wide-open', 'mouth wide open, as if shouting'],
  ['round-oh', 'mouth in a small round "oh" shape'],
  ['smile', 'mouth in a wide smile'],
  ['ee', 'lips pulled wide and flat, as saying "ee"'],
]

const BASE = 'Single character on a fully transparent background. No ground, no glow, no text, no extra objects. The whole character must be fully inside the frame with a clear margin on every side; nothing cropped. Preserve the exact eye colour, fur or skin pattern and markings, proportions, outfit and every accessory from the reference image.'

export function assetPlan(voiced: boolean): AssetSpec[] {
  return [
    ...POSES.map(([name, d]) => ({ kind: 'pose' as const, name, prompt: `${BASE} Pose: ${d}.` })),
    ...EMOTIONS.map((e) => ({ kind: 'emotion' as const, name: e, prompt: `${BASE} Head and shoulders close-up, facing the camera, clearly ${e} facial expression.` })),
    ...(voiced ? MOUTHS.map(([name, d]) => ({ kind: 'mouth' as const, name, prompt: `${BASE} Head and shoulders close-up, facing the camera, neutral eyes, ${d}.` })) : []),
  ]
}

export const specKey = (s: { kind: string; name: string }) => `${s.kind}:${s.name}`
