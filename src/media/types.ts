import type { Word } from '../engine/transcribe'
import type { ReelQaFlag } from '../pipeline/schemas'

/**
 * Everything the pipeline needs from "media makers" (plan phase 9), behind one interface so the SAME pipeline runs with the
 * real OpenAI services or with free mock ones that produce placeholder art and a synthetic voice.
 * File names are inside the episode workspace's assets folder, unless a field says it is an absolute path.
 */
export type SpeechSpec = { name: string; text: string; voice: string; instructions?: string }
/** `file` is a name inside the episode workspace's assets folder; `words` are clip-relative (start at 0). */
export type SpeechResult = { file: string; seconds: number; words: Word[]; costUsd: number }
export type PlateResult = { file: string; costUsd: number; cached: boolean }
export type GateResult = { pass: boolean; notes: string; costUsd: number }

/** A keyframe: the approved still a video clip is made from. It is an image EDIT given the characters' reference images. */
export type KeyframeSpec = { key: string; prompt: string; /** file names in the assets folder: location plate, character references */ references: string[] }
export type KeyframeResult = { file: string; costUsd: number }

/** A one-off reference image for a supporting character the Story Builder invented for this reel. Cached by `key`. */
export type ReferenceSpec = { key: string; prompt: string }
export type ReferenceResult = { file: string; costUsd: number; cached: boolean }

/** Frames sampled across one finished clip (a contact sheet) to compare with the references of the characters in the shot. */
export type ContinuitySpec = { sheetFile: string; characters: { name: string; /** absolute path of its reference image */ reference: string }[]; clipSeconds: number }
export type CharacterContinuity = { name: string; /** 0..1, how sure the checker is that this is the same character */ sameIdentity: number; /** seconds into the clip where the look starts to change, null if it never does */ driftStartSec: number | null; issues: string[] }
export type ContinuityResult = { characters: CharacterContinuity[]; undeclaredCharacters: string[]; costUsd: number }

/** One contact sheet of the finished reel: a frame per shot, left to right in shot order, for the vision check. */
export type ReelQaSpec = { sheetFile: string; shots: number[] }
export type ReelQaResult = { flags: ReelQaFlag[]; costUsd: number }

export interface MediaServices {
  provider: 'mock' | 'openai'
  /** the folder that holds every asset the timeline references */
  assetsDir: string
  /** a vertical background plate (no characters), cached by `key` so a recurring location is generated once per series */
  plate(spec: { key: string; prompt: string }): Promise<PlateResult>
  /** the starting frame of a shot: gpt-image-2 edit of the references (plate + characters) with the shot's composition prompt */
  keyframe(spec: KeyframeSpec): Promise<KeyframeResult>
  /** a reference image for a supporting character */
  reference(spec: ReferenceSpec): Promise<ReferenceResult>
  /** text-to-speech plus word timings */
  speech(spec: SpeechSpec): Promise<SpeechResult>
  /** a quality check on a generated keyframe BEFORE any video money is spent on it; `references` are absolute paths of the characters' references */
  gate(file: string, rules: string, references?: { name: string; file: string }[]): Promise<GateResult>
  /** the continuity check of a finished clip against the references of the characters in it */
  continuity(spec: ContinuitySpec): Promise<ContinuityResult>
  /** the vision check of the finished reel: which shots a person should look at (flags only, nothing is re-made) */
  reelQa(spec: ReelQaSpec): Promise<ReelQaResult>
}
