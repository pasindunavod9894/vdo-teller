// Single place that decides which OpenAI model each agent uses (plan §3b: cheapest model that does the job).
export const MODELS = {
  showrunner: process.env.OPENAI_MODEL_SHOWRUNNER || 'gpt-5-mini',
} as const

export const REASONING = { showrunner: 'low' } as const
