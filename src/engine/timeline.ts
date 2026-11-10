import { z } from 'zod'

/**
 * The Timeline is the contract between the Editor agent and the FFmpeg assembler (src/engine/assemble.ts).
 * Every shot is a real video clip (a keyframe animated by the video model); the assembler trims, joins, grades, captions and
 * mixes them. All times are in seconds. Asset `src` values are file names inside the episode's `assets/` folder.
 */

const Src = z.string().min(1)

/** The transitions the assembler can make. `cut` is a hard cut; the rest are FFmpeg `xfade` names. */
export const TRANSITIONS = ['cut', 'fade', 'fadeblack', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'smoothleft', 'smoothright', 'zoomin', 'circleopen', 'radial', 'pixelize'] as const
export type Transition = (typeof TRANSITIONS)[number]

/** A short on-screen text (a title card word, a joke, a number). Burned in as a styled caption event. */
export const TextEventSchema = z.object({
  text: z.string(),
  /** seconds since the start of the shot */
  atSec: z.number().min(0).default(0),
  durationSec: z.number().min(0.2).default(1.5),
  position: z.enum(['top', 'center', 'bottom']).default('top'),
})

export const ShotSchema = z.object({
  id: z.string(),
  /** the video clip for this shot (file in the assets folder) */
  clip: Src,
  /** how long the shot is on screen. Clips that are shorter are held on their last frame, longer ones are trimmed. */
  durationSec: z.number().min(0.5),
  /** skip the first seconds of the clip */
  trimStartSec: z.number().min(0).default(0),
  /** how this shot comes in. The first shot always starts with a cut. */
  transitionIn: z.enum(TRANSITIONS).default('cut'),
  transitionSec: z.number().min(0.1).max(1).default(0.3),
  text: z.array(TextEventSchema).default([]),
})

export const AudioClipSchema = z.object({ src: Src, startSec: z.number().min(0), volume: z.number().min(0).max(1).default(1) })

export const WordSchema = z.object({ text: z.string(), startSec: z.number().min(0), endSec: z.number().min(0) })

export const CaptionSchema = z.object({ text: z.string(), startSec: z.number().min(0), endSec: z.number().min(0), /** real word timings (from speech recognition); when absent, words are spread evenly */ words: z.array(WordSchema).optional() })

export const CaptionStyleSchema = z.object({
  /** a font family installed on the machine or present in the fonts folder */
  font: z.string().default('Montserrat'),
  /** text height as a fraction of the frame height */
  size: z.number().min(0.02).max(0.12).default(0.05),
  /** #RRGGBB */
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFFFF'),
  /** the colour the word being spoken turns into */
  highlight: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFE14D'),
  outline: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
  bold: z.boolean().default(true),
  uppercase: z.boolean().default(false),
  /** Voiced close-ups put the face low in the frame, so 'top' can keep captions off the face. */
  position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
})

export const LookSchema = z.object({
  /** FFmpeg video filters for the colour grade, comma separated (for example `eq=saturation=1.1,colorbalance=rs=0.04`). Empty means no grade. */
  gradeFilter: z.string().default(''),
  grain: z.number().min(0).max(1).default(0.15),
  vignette: z.number().min(0).max(1).default(0.3),
  caption: CaptionStyleSchema.prefault({}),
})

/** Vertical 9:16 master sizes (720p now; see VIDEO_RESOLUTION in aspect.ts). */
export const TimelineSchema = z.object({
  fps: z.number().int().default(30),
  width: z.number().int().default(720),
  height: z.number().int().default(1280),
  shots: z.array(ShotSchema).min(1),
  voices: z.array(AudioClipSchema).default([]),
  music: z.object({ src: Src, volume: z.number().min(0).max(1).default(0.25) }).nullable().default(null),
  sfx: z.array(AudioClipSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  look: LookSchema.prefault({}),
})

export type Timeline = z.infer<typeof TimelineSchema>
export type Shot = z.infer<typeof ShotSchema>
export type TextEvent = z.infer<typeof TextEventSchema>
export type Look = z.infer<typeof LookSchema>
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>
export type TimelineInput = z.input<typeof TimelineSchema>

export function durationSec(t: Pick<Timeline, 'shots'>) {
  return t.shots.reduce((s, x) => s + x.durationSec, 0)
}

export const framesOf = (sec: number, fps: number) => Math.max(1, Math.round(sec * fps))

/** Start time of every shot (seconds): the moment it is fully on screen. Voices and sound effects are placed against these. */
export function shotStarts(t: Pick<Timeline, 'shots'>) {
  let at = 0
  return t.shots.map((s) => { const start = at; at += s.durationSec; return start })
}
