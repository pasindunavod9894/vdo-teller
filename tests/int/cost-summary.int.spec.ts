import { describe, expect, it } from 'vitest'
import { summarizeCosts } from '@/lib/cost-summary'

describe('cost summary', () => {
  it('totals the cost, finds the biggest step and the prompt cache hit rate, and hides empty steps', () => {
    const s = summarizeCosts([
      { agent: 'Planning' },
      { agent: 'Writer', model: 'gpt-5', inputTokens: 1000, cachedTokens: 500, outputTokens: 800, costUsd: 0.01 },
      { agent: 'Critic', model: 'gpt-5-nano', inputTokens: 1000, cachedTokens: 0, outputTokens: 100, costUsd: 0.0001 },
      { agent: 'Animator', imageCount: 0, videoSeconds: 10, costUsd: 0.7 },
    ])
    expect(s.rows.map((r) => r.agent)).toEqual(['Writer', 'Critic', 'Animator'])
    expect(s.totalUsd).toBeCloseTo(0.7101, 4)
    expect(s.cacheHit).toBeCloseTo(0.25, 5)
    expect(s.biggest!.agent).toBe('Animator')
    expect(s.biggest!.share).toBeGreaterThan(0.98)
  })
  it('an episode with no spend has no rows and no biggest step', () => {
    expect(summarizeCosts([{ agent: 'A', costUsd: 0 }])).toMatchObject({ rows: [], totalUsd: 0, cacheHit: 0, biggest: null })
    expect(summarizeCosts([])).toMatchObject({ rows: [], biggest: null })
  })
})
