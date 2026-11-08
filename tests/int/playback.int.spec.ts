import { describe, expect, it } from 'vitest'
import { parseRange, resolveMaster } from '@/media/playback'

describe('playback helpers', () => {
  it('only resolves files inside the episode folder', () => {
    expect(resolveMaster('/data/ep/7', 'out/master.mp4')).toBe('/data/ep/7/out/master.mp4')
    expect(resolveMaster('/data/ep/7', '../8/out/master.mp4')).toBeNull()
    expect(resolveMaster('/data/ep/7', '/etc/passwd')).toBeNull()
    expect(resolveMaster('/data/ep/7', '..')).toBeNull()
    expect(resolveMaster('/data/ep/7', '')).toBeNull()
    expect(resolveMaster('/data/ep/7', undefined)).toBeNull()
  })

  it('parses the byte ranges browsers send when seeking', () => {
    expect(parseRange(null, 1000)).toBeNull()
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid')
    expect(parseRange('bytes=50-10', 1000)).toBe('invalid')
    expect(parseRange('bytes=-', 1000)).toBe('invalid')
    expect(parseRange('items=0-1', 1000)).toBe('invalid')
  })
})
