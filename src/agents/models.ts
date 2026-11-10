import { tokenOptimization } from './optimization'

// Single place that decides which OpenAI model each agent uses (plan §3b: cheapest model that does the job).
export const MODELS = {
  showrunner: process.env.OPENAI_MODEL_SHOWRUNNER || 'gpt-5-mini',
  /** the Creator: three ideas from trends, the cast and the series memory (can search the web) */
  creator: process.env.OPENAI_MODEL_CREATOR || 'gpt-5-mini',
  /** the Story Builder's idea picker: a small scoring call */
  picker: process.env.OPENAI_MODEL_PICKER || 'gpt-5-mini',
  /** the Art Director: the shot list by meaning */
  artDirector: process.env.OPENAI_MODEL_ART_DIRECTOR || 'gpt-5-mini',
  /** per-reel style notes: tiny */
  episodeStyle: process.env.OPENAI_MODEL_EPISODE_STYLE || 'gpt-5-nano',
  /** the vision check of the finished reel */
  reelQa: process.env.OPENAI_MODEL_REEL_QA || 'gpt-5-mini',
  writer: process.env.OPENAI_MODEL_WRITER || 'gpt-5',
  // the Critic scores a rubric with judgement, which the smallest model does too loosely
  critic: process.env.OPENAI_MODEL_CRITIC || 'gpt-5-mini',
  publisher: process.env.OPENAI_MODEL_PUBLISHER || 'gpt-5-nano',
  /** the Style agent: writes a series' style bible once */
  style: process.env.OPENAI_MODEL_STYLE || 'gpt-5-mini',
  /** vision model that checks every clip for character drift; switch to gpt-5 for the strictest check */
  continuity: process.env.OPENAI_MODEL_CONTINUITY || 'gpt-5-mini',
} as const

export const REASONING = { showrunner: 'low', creator: 'low', picker: 'minimal', writer: 'low', critic: 'low', publisher: 'minimal', style: 'low', continuity: 'minimal', artDirector: 'low', episodeStyle: 'minimal', reelQa: 'minimal' } as const

export type AgentModelKey = keyof typeof MODELS

// Hard output limit per agent (plan §3b). Reasoning tokens count against it, so each cap is generous but finite:
// a runaway answer is cut off instead of being paid for.
export const MAX_OUTPUT_TOKENS: Record<AgentModelKey, number> = { showrunner: 1500, creator: 3000, picker: 1000, writer: 4000, critic: 2000, publisher: 1000, style: 2500, continuity: 1500, artDirector: 4000, episodeStyle: 600, reelQa: 1500 }

/** Flex processing (about half price, may be briefly unavailable) is used only for scheduled, non-interactive runs, and only when switched on. */
export const FLEX_DISCOUNT = 0.5
export const flexEnabled = () => tokenOptimization() && process.env.OPENAI_FLEX === '1'

/** The output cap for an agent; none at all while token optimization is off. */
export const maxOutputTokens = (k: AgentModelKey): number | undefined => (tokenOptimization() ? MAX_OUTPUT_TOKENS[k] : undefined)

// Approximate USD per 1M tokens: [input, cached input, output]. Verify on the OpenAI pricing page.
const PRICES: Record<string, [number, number, number]> = {
  'gpt-5': [1.25, 0.125, 10],
  'gpt-5-mini': [0.25, 0.025, 2],
  'gpt-5-nano': [0.05, 0.005, 0.4],
}

export function tokenCostUsd(model: string, u: { inputTokens: number; cachedTokens: number; outputTokens: number }, opts: { flex?: boolean } = {}) {
  const p = PRICES[model] ?? PRICES['gpt-5']
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens)
  const usd = (fresh * p[0] + u.cachedTokens * p[1] + u.outputTokens * p[2]) / 1_000_000
  return opts.flex ? usd * FLEX_DISCOUNT : usd
}
