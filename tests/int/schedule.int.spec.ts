import { describe, expect, it } from 'vitest'
import { formatCountdown, INTERVAL_MS, nextState } from '@/lib/schedule'

const t0 = new Date('2026-11-08T10:00:00Z')

describe('next episode schedule', () => {
  it('first episode is due immediately when there is no episode yet', () => {
    expect(nextState('daily', null, t0)).toEqual({ state: 'first', at: null, remainingMs: 0 })
  })
  it('locks until one interval after the last episode', () => {
    const s = nextState('daily', t0, new Date(t0.getTime() + 6 * 3600_000))
    expect(s.state).toBe('locked')
    expect(s.remainingMs).toBe(18 * 3600_000)
  })
  it('becomes ready exactly at and after the interval', () => {
    expect(nextState('every-2-days', t0, new Date(t0.getTime() + INTERVAL_MS['every-2-days'])).state).toBe('ready')
    expect(nextState('weekly', t0, new Date(t0.getTime() + 8 * 24 * 3600_000)).state).toBe('ready')
  })
  it('3-per-week is a third of a week', () => {
    expect(INTERVAL_MS['3-per-week']).toBe(Math.round((7 * 24 * 3600_000) / 3))
  })
  it('formats countdowns', () => {
    expect(formatCountdown(0)).toBe('0m 0s')
    expect(formatCountdown(90 * 1000)).toBe('1m 30s')
    expect(formatCountdown(3 * 3600_000 + 5 * 60_000 + 7000)).toBe('3h 5m 7s')
    expect(formatCountdown(26 * 3600_000)).toBe('1d 2h 0m')
  })
})
