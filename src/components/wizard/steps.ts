export const STEPS = [
  { slug: 'sub-niche', label: 'Sub-niche' },
  { slug: 'style', label: 'Style' },
  { slug: 'format', label: 'Format' },
  { slug: 'characters', label: 'Characters' },
  { slug: 'voice', label: 'Voice' },
  { slug: 'frequency', label: 'Frequency' },
  { slug: 'quality', label: 'Quality' },
] as const
export type StepSlug = (typeof STEPS)[number]['slug']
