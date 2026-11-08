import { z } from 'zod'

// Structured outputs of each agent. Agents return compact JSON, never prose (plan §3b).

export const IdeaSchema = z.object({
  title: z.string().describe('episode title, max 8 words'),
  premise: z.string().describe('one sentence premise'),
  hook: z.string().describe('what happens in the first 3 seconds'),
})

export const BeatSchema = z.object({
  n: z.number().int().describe('beat number starting at 1'),
  action: z.string().describe('what we see, one short sentence'),
  speaker: z.string().nullable().describe('speaking character or "narrator", null when nobody speaks'),
  line: z.string().nullable().describe('spoken line, null when nobody speaks'),
  emotion: z.string().nullable().describe('emotion of the line, e.g. smug, scared'),
  delivery: z.string().nullable().describe('delivery note, e.g. whispering'),
  onScreenText: z.string().nullable().describe('short on-screen text (max 6 words) or null'),
})

export const ScriptSchema = z.object({
  title: z.string(),
  hook: z.string(),
  beats: z.array(BeatSchema).describe('6 to 14 beats for a short reel'),
  payoff: z.string().describe('the final funny or surprising moment'),
})

export const CritiqueSchema = z.object({
  score: z.number().int().describe('1-10 overall'),
  approved: z.boolean().describe('true when the score is 8 or more and no policy risk'),
  notes: z.array(z.string()).describe('short numbered notes for the Writer, empty when approved'),
  originalityRisk: z.boolean(),
  policyRisk: z.boolean(),
})

export const SHOT_TYPES = ['establishing', 'dialogue', 'action', 'subtle', 'reaction', 'info'] as const
export const ShotListSchema = z.object({
  shots: z.array(z.object({
    n: z.number().int(),
    type: z.enum(SHOT_TYPES),
    description: z.string().describe('what the shot shows, one sentence'),
    durationSec: z.number().describe('seconds, 1.5 to 6'),
    characters: z.array(z.string()),
    beat: z.number().int().describe('script beat number this shot covers'),
    render: z.enum(['engine', 'video']).describe('video only for action, establishing or reaction shots, within the video-second allowance; never dialogue or info'),
    videoSeconds: z.number().describe('clip length for a video shot (5 or 10), 0 for an engine shot'),
    motionPrompt: z.string().nullable().describe('for a video shot: what moves and how the camera moves, no brand names; null for engine shots'),
  })),
})

export const PublishSchema = z.object({
  title: z.string().describe('max 70 characters'),
  caption: z.string().describe('one short playful sentence with up to 2 emojis'),
  hashtags: z.array(z.string()).describe('exactly 3 hashtags starting with #'),
  aiLabel: z.string().describe('short synthetic-content disclosure'),
})

export type Idea = z.infer<typeof IdeaSchema>
export type Script = z.infer<typeof ScriptSchema>
export type Critique = z.infer<typeof CritiqueSchema>
export type ShotList = z.infer<typeof ShotListSchema>
export type Publish = z.infer<typeof PublishSchema>

export type VideoClipStatus = 'planned' | 'generated' | 'mock' | 'needs-still' | 'skipped-budget' | 'failed'

/** One real-video shot. `planned` = chosen by the Art Director, not generated yet (generation needs the shot's still). */
export type VideoClip = {
  shot: number; model: string; seconds: number
  estimatedUsd: number; costUsd: number
  status: VideoClipStatus; file?: string; error?: string
}

export type Timeline = {
  durationSec: number
  shots: { n: number; type: string; camera: string; motion: string; durationSec: number; render: 'engine' | 'video'; videoSeconds: number }[]
  audio: { voices: { speaker: string; voice: string; text: string }[]; music: string; sfx: string[] }
  videoClips: VideoClip[]
  mock: boolean
}

export type QaReport = { passed: boolean; checks: { name: string; ok: boolean; note: string }[]; mock: boolean }
