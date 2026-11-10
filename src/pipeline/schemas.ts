import { z } from 'zod'
import { EXPRESSION_VOCAB } from '../lib/expressions'
import { VIBE_IDS, type VibeId } from '../lib/vibes'

// Structured outputs of each agent. Agents return compact JSON, never prose (plan §3b).

export const IdeaSchema = z.object({
  title: z.string().describe('episode title, max 8 words'),
  premise: z.string().describe('one sentence premise'),
  hook: z.string().describe('what happens in the first 2 seconds'),
  emotionalCore: z.string().nullable().describe('the one feeling the viewer has at the end, a few words'),
  runningGag: z.string().nullable().describe('a small repeatable joke or motif that could come back in later reels, or null'),
  vibe: z.enum(VIBE_IDS).describe('the vibe of this reel: one of the vibes listed in the series profile, chosen to suit its niche and different for each of the three ideas'),
  arc: z.string().describe('how the main character\'s feeling changes from the first beat to the last: 3 to 5 feelings joined by " > "'),
})

/** What the Creator returns: three ideas that differ in kind (not only in wording). */
export const IdeasSchema = z.object({
  ideas: z.array(IdeaSchema).describe('exactly 3 ideas for the next reel, different in kind, none repeating a recent title or gag'),
})

const score15 = z.number().int().describe('1 (poor) to 5 (excellent)')
/** The Story Builder's idea picker: scores each idea and names the best one. */
export const PickSchema = z.object({
  scores: z.array(z.object({ index: z.number().int().describe('0-based index of the idea'), hook: score15.describe('does it hook in 2 seconds'), novelty: score15.describe('new compared with the recent reels'), castFit: score15.describe('suits these characters'), vibeFit: score15.describe('its vibe suits the niche and is NOT the vibe of the last two reels'), filmable: score15.describe('can be told in the number of shots the reel has') })),
  bestIndex: z.number().int().describe('0-based index of the best idea'),
  reason: z.string().describe('one short sentence'),
})

export const BeatSchema = z.object({
  n: z.number().int().describe('beat number starting at 1'),
  action: z.string().describe('what we see, one short sentence'),
  speaker: z.string().nullable().describe('speaking character or "narrator", null when nobody speaks'),
  line: z.string().nullable().describe('spoken line, null when nobody speaks'),
  emotion: z.string().nullable().describe('emotion of the line, e.g. smug, scared'),
  expression: z.enum(EXPRESSION_VOCAB).describe('the facial expression of the main character in this shot: ONLY one of the expressions listed in the series profile, following the arc of the vibe'),
  delivery: z.string().nullable().describe('delivery note, e.g. whispering'),
  onScreenText: z.string().nullable().describe('short on-screen text (max 6 words) or null'),
})

/** A character the story needs that is not part of the series' main cast (a shopkeeper, a rival, a bystander). The Story Builder decides. */
export const SupportingCharacterSchema = z.object({
  name: z.string().describe('a short name, used as the speaker name in beats'),
  role: z.string().describe('who they are in this story, one phrase'),
  canonicalLook: z.string().describe('max 50 words: species or age, colours, markings, outfit, one signature detail. It must NOT resemble any main character.'),
  personality: z.string(),
  voice: z.string().nullable().describe('a text-to-speech voice id, or null to let the studio pick one that differs from the main cast'),
  recurring: z.boolean().describe('true if this character should come back in later reels of the series'),
})

export const ScriptSchema = z.object({
  title: z.string(),
  hook: z.string(),
  beats: z.array(BeatSchema).describe('6 to 7 beats, one filmable shot each: a short story that changes how the character feels'),
  payoff: z.string().describe('the final funny or surprising moment'),
  supportingCast: z.array(SupportingCharacterSchema).describe('supporting characters this reel needs besides the main cast; an empty list when the main cast is enough'),
})

/** The Critic's rubric: every item scored 1 to 5. The approval is decided in code from these, never from the model's own opinion. */
export const RubricSchema = z.object({
  hook: score15.describe('the hook lands in the first 2 seconds'),
  silentClarity: score15.describe('the story is clear with the sound off'),
  emotionalArc: score15.describe('the character\'s feelings change across the story as the vibe\'s arc says, with at least three different expressions'),
  payoff: score15.describe('a satisfying funny or surprising payoff'),
  castTruth: score15.describe('each character acts true to its personality'),
  feasibility: score15.describe('every beat is one filmable shot with only the cast, and each spoken line fits its shot'),
  originality: score15.describe('original, nothing copied'),
  loop: score15.describe('it makes people watch again or follow'),
})
export const RubricCritiqueSchema = z.object({
  rubric: RubricSchema,
  failingBeats: z.array(z.number().int()).describe('the beat numbers that need rewriting; empty when the script is fine'),
  notes: z.array(z.string()).describe('short numbered notes for the Writer, each naming its beat; empty when approved'),
  originalityRisk: z.boolean(),
  policyRisk: z.boolean(),
})
export type Rubric = z.infer<typeof RubricSchema>

/** The stored verdict. `approved` and `score` are computed in code (see normalizeCritique). */
export type Critique = { score: number; approved: boolean; notes: string[]; originalityRisk: boolean; policyRisk: boolean; rubric?: Rubric; failingBeats?: number[] }

