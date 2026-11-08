/** Turns an episode's pipeline-step rows into the numbers the cost panel shows (plan §3b "measure and enforce"). */
export type StepCost = {
  agent: string; stepKey?: string; model?: string | null; status?: string
  inputTokens?: number | null; cachedTokens?: number | null; outputTokens?: number | null; reasoningTokens?: number | null
  imageCount?: number | null; videoSeconds?: number | null; costUsd?: number | null
}

export type CostSummary = {
  rows: { agent: string; model: string; inTokens: number; cached: number; outTokens: number; images: number; videoSec: number; usd: number }[]
  totalUsd: number
  /** share of input tokens served from the prompt cache, 0..1 (0 when no text agent ran) */
  cacheHit: number
  /** the step that cost the most, if any cost anything */
  biggest: { agent: string; usd: number; share: number } | null
}

export function summarizeCosts(steps: StepCost[]): CostSummary {
  const rows = steps
    .filter((s) => (s.costUsd ?? 0) > 0 || (s.inputTokens ?? 0) > 0 || (s.imageCount ?? 0) > 0 || (s.videoSeconds ?? 0) > 0)
    .map((s) => ({
      agent: s.agent, model: s.model ?? '', inTokens: s.inputTokens ?? 0, cached: s.cachedTokens ?? 0, outTokens: s.outputTokens ?? 0,
      images: s.imageCount ?? 0, videoSec: s.videoSeconds ?? 0, usd: s.costUsd ?? 0,
    }))
  const totalUsd = rows.reduce((n, r) => n + r.usd, 0)
  const input = rows.reduce((n, r) => n + r.inTokens, 0)
  const cached = rows.reduce((n, r) => n + r.cached, 0)
  const top = rows.reduce<(typeof rows)[number] | null>((m, r) => (!m || r.usd > m.usd ? r : m), null)
  return {
    rows, totalUsd, cacheHit: input > 0 ? cached / input : 0,
    biggest: top && top.usd > 0 ? { agent: top.agent, usd: top.usd, share: totalUsd > 0 ? top.usd / totalUsd : 0 } : null,
  }
}
