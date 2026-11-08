export type VoiceMode = 'none' | 'narrator' | 'character_voices' | 'narrator_and_characters'

export type VoiceProfile = { voice: string; instructions?: string; pace?: string; pitch?: string; accent?: string }

export type SeriesProfile = {
  niche: string
  subNiche?: string
  style: { id: string; promptTemplate?: string; engineFit?: number }
  format: 'story-reel' | 'quick-reel' | 'long-form'
  durationTargetSec: number
  aspect: '9:16' | '16:9' | '1:1' | '4:5'
  voiceMode: VoiceMode
  narrator?: VoiceProfile | null
  cast: { name: string; canonical: string; personality?: string; voiceProfile?: VoiceProfile | null; assetPackId?: string | number }[]
  locations?: { name: string; plateIds?: (string | number)[] }[]
  referencePatterns?: { premiseFormula?: string; shotRhythm?: string; captionFormat?: string }[]
  qualityTier: 'budget' | 'standard' | 'premium'
  language?: string
  audience?: string
}

export type AgentName = 'orchestrator' | 'showrunner' | 'writer' | 'critic' | 'artDirector' | 'animator' | 'editorQa' | 'publisher'
