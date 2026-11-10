export const STEPS = [
  { slug: 'sub-niche', label: 'Sub-niche' },
  { slug: 'style', label: 'Style' },
  { slug: 'characters', label: 'Characters' },
  { slug: 'voice', label: 'Voice' },
] as const
export type StepSlug = (typeof STEPS)[number]['slug']
