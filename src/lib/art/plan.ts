export type AssetKind = 'pose' | 'emotion' | 'mouth' | 'face'
/** Where an image is made from: the reference sheet, or an edit of the steady (closed-mouth) face so only the mouth/eyes change. */
export type AssetSource = 'reference' | 'face-base'
export type AssetSpec = { kind: AssetKind; name: string; prompt: string; source: AssetSource }
export type Quality = 'low' | 'medium' | 'high'

// Approximate USD per 1024px image (see plan §1; verify on the OpenAI pricing page).
export const IMAGE_COST: Record<Quality, number> = { low: 0.015, medium: 0.05, high: 0.17 }
export const QUALITY_FOR_TIER = { budget: 'low', standard: 'medium', premium: 'high' } as const

const BASE = 'Single character on a fully transparent background. No ground, no glow, no text, no extra objects. The whole character must be fully inside the frame with a clear margin on every side; nothing cropped. Preserve the exact eye colour, fur or skin pattern and markings, proportions, outfit and every accessory from the reference image.'
const KEEP = 'Everything else must stay identical: same eyes, eyebrows, ears, outfit and accessories, fur or skin, head position and size, lighting and framing. Transparent background.'

/** Full-body poses: standing, two walking strides (facing right), a crouch and a jump. */
const POSES: [string, string][] = [
  ['standing-front', 'standing, facing the camera, relaxed pose, full body'],
  ['walking-side-a', 'walking to the right, side view, mid-stride, the front-left leg forward and the back-right leg behind, full body'],
  ['walking-side-b', 'walking to the right, side view, mid-stride, the OPPOSITE stride: the front-right leg forward and the back-left leg behind, full body'],
  ['crouch', 'crouching low, front view, knees bent, body compressed like a spring about to jump, full body'],
  ['airborne', 'jumping high in the air, front view, legs tucked and arms spread, startled wide eyes, full body, no ground'],
]
/** Expression close-ups used for reaction shots. */
const EMOTIONS = ['happy', 'surprised', 'smug']
/** Mouth edits of the steady face. */
const MOUTHS: [string, string][] = [
  ['slightly-open', 'the mouth slightly open, as if starting to speak'],
  ['round-oh', 'the mouth in a small round "oh" shape'],
  ['wide-open', 'the mouth wide open, as if speaking loudly'],
]

/**
 * The character kit (plan phase 9): 13 images, about $0.65 at medium quality, made once per character.
 * Stage 1 comes from the reference sheet; stage 2 (mouths, blink) are edits of the steady face made from the closed-mouth close-up.
 */
export function assetPlan(): AssetSpec[] {
  return [
    ...POSES.map(([name, d]) => ({ kind: 'pose' as const, name, source: 'reference' as const, prompt: `${BASE} Pose: ${d}.` })),
    ...EMOTIONS.map((e) => ({ kind: 'emotion' as const, name: e, source: 'reference' as const, prompt: `${BASE} Head and shoulders close-up, facing the camera, clearly ${e} facial expression.` })),
    { kind: 'mouth' as const, name: 'closed', source: 'reference' as const, prompt: `${BASE} Head and shoulders close-up, facing the camera, neutral eyes, mouth closed.` },
    ...MOUTHS.map(([name, d]) => ({ kind: 'mouth' as const, name, source: 'face-base' as const, prompt: `Edit this exact image: change ONLY ${d}. ${KEEP}` })),
    { kind: 'face' as const, name: 'blink', source: 'face-base' as const, prompt: `Edit this exact image: change ONLY the eyes to closed, as in a natural blink (eyelids shut, no visible irises); keep the mouth closed. ${KEEP}` },
  ]
}

export const specKey = (s: { kind: string; name: string }) => `${s.kind}:${s.name}`

/** The stage-1 items a stage-2 edit needs before it can be made. */
export const FACE_BASE_NEEDS = ['mouth:closed', 'emotion:happy', 'emotion:surprised', 'emotion:smug']
