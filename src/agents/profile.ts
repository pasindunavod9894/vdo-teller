import type { Look, Transition } from '../engine/timeline'

export type VoiceMode = 'none' | 'narrator' | 'character_voices' | 'narrator_and_characters'

export type VoiceProfile = { voice: string; instructions?: string; pace?: string; pitch?: string; accent?: string }

export type SeriesProfile = {
  niche: string
  subNiche?: string
  style: {
    id: string
    /** a short version of the look, for the text agents */
    promptTemplate?: string
    /** the full look, for image prompts (from the style bible) */
    imagePrompt?: string
    /** how things move in this series; added to every video prompt */
    motion?: string
    /** what must never appear in a keyframe or clip */
    negative?: string
    /** grade, grain, vignette and caption style for the assembler */
    look?: Look
    /** the transitions the style allows */
    transitions?: Transition[]
  }
  /** the length the reel is planned for in seconds (28): every reel is a short story of 25 to 30 seconds, not chosen by the user */
  durationTargetSec: number
  /** the expressions every main character has in its pack; the base four when not set (a series can add more) */
  expressions?: string[]
  aspect: '9:16' | '16:9' | '1:1' | '4:5'
  voiceMode: VoiceMode
  narrator?: VoiceProfile | null
  cast: { name: string; canonical: string; personality?: string; voiceProfile?: VoiceProfile | null; assetPackId?: string | number }[]
  locations?: { name: string; plateIds?: (string | number)[] }[]
  referencePatterns?: { premiseFormula?: string; shotRhythm?: string; captionFormat?: string }[]
  language?: string
  audience?: string
}

export type AgentName = 'orchestrator' | 'creator' | 'picker' | 'writer' | 'critic' | 'styleNotes' | 'artDirector' | 'editor' | 'reelQa' | 'publisher'
