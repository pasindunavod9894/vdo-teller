import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { aspectSlug, isAspect, isWide, sizeFor, videoResolution } from '@/engine/aspect'
import { probe, run } from '@/engine/ffmpeg'
import { renderExport } from '@/pipeline/exports'

afterEach(() => { delete process.env.VIDEO_RESOLUTION })

describe('aspect ratios and resolution', () => {
  it('sizes every aspect at 720p (the default) and 1080p with even numbers', () => {
    expect(videoResolution()).toBe('720p')
    expect(sizeFor('9:16')).toEqual({ width: 720, height: 1280 })
    expect(sizeFor('16:9')).toEqual({ width: 1280, height: 720 })
    expect(sizeFor('1:1')).toEqual({ width: 720, height: 720 })
    expect(sizeFor('4:5')).toEqual({ width: 720, height: 900 })
    expect(sizeFor('9:16', '1080p')).toEqual({ width: 1080, height: 1920 })
    expect(sizeFor('16:9', '1080p')).toEqual({ width: 1920, height: 1080 })
    for (const a of ['9:16', '16:9', '1:1', '4:5'] as const) for (const r of ['720p', '1080p'] as const) {
      const s = sizeFor(a, r); expect(s.width % 2).toBe(0); expect(s.height % 2).toBe(0)
    }
  })

  it('switches everything to 1080p with one setting', () => {
    process.env.VIDEO_RESOLUTION = '1080p'
    expect(videoResolution()).toBe('1080p')
    expect(sizeFor('9:16')).toEqual({ width: 1080, height: 1920 })
    process.env.VIDEO_RESOLUTION = 'nonsense'
    expect(videoResolution()).toBe('720p')
  })

  it('knows the aspect names and which frames are wider than the vertical master', () => {
    expect(isAspect('16:9')).toBe(true); expect(isAspect('2:1')).toBe(false)
    expect(aspectSlug('16:9')).toBe('16x9')
    expect(isWide(720, 1280)).toBe(false)
    expect(isWide(720, 900)).toBe(true)
    expect(isWide(1280, 720)).toBe(true)
  })
})

describe('exports from the master', () => {
  let dir: string
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exports-'))
    fs.mkdirSync(path.join(dir, 'out'))
    await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(dir, 'out', 'master.mp4')])
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('copies the master for its own aspect', async () => {
    const rel = await renderExport({ episodeDir: dir, aspect: '9:16', master: 'out/master.mp4' })
    expect(rel).toBe(path.join('out', 'export-9x16.mp4'))
    expect(fs.statSync(path.join(dir, rel)).size).toBe(fs.statSync(path.join(dir, 'out', 'master.mp4')).size)
  })

  it.each([['16:9', 1280, 720], ['1:1', 720, 720], ['4:5', 720, 900]] as const)('makes %s with the master whole over a blurred fill, same length, audio kept', async (aspect, w, h) => {
    const rel = await renderExport({ episodeDir: dir, aspect, master: 'out/master.mp4' })
    const p = await probe(path.join(dir, rel))
    expect([p.width, p.height]).toEqual([w, h])
    expect(Math.abs(p.durationSec - 2)).toBeLessThan(0.15)
    expect(p.hasAudio).toBe(true)
  }, 60_000)

  it('says clearly when there is no master', async () => {
    await expect(renderExport({ episodeDir: dir, aspect: '16:9', master: 'out/missing.mp4' })).rejects.toThrow(/no master/)
  })
})
