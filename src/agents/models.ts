// Single place that decides which OpenAI model each agent uses (plan §3b: cheapest model that does the job).
export const MODELS = {
  showrunner: process.env.OPENAI_MODEL_SHOWRUNNER || 'gpt-5-mini',
  writer: process.env.OPENAI_MODEL_WRITER || 'gpt-5',
  critic: process.env.OPENAI_MODEL_CRITIC || 'gpt-5-nano',
  publisher: process.env.OPENAI_MODEL_PUBLISHER || 'gpt-5-nano',
} as const

export const REASONING = { showrunner: 'low', writer: 'low', critic: 'minimal', publisher: 'minimal' } as const

export type AgentModelKey = keyof typeof MODELS

// Hard output limit per agent (plan §3b). Reasoning tokens count against it, so each cap is generous but finite:
// a runaway answer is cut off instead of being paid for.
export const MAX_OUTPUT_TOKENS: Record<AgentModelKey, number> = { showrunner: 1500, writer: 4000, critic: 1500, publisher: 1000 }

/** Flex processing (about half price, may be briefly unavailable) is used only for scheduled, non-interactive runs, and only when switched on. */
export const FLEX_DISCOUNT = 0.5
export const flexEnabled = () => process.env.OPENAI_FLEX === '1'

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
