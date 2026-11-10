/**
 * Runs `fn` over `items` with at most `limit` running at the same time (each item is its own paid request, so one item never waits
 * for another). When one fails no new item is started, the ones already running finish (they are already paid for), and the
 * failures come back sorted by item order so the caller reports the earliest one. With limit 1 this is a plain loop that stops at
 * the first failure.
 */
export type PoolFailure = { index: number; error: unknown }

export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<PoolFailure[]> {
  const failures: PoolFailure[] = []
  let next = 0
  const worker = async () => {
    while (failures.length === 0) {
      const index = next++
      if (index >= items.length) return
      try { await fn(items[index], index) } catch (error) { failures.push({ index, error }) }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.floor(limit), items.length)) }, worker))
  return failures.sort((a, b) => a.index - b.index)
}

/** A "how many at once" setting from the environment: a whole number from 1 to 8, otherwise the default. */
export function limitFrom(raw: string | undefined, fallback = 4): number {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : fallback
}

/** How many keyframes, plates, references and spoken lines are made at the same time (IMAGE_CONCURRENCY, default 4). */
export const imageConcurrency = (env: Record<string, string | undefined> = process.env) => limitFrom(env.IMAGE_CONCURRENCY)
