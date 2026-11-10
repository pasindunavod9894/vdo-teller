/** Aspect ratios the app can export. The master is always 9:16; the others are made from it with a blurred fill (see pipeline/exports.ts). */
export const ASPECTS = ['9:16', '16:9', '1:1', '4:5'] as const
export type Aspect = (typeof ASPECTS)[number]
export const isAspect = (v: unknown): v is Aspect => typeof v === 'string' && (ASPECTS as readonly string[]).includes(v)

/** `9:16` -> `9x16`: safe in file names. */
export const aspectSlug = (a: Aspect) => a.replace(':', 'x')

export const ASPECT_LABEL: Record<Aspect, string> = {
  '9:16': 'Reels / Shorts / TikTok', '16:9': 'YouTube', '1:1': 'Square', '4:5': 'Feed',
}

/** The master quality. 720p for now to keep cost down; set VIDEO_RESOLUTION=1080p to switch everything (clips, keyframes, exports). */
export type Resolution = '720p' | '1080p'
export const videoResolution = (): Resolution => (process.env.VIDEO_RESOLUTION === '1080p' ? '1080p' : '720p')

/** Pixel size of an aspect at a resolution (the short side is 720 or 1080). Even numbers only (H.264). */
export function sizeFor(aspect: Aspect, resolution: Resolution = videoResolution()): { width: number; height: number } {
  const short = resolution === '1080p' ? 1080 : 720
  const even = (n: number) => Math.round(n / 2) * 2
  switch (aspect) {
    case '16:9': return { width: even((short * 16) / 9), height: short }
    case '1:1': return { width: short, height: short }
    case '4:5': return { width: short, height: even((short * 5) / 4) }
    default: return { width: short, height: even((short * 16) / 9) }
  }
}

/** True for frames wider than the 9:16 master, where the master is shown whole over a blurred fill instead of cropped. */
export const isWide = (width: number, height: number) => width / height > 0.75