/** Per-reel style notes from the Style agent: the mood of THIS reel inside the series look. */
export const EpisodeStyleSchema = z.object({
  mood: z.string().describe('the mood of this reel in a few words'),
  timeOfDay: z.string().describe('time of day, e.g. golden hour'),
  weather: z.string().describe('weather or atmosphere, e.g. light rain, or clear'),
  accentColour: z.string().describe('one accent colour for this reel as #RRGGBB, taken from the series palette'),
  note: z.string().describe('one sentence of extra direction for the images'),
})
export type EpisodeStyle = z.infer<typeof EpisodeStyleSchema>

export const SHOT_TYPES = ['establishing', 'dialogue', 'action', 'subtle', 'reaction', 'info'] as const
/** Every shot is a video clip made from a keyframe (there is no cheaper engine shot). */
export const ShotListSchema = z.object({
  shots: z.array(z.object({
    n: z.number().int(),
    type: z.enum(SHOT_TYPES),
    description: z.string().describe('what the shot shows, one sentence'),
    durationSec: z.number().describe('seconds on screen, 1.5 to 6'),
    characters: z.array(z.string()).describe('only names from the main cast or this script\'s supporting cast'),
    beat: z.number().int().describe('script beat number this shot covers'),
    videoSeconds: z.number().describe('length of the video clip, 5 or 10'),
    keyframePrompt: z.string().describe('the still image to start from: framing, angle, what each character is doing and feeling. No brand names, no text in the image.'),
    motionPrompt: z.string().describe('what moves and how the camera moves, one simple action, no brand names'),
    angle: z.string().optional().describe('camera angle and framing, for example "low angle close-up"'),
  })),
})

/** What the Art Director returns: the shot list, and the beats it could not turn into a filmable shot. */
export const ShotsDraftSchema = z.object({
  shots: z.array(z.object({
    n: z.number().int(), type: z.enum(SHOT_TYPES), description: z.string().describe('what the shot shows, one sentence'),
    durationSec: z.number().describe('seconds on screen'), characters: z.array(z.string()).describe('only names from the main cast or this script\'s supporting cast'),
    beat: z.number().int().describe('the script beat this shot covers'), videoSeconds: z.number().describe('5 or 10'),
    keyframePrompt: z.string().describe('the still image to start from: framing, angle, what each character is doing and feeling. No brand names, no text in the image.'),
    motionPrompt: z.string().describe('what moves and how the camera moves: one simple action, no brand names'),
    angle: z.string().describe('camera angle and framing, for example "low angle close-up"'),
  })).describe('exactly one shot per beat, in order'),
  unfilmable: z.array(z.object({ beat: z.number().int(), reason: z.string() })).describe('beats that cannot be shown as ONE shot with only the cast; empty when everything can be filmed'),
})

export const PublishSchema = z.object({
  title: z.string().describe('max 70 characters'),
  caption: z.string().describe('one short playful sentence with up to 2 emojis'),
  hashtags: z.array(z.string()).describe('exactly 3 hashtags starting with #'),
  aiLabel: z.string().describe('short synthetic-content disclosure'),
})

export type Idea = z.infer<typeof IdeaSchema>
export type Pick = z.infer<typeof PickSchema>
/** The script the Writer returns, plus the vibe of its idea (attached in code: the Writer does not write it). */
export type Script = z.infer<typeof ScriptSchema> & { vibe?: VibeId }
export type ShotList = z.infer<typeof ShotListSchema>
export type Publish = z.infer<typeof PublishSchema>

export type VideoClipStatus = 'planned' | 'generated' | 'mock' | 'needs-still' | 'skipped-budget' | 'failed' | 'drifted'

/** What the continuity check found for one clip (plan R1-E). */
export type ClipContinuity = { ok: boolean; attempts: number; scores: Record<string, number>; issues: string[] }

/** One video shot. `planned` = chosen by the Art Director, not generated yet (generation needs the shot's keyframe). */
export type VideoClip = {
  shot: number; model: string; seconds: number
  estimatedUsd: number; costUsd: number
  status: VideoClipStatus; file?: string; error?: string
  /** set when the clip was lip-synced: the model and what it cost */
  lipsync?: { model: string; costUsd: number }
  continuity?: ClipContinuity
}

export type Timeline = {
  durationSec: number
  shots: { n: number; type: string; camera: string; motion: string; durationSec: number; videoSeconds: number }[]
  audio: { voices: { speaker: string; voice: string; text: string }[]; music: string; sfx: string[] }
  videoClips: VideoClip[]
  mock: boolean
}

/** The vision check of the finished reel: one entry per shot. Problems are flagged, never re-made automatically. */
export const ReelQaSchema = z.object({
  shots: z.array(z.object({
    n: z.number().int().describe('the shot number'),
    ok: z.boolean(),
    kind: z.enum(['captions', 'frame', 'text', 'character', 'other']).describe('what is wrong; "other" when ok'),
    issue: z.string().describe('one short sentence; empty when ok'),
  })),
})
export type ReelQaFlag = { shot: number; kind: 'captions' | 'frame' | 'text' | 'character' | 'other'; issue: string }

export type QaReport = { passed: boolean; checks: { name: string; ok: boolean; note: string }[]; mock: boolean; /** shots the vision check wants a person to look at */ flags?: ReelQaFlag[] }
