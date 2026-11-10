import { describe, expect, it } from 'vitest'
import { dailyCapUsd, DAILY_VIDEO_LIMIT, DAY_MS, dailyState, formatCountdown } from '@/lib/daily-limit'

const now = new Date('2026-11-09T12:00:00Z')
const ago = (h: number) => new Date(now.getTime() - h * 3600_000)

describe('daily video limit', () => {
  it('is three videos in any 24 hours', () => {
    expect(DAILY_VIDEO_LIMIT).toBe(3)
    expect(dailyState([], now)).toEqual({ used: 0, limit: 3, left: 3, nextAt: null })
  })

  it('counts only the last 24 hours and says how many are left', () => {
    expect(dailyState([ago(1), ago(5), ago(30)], now)).toMatchObject({ used: 2, left: 1, nextAt: null })
  })

  it('when all three are used, the next one is available when the oldest of them is 24 hours old', () => {
    const s = dailyState([ago(20), ago(10), ago(2)], now)
    expect(s).toMatchObject({ used: 3, left: 0 })
    expect(s.nextAt!.getTime()).toBe(ago(20).getTime() + DAY_MS) // in 4 hours
    expect(s.nextAt!.getTime() - now.getTime()).toBe(4 * 3600_000)
  })

  it('uses the right slot when more than three were made in the window', () => {
    // 4 recent episodes (limit already exceeded by older rules): the slot that frees first is the 2nd oldest
    const s = dailyState([ago(23), ago(20), ago(10), ago(2)], now)
    expect(s.left).toBe(0)
    expect(s.nextAt!.getTime()).toBe(ago(20).getTime() + DAY_MS)
  })

  it('a video made exactly 24 hours ago no longer counts', () => {
    expect(dailyState([ago(24), ago(1)], now).used).toBe(1)
  })

  it('formats a countdown', () => {
    expect(formatCountdown(4 * 3600_000 + 12 * 60_000 + 5_000)).toBe('4h 12m 5s')
    expect(formatCountdown(65_000)).toBe('1m 5s')
    expect(formatCountdown(-5)).toBe('0m 0s')
    expect(formatCountdown(2 * 86400_000 + 3 * 3600_000)).toBe('2d 3h 0m')
  })

  it('has a spending limit per day that can be set, and defaults to 15', () => {
    expect(dailyCapUsd({})).toBe(15)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: '8' })).toBe(8)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: '' })).toBe(15)
    expect(dailyCapUsd({ DAILY_COST_CAP_USD: '-1' })).toBe(15)
  })
})
