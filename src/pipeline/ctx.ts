import type { z } from 'zod'
import type { AgentName, SeriesProfile } from '@/agents/profile'
import type { AgentModelKey } from '@/agents/models'
import type { BuiltPrompt } from '@/agents/prompt-builder'
import type { VideoModelId } from '../lib/video'
import type { MediaCtx } from './media-ctx'
import type { PipelineMode } from './steps'
import type { SeriesMemory } from './memory'

export type Usage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number; videoSeconds?: number; /** new images made (cache hits are not counted) */ images?: number }
export type AgentResult<T> = { output: T; summary: string; usage?: Usage }

/** One request to a language model: which agent, which model, what the answer must look like, and the prompt. */
export type LlmCall = { agent: AgentName; modelKey: AgentModelKey; model: string; schema: z.ZodType; prompt: BuiltPrompt; flex: boolean; /** the model may search the web (the Creator) */ webSearch?: boolean }
export type LlmReply = { output: unknown; usage: { inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number } }
/** The one place a model is actually called. The default uses the OpenAI Agents SDK; tests pass a fake that returns canned answers. */
export type LlmRunner = (call: LlmCall) => Promise<LlmReply>

export type Ctx = {
  profile: SeriesProfile
  seriesId: string | number
  mode: PipelineMode
  /** simulated work time for mock agents, so the progress card is watchable. 0 in tests. */
  delayMs: number
  /** the video budget for THIS episode (limited by the money left under the cost cap); see src/lib/video.ts */
  video: { model: VideoModelId; allowanceSec: number; provider: 'fal' | 'mock' }
  /** real media (plates, keyframes, voices, clips, assembly). Absent = the agents return free mock results. */
  media?: MediaCtx
  /** set by the Orchestrator: true while `usd` more can be spent under the series cost cap */
  canSpend?: (usd: number) => Promise<boolean>
  /** a scheduled (non-interactive) run: may use the cheaper flex tier when OPENAI_FLEX=1 */
  scheduled?: boolean
  /** the most this one episode may cost, in USD (see budget.ts) */
  episodeCeilingUsd?: number
  /** replaces the real model call (tests) */
  llm?: LlmRunner
  /** what the series remembers from earlier reels: recent ideas, running gags, recurring characters */
  memory?: SeriesMemory
  /** the idea titles that must not be used again (earlier episodes, and ideas the user rejected in the review) */
  avoidTitles?: string[]
}
