// Built-in gpt-4o-mini-tts voices (no cloning). Descriptions are our own short hints.
export const VOICES = [
  { id: 'alloy', hint: 'Neutral, clear' },
  { id: 'ash', hint: 'Warm, calm male' },
  { id: 'ballad', hint: 'Soft, storytelling' },
  { id: 'coral', hint: 'Bright, expressive female' },
  { id: 'echo', hint: 'Steady male' },
  { id: 'fable', hint: 'Storybook narrator' },
  { id: 'nova', hint: 'Energetic female' },
  { id: 'onyx', hint: 'Deep, authoritative' },
  { id: 'sage', hint: 'Gentle, thoughtful' },
  { id: 'shimmer', hint: 'Light, cheerful' },
  { id: 'verse', hint: 'Dynamic, dramatic' },
  { id: 'marin', hint: 'Natural, conversational' },
  { id: 'cedar', hint: 'Grounded, natural male' },
] as const

export const VOICE_IDS = VOICES.map((v) => v.id) as [string, ...string[]]

export function defaultVoiceFor(index: number) {
  const order = ['coral', 'onyx', 'nova', 'echo', 'shimmer', 'cedar', 'marin', 'ash']
  return order[index % order.length]
}

export const TONE_PRESETS = ['Playful and smug', 'Nervous and fast', 'Warm and calm', 'Deadpan and dry', 'Dramatic and loud']
