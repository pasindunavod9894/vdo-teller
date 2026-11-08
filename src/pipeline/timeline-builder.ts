import { energyEnvelope, mouthFrames, mouthTrackFromRms, type MouthKey } from '../engine/lipsync'
import type { CharacterKit } from '../media/kit'
import type { Word } from '../engine/transcribe'
import { alignToScript } from '../engine/transcribe'
import type { Layer, Timeline, TimelineInput } from '../engine/timeline'
import { TimelineSchema } from '../engine/timeline'
import type { Script, ShotList } from './schemas'

/**
 * Turns an episode's script, shot list, speech, character kits and video clips into the engine's timeline (plan phase 9).
 * Pure: no files are read here, so it can be tested exhaustively. The Animator agent supplies the inputs.
 */
export type SpeechInfo = {
  /** file name inside the assets folder */
  file: string
  seconds: number
  /** clip-relative word timings */
  words: Word[]
  mouthKeys: MouthKey[]
  /** 0..1 loudness per video frame, for head nods */
  energy: number[]
}

export type BuildInput = {
  fps?: number
  width?: number
  height?: number
  look?: { grade: 'neutral' | 'warm' | 'cool' | 'vivid' | 'noir'; grain: number; vignette: number }
  script: Script
  shots: ShotList['shots']
  /** keyed by character name; the narrator needs none */
  kits: Record<string, CharacterKit>
  /** keyed by beat number: the line spoken in that beat */
  speech: Record<number, SpeechInfo>
  /** background plate per shot number (a file name); `fallbackPlate` is used when a shot has none */
  plates: Record<number, string>
  fallbackPlate: string
  /** per video shot: the generated clip (file name inside the assets folder) and its length */
  clips: Record<number, { file: string; seconds: number }>
  /** per video shot: the still the clip was made from, used as a poster */
  stills: Record<number, string>
  sfx: { whoosh: string; hiss: string; thud: string }
  /** background music: a file name and its level (it is ducked under speech when mixed) */
  music?: { src: string; volume: number } | null
}

export type BuildResult = { timeline: Timeline; notes: string[]; durationSec: number; shotStarts: number[] }

const PAD = 0.3 // a voice starts this long after its shot starts
const GAP = 0.12 // silence between two voices
const TAIL = 0.45 // a speaker stays on screen this long after the last word

const STEAM = /steam|smoke|boil|cook|pot|kettle|fog|mist/i
const SPARKLE = /sparkle|magic|glow|celebrat|party|shine|star/i
const JUMP = /jump|leap|startl|surpris|spring|bounce|recoil|fall|trip/i
const WALK = /walk|enter|arriv|approach|stroll|leave|exit|run|head(s|ed)? (to|toward)|goes/i

/** Maps a script emotion word to one of the three expression close-ups every kit has. */
export function emotionBust(emotion: string | null | undefined): 'happy' | 'surprised' | 'smug' {
  const e = (emotion ?? '').toLowerCase()
  if (/smug|confiden|proud|deadpan|sly|cool|calm|bold/.test(e)) return 'smug'
  if (/scar|panic|nervous|anxi|surpris|shock|awkward|afraid|worr|alarm|terrif|fright/.test(e)) return 'surprised'
  return 'happy'
}

const isFear = (emotion: string | null | undefined) => /scar|panic|nervous|anxi|afraid|worr|alarm|terrif|fright/.test((emotion ?? '').toLowerCase())

/** Blink times inside a shot of `dur` seconds, spread out and offset per shot so characters do not blink in unison. */
export function blinkTimes(dur: number, shotNo: number): number[] {
  const out: number[] = []
  for (let t = 0.4 + (shotNo % 3) * 0.3; t < dur - 0.35; t += 1.9) out.push(Math.round(t * 100) / 100)
  return out
}

type Planned = { shot: ShotList['shots'][number]; start: number; dur: number; voiceStart: number | null; beatNo: number | null }

