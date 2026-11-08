/** The most one episode may cost, by tier and length (plan §3b "per-episode ceiling"). EPISODE_COST_CAP_USD overrides it. */
const BASE_USD = { budget: 1.5, standard: 3, premium: 5 } as const

export function episodeCeilingUsd(tier: string, durationSec: number, env: Record<string, string | undefined> = process.env): number {
  const forced = Number(env.EPISODE_COST_CAP_USD)
  if (env.EPISODE_COST_CAP_USD && Number.isFinite(forced) && forced > 0) return forced
  const base = BASE_USD[tier as keyof typeof BASE_USD] ?? BASE_USD.standard
  // longer episodes cost more (more shots, voice and clips): scale from the 45 s reel, never below it
  return Math.round(base * Math.max(1, durationSec / 45) * 100) / 100
}
