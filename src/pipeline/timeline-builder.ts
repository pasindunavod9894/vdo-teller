import type { Word } from '../engine/transcribe'
import { alignToScript } from '../engine/transcribe'
import type { Look, Timeline, TimelineInput, Transition } from '../engine/timeline'
import { TimelineSchema } from '../engine/timeline'
import type { Script, ShotList } from './schemas'

/**
 * Turns an episode's script, shot list, speech and video clips into the assembler's timeline (plan R1-D). Pure: no files are
 * read here, so it can be tested exhaustively. The Editor step supplies the inputs.
 * Timing rule: a shot starts where the earlier shots end, a transition happens in the time just before it, and a spoken line
 * starts a little after its shot starts (and never overlaps the line before it).
 */
export type SpeechInfo = {
  /** file name inside the assets folder */
  file: string
  seconds: number
  /** clip-relative word timings */
  words: Word[]
}

export type BuildInput = {
  fps?: number
  width?: number
  height?: number
  look?: Look
  script: Script
  shots: ShotList['shots']
  /** keyed by beat number: the line spoken in that beat */
  speech: Record<number, SpeechInfo>
  /** per shot number: the finished clip (file name inside the assets folder) and its length */
  clips: Record<number, { file: string; seconds: number }>
  /** the transitions the style allows; a cut is always allowed too */
  transitions?: Transition[]
  sfx: { whoosh: string }
  /** background music: a file name and its level (it is ducked under speech when mixed) */
  music?: { src: string; volume: number } | null
  /** the length the reel should have (its format, 10 / 15 / 30 s): shots with slack are shortened when the reel runs over it */
  targetSec?: number
}

export type BuildResult = { timeline: Timeline; notes: string[]; durationSec: number; shotStarts: number[] }

const PAD = 0.3 // a voice starts this long after its shot starts
const GAP = 0.12 // silence between two voices
const TAIL = 0.45 // a speaker stays on screen this long after the last word
const TRANSITION_SEC = 0.3
const CAPTION_WORDS = 6 // a caption shows at most this many words at a time
const MIN_SHOT = 1.5 // a shot is never shortened below this
const OVER_TOLERANCE = 0.5 // how far over the target a reel may run before its shots are shortened
const TRANSITION_SOUND = /^(slide|wipe|smooth|zoomin|radial|circle)/

/** How long a shot has to be on screen to carry a spoken line of `speechSec` seconds. */
export const voiceNeedSec = (speechSec: number) => PAD + speechSec + TAIL

/** Splits a spoken line into caption chunks of at most `max` words, each with its own window taken from the word timings. */
export function captionChunks(text: string, words: Word[], startSec: number, endSec: number, max = CAPTION_WORDS) {
  const timed = words.length ? words : (() => {
    const parts = text.split(/\s+/).filter(Boolean)
    const step = (endSec - startSec) / Math.max(1, parts.length)
    return parts.map((t, i) => ({ text: t, startSec: startSec + i * step, endSec: startSec + (i + 1) * step }))
  })()
  const out: { text: string; startSec: number; endSec: number; words: Word[] }[] = []
  for (let i = 0; i < timed.length; i += max) {
    const part = timed.slice(i, i + max)
    out.push({ text: part.map((w) => w.text).join(' '), startSec: part[0].startSec, endSec: i + max >= timed.length ? endSec : timed[i + max].startSec, words: part })
  }
  return out
}

/** The transition into shot `i`: the first shot and a conversation (dialogue after dialogue) cut, action gets the most energetic one. */
export function pickTransition(i: number, type: string, prevType: string | null, allowed: Transition[]): Transition {
  const usable = allowed.filter((t) => t !== 'cut')
  if (i === 0 || !usable.length) return 'cut'
  if (type === 'dialogue' && prevType === 'dialogue') return 'cut'
  if (type === 'action') return usable.find((t) => /slide|zoom|wipe/.test(t)) ?? usable[0]
  return i % 3 === 0 ? 'cut' : usable[i % usable.length]
}

type Row = { shot: ShotList['shots'][number]; clip: { file: string; seconds: number }; beat: Script['beats'][number] | undefined; sp: SpeechInfo | null; dur: number; /** the shortest the shot can be */ need: number; voiceStart: number | null; start: number }

