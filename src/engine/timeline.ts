import { z } from 'zod'

/**
 * The Timeline is the contract between the Animator agent and the renderer (plan §1b):
 * the agents write this JSON, Remotion renders it frame by frame. All times are in seconds.
 * Asset `src` values are file names inside the render workspace's `assets/` folder.
 */

const Src = z.string().min(1)

export const CameraSchema = z.object({
  move: z.enum(['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'shake']).default('push-in'),
  /** 0..1, how strong the move is */
  intensity: z.number().min(0).max(1).default(0.5),
  /** always-on handheld micro movement, 0..1 */
  handheld: z.number().min(0).max(1).default(0.25),
})

export const FrameSwapSchema = z.object({ atSec: z.number().min(0), src: Src })

const Pt = z.object({ x: z.number(), y: z.number() })

/** Travel across the shot. `arc` adds a parabolic hop (fraction of frame height) with automatic squash-and-stretch. */
export const PathSchema = z.object({
  from: Pt, to: Pt,
  startSec: z.number().min(0), endSec: z.number().min(0),
  arc: z.number().min(0).max(1).default(0),
  ease: z.enum(['linear', 'inOut']).default('inOut'),
  /** scale at the end of the path (1 = unchanged); used to walk away into the distance */
  scaleTo: z.number().default(1),
})

/** Frame cycle (walk): the images alternate at `hz` between fromSec and toSec, with bounce and lean synced to the stride. */
export const CycleSchema = z.object({
  frames: z.array(Src).min(2), hz: z.number().default(3), fromSec: z.number().min(0), toSec: z.number().min(0),
  bounce: z.number().default(0.012), lean: z.number().default(2.5),
})

/** Speech-driven head motion: `energy` is the normalised loudness per video frame (0..1), starting at `startSec`. */
export const TalkSchema = z.object({ energy: z.array(z.number()), startSec: z.number().min(0), amount: z.number().default(1) })

export const CharacterLayerSchema = z.object({
  kind: z.literal('character'),
  id: z.string(),
  /** x/y are the character's bottom-centre anchor as a 0..1 fraction of the frame */
  x: z.number().default(0.5),
  y: z.number().default(1),
  /** width as a fraction of frame width */
  width: z.number().default(0.5),
  flip: z.boolean().default(false),
  /** Images over time (pose / expression / mouth shape). The latest one at or before "now" is shown. */
  frames: z.array(FrameSwapSchema).min(1),
  motion: z.enum(['none', 'breathe', 'bob']).default('breathe'),
  enter: z.enum(['none', 'pop', 'slide-left', 'slide-right']).default('none'),
  /** seconds, relative to the start of the shot */
  enterAtSec: z.number().default(0),
  path: PathSchema.optional(),
  cycle: CycleSchema.optional(),
  talk: TalkSchema.optional(),
  /** trembling (fear, cold) */
  shiver: z.object({ fromSec: z.number(), toSec: z.number(), amount: z.number().default(0.5) }).optional(),
  /** an overlay image (eyes closed) shown briefly at the given times */
  blinks: z.object({ src: Src, times: z.array(z.number()), holdSec: z.number().default(0.12) }).optional(),
})

export const TextLayerSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
  atSec: z.number().default(0),
  durationSec: z.number().default(1.5),
  position: z.enum(['top', 'center', 'bottom']).default('top'),
})

export const ParticlesLayerSchema = z.object({
  kind: z.literal('particles'),
  preset: z.enum(['dust', 'sparkles', 'steam']).default('dust'),
  count: z.number().int().min(1).max(60).default(18),
})

export const LayerSchema = z.discriminatedUnion('kind', [CharacterLayerSchema, TextLayerSchema, ParticlesLayerSchema])

/** A real-motion clip from the video model. When present it replaces the still background; layers, captions and sound still sit on top. */
export const ShotVideoSchema = z.object({
  src: Src,
  /** skip the first seconds of the clip */
  startFromSec: z.number().min(0).default(0),
  playbackRate: z.number().min(0.25).max(4).default(1),
})

export const ShotSchema = z.object({
  id: z.string(),
  durationSec: z.number().min(0.5),
  /** still image; also the poster/fallback for a video shot */
  background: Src,
  video: ShotVideoSchema.optional(),
  camera: CameraSchema.default({ move: 'push-in', intensity: 0.5, handheld: 0.25 }),
  layers: z.array(LayerSchema).default([]),
  transitionIn: z.enum(['cut', 'fade', 'whip']).default('cut'),
})

export const AudioClipSchema = z.object({ src: Src, startSec: z.number().min(0), volume: z.number().min(0).max(1).default(1) })

export const WordSchema = z.object({ text: z.string(), startSec: z.number().min(0), endSec: z.number().min(0) })

export const CaptionSchema = z.object({ text: z.string(), startSec: z.number().min(0), endSec: z.number().min(0), /** real word timings (from speech recognition); when absent, words are spread evenly */ words: z.array(WordSchema).optional() })

export const LookSchema = z.object({
  grade: z.enum(['neutral', 'warm', 'cool', 'vivid', 'noir']).default('neutral'),
  grain: z.number().min(0).max(1).default(0.2),
  vignette: z.number().min(0).max(1).default(0.35),
  /** Where captions sit. Voiced close-ups put the face low in the frame, so 'top' keeps captions off the face. */
  captionPosition: z.enum(['top', 'middle', 'bottom']).default('bottom'),
})

export const TimelineSchema = z.object({
  fps: z.number().int().default(30),
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
  shots: z.array(ShotSchema).min(1),
  voices: z.array(AudioClipSchema).default([]),
  music: z.object({ src: Src, volume: z.number().min(0).max(1).default(0.25) }).nullable().default(null),
  sfx: z.array(AudioClipSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  look: LookSchema.default({ grade: 'neutral', grain: 0.2, vignette: 0.35, captionPosition: 'bottom' }),
})

export type Timeline = z.infer<typeof TimelineSchema>
export type Shot = z.infer<typeof ShotSchema>
export type ShotVideo = z.infer<typeof ShotVideoSchema>
export type Layer = z.infer<typeof LayerSchema>
export type CharacterLayer = z.infer<typeof CharacterLayerSchema>
export type TimelineInput = z.input<typeof TimelineSchema>

export const ASPECTS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] } as const

export function durationSec(t: Pick<Timeline, 'shots'>) {
  return t.shots.reduce((s, x) => s + x.durationSec, 0)
}

export const framesOf = (sec: number, fps: number) => Math.max(1, Math.round(sec * fps))

/** Start time of every shot (seconds). */
export function shotStarts(t: Pick<Timeline, 'shots'>) {
  let at = 0
  return t.shots.map((s) => { const start = at; at += s.durationSec; return start })
}

/** The image a character layer shows at a given time (seconds since the shot started). */
export function frameAt(frames: { atSec: number; src: string }[], sec: number) {
  let current = frames[0]
  for (const f of frames) { if (f.atSec <= sec) current = f; else break }
  return current.src
}