export function buildTimeline(input: BuildInput): BuildResult {
  const fps = input.fps ?? 30
  const notes: string[] = []
  const beatByNo = new Map(input.script.beats.map((b) => [b.n, b]))
  const spokenBeats = new Set<number>()

  // ---- pass 1: shot lengths and voice start times, in order ----
  const planned: Planned[] = []
  let t = 0
  let voiceFree = 0
  for (const shot of input.shots) {
    const clip = shot.render === 'video' ? input.clips[shot.n] : undefined
    let dur = clip ? clip.seconds : shot.durationSec
    if (shot.render === 'video' && !clip) { notes.push(`shot ${shot.n}: no clip available, rendered by the engine instead`) }
    const beat = beatByNo.get(shot.beat)
    const sp = beat && beat.line && !spokenBeats.has(beat.n) ? input.speech[beat.n] : undefined
    let voiceStart: number | null = null
    if (beat && sp) {
      spokenBeats.add(beat.n)
      voiceStart = Math.max(t + PAD, voiceFree)
      const end = voiceStart + sp.seconds
      voiceFree = end + GAP
      // keep the speaker on screen while talking; a video clip cannot be stretched, so its voice may run into the next shot
      if (!clip) dur = Math.max(dur, end + TAIL - t)
    }
    planned.push({ shot, start: t, dur, voiceStart, beatNo: beat?.n ?? null })
    t += dur
  }

  // ---- pass 2: layers ----
  const shots: TimelineInput['shots'] = []
  const voices: NonNullable<TimelineInput['voices']> = []
  const captions: NonNullable<TimelineInput['captions']> = []
  const sfx: NonNullable<TimelineInput['sfx']> = []
  const defaultCast = Object.keys(input.kits)[0]

  planned.forEach((p, i) => {
    const { shot, start, dur } = p
    const beat = p.beatNo !== null ? beatByNo.get(p.beatNo) : undefined
    const sp = beat && p.voiceStart !== null ? input.speech[beat.n] : undefined
    const clip = shot.render === 'video' ? input.clips[shot.n] : undefined
    const plate = input.plates[shot.n] ?? input.fallbackPlate
    const who = shot.characters[0] ?? (beat?.speaker && beat.speaker !== 'narrator' ? beat.speaker : defaultCast)
    const kit = input.kits[who] ?? input.kits[defaultCast]
    const speaker = beat?.speaker && beat.speaker !== 'narrator' ? input.kits[beat.speaker] : undefined
    const text = `${shot.description} ${beat?.action ?? ''}`
    const layers: Layer[] = []

    let camera: TimelineInput['shots'][number]['camera'] = { move: 'push-in', intensity: 0.4, handheld: 0.3 }
    let transitionIn: 'cut' | 'fade' | 'whip' = 'cut'

    if (clip) {
      camera = { move: 'static', intensity: 0, handheld: 0.1 }
    } else if (sp && speaker && shot.type !== 'establishing') {
      // a character speaks: the steady face fills the frame; only the mouth moves, with blinks and head nods
      const talk: Extract<Layer, { kind: 'character' }> = {
        kind: 'character', id: `${who}-face`, x: 0.5, y: 1.005, width: 1.0, flip: false, motion: 'breathe', enter: 'none', enterAtSec: 0,
        frames: mouthFrames(sp.mouthKeys, { startSec: p.voiceStart! - start, endSec: p.voiceStart! - start + sp.seconds, mouthSrc: speaker.face, restSrc: speaker.face[0] }),
        talk: { energy: sp.energy, startSec: p.voiceStart! - start, amount: isFear(beat?.emotion) ? 1.4 : 1 },
        blinks: { src: speaker.blink, times: blinkTimes(dur, shot.n), holdSec: 0.13 },
        ...(isFear(beat?.emotion) ? { shiver: { fromSec: p.voiceStart! - start, toSec: p.voiceStart! - start + sp.seconds, amount: 0.8 } } : {}),
      }
      layers.push(talk)
      camera = { move: 'push-in', intensity: 0.5, handheld: 0.35 }
      transitionIn = i > 0 && planned[i - 1].shot.type !== 'dialogue' ? 'whip' : 'cut'
    } else if (kit) {
      const base = { kind: 'character' as const, id: who, flip: false, enter: 'none' as const, enterAtSec: 0, motion: 'breathe' as const }
      if (shot.type === 'reaction' || shot.type === 'subtle') {
        const bust = kit.emotions[emotionBust(beat?.emotion)]
        layers.push({ ...base, id: `${who}-react`, x: 0.5, y: 1.02, width: 1.0, frames: [{ atSec: 0, src: bust }], enter: 'pop' })
        camera = { move: 'push-in', intensity: shot.type === 'reaction' ? 0.7 : 0.3, handheld: 0.4 }
      } else if (shot.type === 'action') {
        if (JUMP.test(text) || !WALK.test(text)) {
          // crouch -> air -> crouch -> stand, with a hop arc (squash and stretch is automatic)
          const hop = Math.min(0.9, 0.25 + 0.1)
          layers.push({ ...base, x: 0.62, y: 0.98, width: 0.85, motion: 'none',
            frames: [{ atSec: 0, src: kit.stand }, { atSec: 0.25, src: kit.crouch }, { atSec: 0.55, src: kit.air }, { atSec: 1.35, src: kit.crouch }, { atSec: 1.7, src: kit.stand }],
            path: { from: { x: 0.62, y: 0.98 }, to: { x: 0.36, y: 0.98 }, startSec: 0.55, endSec: Math.min(1.4, dur - 0.2), arc: hop + 0.05, ease: 'inOut', scaleTo: 1 } })
          camera = { move: 'shake', intensity: 0.9, handheld: 0.3 }
        } else {
          layers.push({ ...base, x: 0.5, y: 0.98, width: 0.95, frames: [{ atSec: 0, src: kit.stand }],
            path: { from: { x: -0.2, y: 0.98 }, to: { x: 0.5, y: 0.98 }, startSec: 0.1, endSec: Math.max(1, dur - 0.7), ease: 'inOut', arc: 0, scaleTo: 1 },
            cycle: { frames: kit.walk, hz: 3.4, fromSec: 0.1, toSec: Math.max(1, dur - 0.7), bounce: 0.014, lean: 3 } })
          camera = { move: 'pan-right', intensity: 0.5, handheld: 0.3 }
        }
        transitionIn = 'whip'
      } else if (shot.type === 'establishing') {
        if (WALK.test(text)) {
          layers.push({ ...base, x: 0.5, y: 0.98, width: 0.95, frames: [{ atSec: 0, src: kit.stand }],
            path: { from: { x: -0.2, y: 0.98 }, to: { x: 0.5, y: 0.98 }, startSec: 0.1, endSec: Math.max(1, dur - 0.8), ease: 'inOut', arc: 0, scaleTo: 1 },
            cycle: { frames: kit.walk, hz: 3.4, fromSec: 0.1, toSec: Math.max(1, dur - 0.8), bounce: 0.014, lean: 3 } })
        } else {
          layers.push({ ...base, x: 0.5, y: 0.98, width: 0.85, frames: [{ atSec: 0, src: kit.stand }], enter: 'pop' })
        }
        camera = { move: 'push-in', intensity: 0.6, handheld: 0.3 }
      } else if (shot.type === 'dialogue') {
        layers.push({ ...base, id: `${who}-listen`, x: 0.5, y: 1.02, width: 1.0, frames: [{ atSec: 0, src: kit.face[0] }], motion: 'breathe',
          blinks: { src: kit.blink, times: blinkTimes(dur, shot.n), holdSec: 0.13 } })
      }
    } else {
      notes.push(`shot ${shot.n}: no character kit for "${who}", shown without a character`)
    }

    // atmosphere
    if (!clip) {
      if (STEAM.test(text)) layers.unshift({ kind: 'particles', preset: 'steam', count: 10 })
      else if (SPARKLE.test(text)) layers.unshift({ kind: 'particles', preset: 'sparkles', count: 12 })
      else if (shot.type === 'establishing') layers.unshift({ kind: 'particles', preset: 'dust', count: 12 })
    }
    // short on-screen text (the only story-telling in no-voice episodes)
    if (beat?.onScreenText) layers.push({ kind: 'text', text: beat.onScreenText, atSec: 0.25, durationSec: Math.max(0.8, Math.min(2.4, dur - 0.5)), position: 'top' })

    if (i > 0 && transitionIn === 'cut' && clip) transitionIn = 'fade'
    shots.push({
      id: `shot-${shot.n}-${shot.type}`, durationSec: Math.round(dur * 1000) / 1000, background: clip ? (input.stills[shot.n] ?? plate) : plate,
      ...(clip ? { video: { src: clip.file, startFromSec: 0, playbackRate: 1 } } : {}),
      camera, layers, transitionIn,
    })

    if (transitionIn === 'whip' && i > 0) sfx.push({ src: input.sfx.whoosh, startSec: Math.max(0, start - 0.15), volume: 0.7 })
    if (!clip && layers.some((l) => l.kind === 'particles' && l.preset === 'steam')) sfx.push({ src: input.sfx.hiss, startSec: start + 0.3, volume: 0.2 })
    if (shot.type === 'action' && !clip && JUMP.test(text)) sfx.push({ src: input.sfx.thud, startSec: start + 1.4, volume: 0.8 })

    if (sp && beat && p.voiceStart !== null) {
      voices.push({ src: sp.file, startSec: Math.round(p.voiceStart * 1000) / 1000, volume: 1 })
      captions.push({
        text: beat.line!, startSec: p.voiceStart, endSec: p.voiceStart + sp.seconds,
        words: alignToScript(beat.line!, sp.words, p.voiceStart),
      })
    }
  })

  const timeline = TimelineSchema.parse({
    fps, width: input.width ?? 1080, height: input.height ?? 1920,
    look: { ...(input.look ?? { grade: 'warm', grain: 0.15, vignette: 0.32 }), captionPosition: 'top' },
    shots, voices, sfx, captions, music: input.music ?? null,
  })

  return { timeline, notes, durationSec: t, shotStarts: planned.map((p) => p.start) }
}

/** Turns the raw loudness of a speech clip into the lip-sync and head-nod data the builder needs. */
export function speechInfoFrom(file: string, seconds: number, words: Word[], rms: number[], fps = 30): SpeechInfo {
  return { file, seconds, words, mouthKeys: mouthTrackFromRms(rms, fps), energy: energyEnvelope(rms) }
}
