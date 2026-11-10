/** Thrown when the next paid call would pass the series cost cap or the episode ceiling. The episode stops and needs a human: there is no cheaper way to make a shot. */
export class BudgetError extends Error {
  constructor(message = 'Cost cap reached.') { super(message) }
}

/** Thrown when a check says the content itself is not allowed (moderation, policy). The episode stops for a human and spends nothing more. */
export class PolicyError extends Error {
  constructor(message: string) { super(message) }
}

/** Thrown when a character keeps drifting (or an undeclared character keeps appearing) after the allowed retries. */
export class ContinuityError extends Error {
  constructor(message: string, public shot: number, public character: string) { super(message) }
}

/** Money an agent had already spent when it failed part-way (paid clips, images). The orchestrator still books it, so a failed episode never hides what it cost. */
export function withSpend<E extends Error>(e: E, usd: number, videoSeconds = 0): E {
  const x = e as E & { spentUsd?: number; spentVideoSec?: number }
  x.spentUsd = (x.spentUsd ?? 0) + usd
  x.spentVideoSec = (x.spentVideoSec ?? 0) + videoSeconds
  return e
}
export const spentOf = (e: unknown): { usd: number; videoSeconds: number } => ({ usd: (e as { spentUsd?: number })?.spentUsd ?? 0, videoSeconds: (e as { spentVideoSec?: number })?.spentVideoSec ?? 0 })
