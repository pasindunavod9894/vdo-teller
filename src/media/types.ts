import type { Word } from '../engine/transcribe'

/**
 * Everything the pipeline needs from "media makers" (plan phase 9), behind one interface so the SAME pipeline runs with the
 * real OpenAI services or with free mock ones that produce placeholder art and a synthetic voice.
 */
export type SpeechSpec = { name: string; text: string; voice: string; instructions?: string }
/** `file` is a name inside the episode workspace's assets folder; `words` are clip-relative (start at 0). */
export type SpeechResult = { file: string; seconds: number; words: Word[]; costUsd: number }
export type PlateResult = { file: string; costUsd: number; cached: boolean }
export type GateResult = { pass: boolean; notes: string; costUsd: number }

export interface MediaServices {
  provider: 'mock' | 'openai'
  /** the folder that holds every asset the timeline references (what Remotion serves) */
  assetsDir: string
  /** a vertical background plate (no characters), cached by `key` so a recurring location is generated once per series */
  plate(spec: { key: string; prompt: string }): Promise<PlateResult>
  /** text-to-speech plus word timings */
  speech(spec: SpeechSpec): Promise<SpeechResult>
  /** a quality check on a generated still BEFORE any video money is spent on it */
  gate(file: string, rules: string): Promise<GateResult>
}
