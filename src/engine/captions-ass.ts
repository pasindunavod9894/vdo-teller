import type { CaptionStyle, Timeline } from './timeline'
import { shotStarts } from './timeline'

/**
 * Builds the .ass subtitle file that FFmpeg's `ass` filter burns into the video (replaces the Remotion caption layer).
 * - Spoken captions: one event per word window, showing the whole line with the word being spoken in the highlight colour.
 *   Real word timings come from whisper; without them the words are spread evenly over the line.
 * - On-screen texts: one event each, with a short fade and pop.
 */

const ALIGN = { top: 8, middle: 5, bottom: 2, center: 5 } as const

/** `#RRGGBB` -> ASS `&HBBGGRR&` (used inside override tags). */
const tag = (hex: string) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase()
/** `#RRGGBB` -> ASS style colour `&H00BBGGRR`. */
const styleColour = (hex: string) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase()

/** Seconds -> `H:MM:SS.cc`. */
export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/** Escapes text for an ASS dialogue line: braces would start an override block, newlines become `\N`. */
const clean = (s: string, upper: boolean) => (upper ? s.toUpperCase() : s).replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').trim()

function styleLine(name: string, c: CaptionStyle, height: number, align: number, sizeScale = 1) {
  const size = Math.round(c.size * height * sizeScale)
  const outline = Math.max(2, Math.round(size * 0.09))
  const margin = Math.round(height * 0.12)
  return `Style: ${name},${c.font},${size},${styleColour(c.primary)},${styleColour(c.highlight)},${styleColour(c.outline)},&H64000000,${c.bold ? -1 : 0},0,0,0,100,100,0,0,1,${outline},1,${align},40,40,${margin},1`
}

type Win = { start: number; end: number; text: string }

/** The highlight windows of one caption line: the same line, with a different word coloured in each window. */
function captionWindows(cap: Timeline['captions'][number], c: CaptionStyle): Win[] {
  const words = cap.words?.length
    ? cap.words
    : (() => {
        const parts = cap.text.split(/\s+/).filter(Boolean)
        const step = (cap.endSec - cap.startSec) / Math.max(1, parts.length)
        return parts.map((text, i) => ({ text, startSec: cap.startSec + i * step, endSec: cap.startSec + (i + 1) * step }))
      })()
  if (!words.length) return []
  const line = (active: number) => words.map((w, i) => {
    const t = clean(w.text, c.uppercase)
    return i === active ? `{\\c${tag(c.highlight)}}${t}{\\c${tag(c.primary)}}` : t
  }).join(' ')
  const out: Win[] = []
  const first = Math.max(cap.startSec, 0)
  if (words[0].startSec - first > 0.04) out.push({ start: first, end: words[0].startSec, text: line(-1) })
  words.forEach((w, i) => {
    const start = Math.max(w.startSec, first)
    const end = i + 1 < words.length ? words[i + 1].startSec : Math.max(cap.endSec, w.endSec)
    if (end > start) out.push({ start, end, text: line(i) })
  })
  return out
}

export function hasOverlayText(t: Pick<Timeline, 'shots' | 'captions'>): boolean {
  return t.captions.length > 0 || t.shots.some((s) => s.text.length > 0)
}

export function buildAss(t: Pick<Timeline, 'shots' | 'captions' | 'look' | 'width' | 'height'>): string {
  const c = t.look.caption
  const lines: string[] = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${t.width}`, `PlayResY: ${t.height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine('Cap', c, t.height, ALIGN[c.position]),
    styleLine('TxtTop', c, t.height, ALIGN.top, 1.3), styleLine('TxtCenter', c, t.height, ALIGN.center, 1.3), styleLine('TxtBottom', c, t.height, ALIGN.bottom, 1.3),
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  for (const cap of t.captions) {
    for (const w of captionWindows(cap, c)) lines.push(`Dialogue: 0,${assTime(w.start)},${assTime(w.end)},Cap,,0,0,0,,{\\c${tag(c.primary)}}${w.text}`)
  }
  const starts = shotStarts(t)
  t.shots.forEach((shot, i) => {
    for (const x of shot.text) {
      const start = starts[i] + x.atSec
      const end = Math.min(starts[i] + shot.durationSec, start + x.durationSec)
      if (end <= start) continue
      const style = x.position === 'top' ? 'TxtTop' : x.position === 'center' ? 'TxtCenter' : 'TxtBottom'
      lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},${style},,0,0,0,,{\\fad(120,160)\\fscx80\\fscy80\\t(0,200,\\fscx100\\fscy100)}${clean(x.text, c.uppercase)}`)
    }
  })
  return lines.join('\n') + '\n'
}