/** Places every shot one after the other with its voice line, giving a shot room for the whole line and keeping lines from overlapping. */
function layout(input: BuildInput, durationOf: (i: number, shot: ShotList['shots'][number]) => number): { rows: Row[]; total: number } {
  const beats = new Map(input.script.beats.map((b) => [b.n, b]))
  const spokenBeats = new Set<number>()
  const rows: Row[] = []
  let cursor = 0
  let voiceEnd = 0
  input.shots.forEach((s, i) => {
    const clip = input.clips[s.n]
    if (!clip) throw new Error(`Shot ${s.n} has no video clip`)
    const beat = beats.get(s.beat)
    // one line per beat: it belongs to the first shot of that beat
    const sp = beat && beat.line && input.speech[beat.n] && !spokenBeats.has(beat.n) ? input.speech[beat.n] : null
    if (sp && beat) spokenBeats.add(beat.n)
    let dur = durationOf(i, s)
    let voiceStart: number | null = null
    if (sp) {
      voiceStart = Math.max(cursor + PAD, voiceEnd + GAP)
      dur = Math.max(dur, voiceStart - cursor + sp.seconds + TAIL)
      voiceEnd = voiceStart + sp.seconds
    }
    rows.push({ shot: s, clip, beat, sp, dur, need: sp ? voiceNeedSec(sp.seconds) : MIN_SHOT, voiceStart, start: cursor })
    cursor += dur
  })
  return { rows, total: cursor }
}

export function buildTimeline(input: BuildInput): BuildResult {
  const notes: string[] = []
  const allowed: Transition[] = input.transitions?.length ? input.transitions : ['fade', 'slideleft']
  let { rows, total } = layout(input, (_, s) => s.durationSec)

  // fit the format: when the reel runs over its length, shorten the shots that have slack (never below their voice or 1.5 s) and place everything again
  const target = input.targetSec
  if (target && total > target + OVER_TOLERANCE) {
    const slack = rows.map((r) => Math.max(0, r.dur - Math.max(r.need, MIN_SHOT)))
    const totalSlack = slack.reduce((n, x) => n + x, 0)
    if (totalSlack > 0) {
      const cut = Math.min(total - target, totalSlack)
      const planned = rows.map((r, i) => r.dur - (cut * slack[i]) / totalSlack)
      ;({ rows, total } = layout(input, (i) => planned[i]))
    }
    if (total > target + 1) notes.push(`the reel is ${total.toFixed(1)}s, longer than its ${target}s format: the shots could not be shortened enough`)
  }

  const shots: Timeline['shots'] = []
  const voices: Timeline['voices'] = []
  const sfx: Timeline['sfx'] = []
  const captions: Timeline['captions'] = []
  const starts: number[] = []
  let prevType: string | null = null
  rows.forEach((r, i) => {
    const { shot: s, clip, beat, sp, dur, voiceStart } = r
    if (dur > clip.seconds + 0.05) notes.push(`shot ${s.n}: ${dur.toFixed(1)}s is longer than its ${clip.seconds}s clip, so the last frame is held`)
    const transitionIn = pickTransition(i, s.type, prevType, allowed)
    starts.push(r.start)
    shots.push({
      id: `shot-${s.n}`, clip: clip.file, durationSec: Math.round(dur * 100) / 100, trimStartSec: 0, transitionIn, transitionSec: TRANSITION_SEC,
      text: beat?.onScreenText ? [{ text: beat.onScreenText, atSec: 0.3, durationSec: Math.max(0.6, Math.min(dur - 0.3, 2.2)), position: 'top' as const }] : [],
    })
    if (transitionIn !== 'cut' && TRANSITION_SOUND.test(transitionIn)) sfx.push({ src: input.sfx.whoosh, startSec: Math.max(0, r.start - TRANSITION_SEC), volume: 0.5 })
    if (sp && beat && voiceStart !== null) {
      voices.push({ src: sp.file, startSec: Math.round(voiceStart * 100) / 100, volume: 1 })
      const aligned = alignToScript(beat.line!, sp.words, voiceStart)
      captions.push(...captionChunks(beat.line!, aligned, voiceStart, voiceStart + sp.seconds))
    }
    prevType = s.type
  })

  const timeline = TimelineSchema.parse({
    fps: input.fps, width: input.width, height: input.height, shots, voices, sfx, captions, music: input.music ?? null,
    ...(input.look ? { look: input.look } : {}),
  } satisfies TimelineInput)
  return { timeline, notes, durationSec: total, shotStarts: starts }
}

/** Packs a finished speech clip for the builder. */
export function speechInfoFrom(file: string, seconds: number, words: Word[]): SpeechInfo {
  return { file, seconds, words }
}
