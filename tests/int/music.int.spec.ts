import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureMusic, loopSeconds, MOODS, moodFor, MUSIC_SAMPLE_RATE, synthMusic, wavBytes } from '@/engine/music'
import { probeDuration } from '@/providers/video/fal'

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)

describe('music', () => {
  for (const mood of MOODS) {
    it(`${mood}: whole bars long, audible, never clipping, and the same every time`, () => {
      const a = synthMusic(mood)
      expect(a.length).toBe(Math.round(loopSeconds(mood) * MUSIC_SAMPLE_RATE))
      expect(loopSeconds(mood)).toBeGreaterThan(10)
      const peak = a.reduce((m, x) => Math.max(m, Math.abs(x)), 0)
      expect(peak).toBeLessThanOrEqual(0.8001)
      expect(peak).toBeGreaterThan(0.5)
      expect(rms(a)).toBeGreaterThan(0.03) // not silence
      expect(Array.from(a.slice(1000, 1100))).toEqual(Array.from(synthMusic(mood).slice(1000, 1100)))
      // ends where it starts (loop without a click)
      expect(Math.abs(a[0])).toBeLessThan(0.01)
      expect(Math.abs(a[a.length - 1])).toBeLessThan(0.01)
    })
  }

  it('the moods sound different', () => {
    const a = synthMusic('playful'), b = synthMusic('tense')
    let diff = 0
    for (let i = 0; i < 20000; i++) diff += Math.abs(a[i + 5000] - b[i + 5000])
    expect(diff).toBeGreaterThan(100)
  })

  it('writes a valid WAV file once and ffprobe reads its length', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-'))
    const name = ensureMusic('calm', dir)
    expect(name).toBe('music-calm.wav')
    const stat = fs.statSync(path.join(dir, name)).mtimeMs
    ensureMusic('calm', dir)
    expect(fs.statSync(path.join(dir, name)).mtimeMs).toBe(stat) // not rewritten
    expect(await probeDuration(path.join(dir, name))).toBeCloseTo(loopSeconds('calm'), 1)
    expect(wavBytes(new Float32Array(10)).length).toBe(44 + 20)
  })

  it('picks a mood from the niche', () => {
    expect(moodFor('Horror stories')).toBe('tense')
    expect(moodFor('Kids bedtime stories')).toBe('calm')
    expect(moodFor('Football', 'highlights')).toBe('upbeat')
    expect(moodFor('Cat videos', 'funny cats')).toBe('playful')
    expect(moodFor(undefined, null)).toBe('playful')
  })
})
