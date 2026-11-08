import type { Publish } from './schemas'

/**
 * Per-platform posting details (plan §3 Publisher). Built in code from the Publisher agent's title, caption and hashtags,
 * so the limits and the AI label are always applied, whatever the model wrote.
 */
export type Platform = 'youtube-shorts' | 'facebook-reels'
export type PlatformMeta = { platform: Platform; title: string; description: string; hashtags: string[]; aiLabel: string; note: string }

export const AI_LABEL = 'Made with AI: the characters, voices and pictures in this video are AI-generated.'

const LIMITS = { youtubeTitle: 100, youtubeTags: 15, facebookCaption: 2200, facebookTags: 5 }

export const cleanTag = (t: string) => `#${t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`
const validTag = (t: string) => t.length > 1

/** Up to `max` distinct valid hashtags, in order. */
export function tidyTags(tags: string[], max: number, always: string[] = []): string[] {
  const out: string[] = []
  for (const t of [...tags, ...always].map(cleanTag)) {
    if (validTag(t) && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out.slice(0, max)
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

export function platformMeta(p: Publish, platform: Platform): PlatformMeta {
  const label = p.aiLabel && /ai/i.test(p.aiLabel) ? `${p.aiLabel.trim().replace(/[.!]*$/, '')}. ${AI_LABEL}` : AI_LABEL
  if (platform === 'youtube-shorts') {
    // #Shorts in the title/description is how YouTube recognises a Short
    const tags = tidyTags(p.hashtags, LIMITS.youtubeTags, ['#Shorts'])
    return {
      platform, title: `${cut(p.title.replace(/\s*#Shorts$/i, ''), LIMITS.youtubeTitle - 8)} #Shorts`,
      description: `${p.caption}\n\n${tags.join(' ')}\n\n${label}`, hashtags: tags, aiLabel: label,
      note: 'In YouTube Studio, set "Altered or synthetic content" to Yes before publishing.',
    }
  }
  const tags = tidyTags(p.hashtags, LIMITS.facebookTags)
  return {
    platform, title: p.title,
    description: cut(`${p.caption}\n\n${tags.join(' ')}\n\n${label}`, LIMITS.facebookCaption), hashtags: tags, aiLabel: label,
    note: 'When uploading to Facebook, switch on the "AI info" label if it is offered.',
  }
}

export const platformMetas = (p: Publish): PlatformMeta[] => (['youtube-shorts', 'facebook-reels'] as const).map((x) => platformMeta(p, x))
