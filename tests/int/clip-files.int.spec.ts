import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { keepFullLength, reusableFile } from '@/pipeline/clip-files'
import { lastFrameTime, makeContactSheet, saveApprovedFrame } from '@/pipeline/continuity'
import { produceVideoShots, type ShotJob } from '@/pipeline/video-shots'
import { probe, run, runCapture } from '@/engine/ffmpeg'
import type { ClipRequest, ClipResult, LipsyncRequest, LipsyncResult } from '@/providers/video'
import type { CastRef } from '@/pipeline/continuity'

let root = ''
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-files-')) })
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

/** A real video of one colour: like a clip from the video model (silent) or from the lip-sync model (with the line as sound). */
async function video(file: string, colour: string, seconds: number, withAudio = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=180x320:r=24:d=${seconds}`,
    ...(withAudio ? ['-f', 'lavfi', '-i', `sine=frequency=300:duration=${seconds}`, '-c:a', 'aac', '-shortest'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file])
}
/** The colour of the middle of the frame at `t` seconds: [r, g, b]. */
async function colourAt(file: string, t: number): Promise<number[]> {
  const { stdout } = await runCapture(['-v', 'error', '-ss', String(t), '-i', file, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [...stdout]
}
const isRed = (c: number[]) => c[0] > 200 && c[1] < 80 && c[2] < 80
const isBlue = (c: number[]) => c[2] > 200 && c[0] < 80 && c[1] < 80

describe('keepFullLength: a lip-synced clip is only as long as the line', () => {
  it('appends the rest of the original, so the shot keeps its full length and has no frozen end', async () => {
    const dir = path.join(root, 'a')
    await video(path.join(dir, 'orig.mp4'), 'blue', 5)
    await video(path.join(dir, 'lip.mp4'), 'red', 1.75, true) // the model returned 1.75 s: the length of the line
    const out = await keepFullLength(path.join(dir, 'lip.mp4'), path.join(dir, 'orig.mp4'), path.join(dir, 'full.mp4'))
    expect(out).toBe(path.join(dir, 'full.mp4'))
    const p = await probe(out)
    expect(p.videoSec).toBeGreaterThan(4.9); expect(p.videoSec).toBeLessThan(5.15)
    expect(p.width).toBe(180); expect(p.height).toBe(320)
    expect(isRed(await colourAt(out, 0.8))).toBe(true) // the lip-synced part comes first
    expect(isBlue(await colourAt(out, 3))).toBe(true) // then the original, in step with it
    expect(isBlue(await colourAt(out, 4.8))).toBe(true) // and it runs to the end: nothing is held or frozen
  })

  it('leaves a clip alone when it is already as long as the original, and when a file cannot be read', async () => {
    const dir = path.join(root, 'b')
    await video(path.join(dir, 'orig.mp4'), 'blue', 3)
    await video(path.join(dir, 'lip.mp4'), 'red', 3, true)
    expect(await keepFullLength(path.join(dir, 'lip.mp4'), path.join(dir, 'orig.mp4'), path.join(dir, 'full.mp4'))).toBe(path.join(dir, 'lip.mp4'))
    expect(fs.existsSync(path.join(dir, 'full.mp4'))).toBe(false)
    expect(await keepFullLength('/nope/lip.mp4', '/nope/orig.mp4', path.join(dir, 'x.mp4'))).toBe('/nope/lip.mp4')
  })
})

describe('sampling a short clip (the error of episode 38)', () => {
  it('does not fail when the reel uses more of a clip than it has: frames past the end are taken at its last frame', async () => {
    const dir = path.join(root, 'c')
    await video(path.join(dir, 'short.mp4'), 'red', 1.75)
    const sheet = await makeContactSheet(path.join(dir, 'short.mp4'), path.join(dir, 'sheet.jpg'), 3) // 3 s asked, 1.75 s there
    expect(fs.statSync(sheet).size).toBeGreaterThan(500)
    const frame = await saveApprovedFrame(path.join(dir, 'lib'), 'Mango', path.join(dir, 'short.mp4'), 2.5)
    expect(fs.statSync(frame).size).toBeGreaterThan(500)
  })

  it('knows the last frame worth sampling, and does not clamp what it cannot read', async () => {
    const dir = path.join(root, 'd')
    await video(path.join(dir, 'five.mp4'), 'red', 5)
    const t = await lastFrameTime(path.join(dir, 'five.mp4'))
    expect(t).toBeGreaterThan(4.7); expect(t).toBeLessThan(5)
    expect(await lastFrameTime('/nope.mp4')).toBe(Infinity)
  })
})

describe('reusableFile: what an earlier attempt already made', () => {
  it('is reused only when it is readable and newer than what it was made from', async () => {
    const dir = path.join(root, 'e')
    await video(path.join(dir, 'clip.mp4'), 'red', 2)
    fs.writeFileSync(path.join(dir, 'key.png'), 'x')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(path.join(dir, 'key.png'), old, old) // the keyframe is older than the clip
    expect(await reusableFile(path.join(dir, 'clip.mp4'), [path.join(dir, 'key.png')])).toBe(true)
    const future = new Date(Date.now() + 60_000)
    fs.utimesSync(path.join(dir, 'key.png'), future, future) // the keyframe was made again after the clip
    expect(await reusableFile(path.join(dir, 'clip.mp4'), [path.join(dir, 'key.png')])).toBe(false)
    expect(await reusableFile(path.join(dir, 'missing.mp4'), [])).toBe(false)
    fs.writeFileSync(path.join(dir, 'broken.mp4'), 'not a video')
    expect(await reusableFile(path.join(dir, 'broken.mp4'), [])).toBe(false)
  })
})

describe('produceVideoShots with a lip-sync model that returns a short clip', () => {
  const M = 'kling-2.5-turbo' as const
  const mango: CastRef = { name: 'Mango', reference: '/tmp/mango.png', main: true }
  const dir = () => fs.mkdtempSync(path.join(root, 'p-'))

  /** A clip maker and a lip-sync model that behave like the real ones: 5 s clips; lip-sync returns only the length of the line. */
  const fakes = (workDir: string) => {
    const make = vi.fn(async (r: ClipRequest): Promise<ClipResult> => { await video(r.destFile, 'blue', 5); return { file: r.destFile, seconds: 5, costUsd: 0.35, model: M, remoteUrl: 'x' } })
    const lipsync = vi.fn(async (r: LipsyncRequest): Promise<LipsyncResult> => { await video(r.destFile, 'red', 1.75, true); return { file: r.destFile, costUsd: 0.25, model: 'sync-lipsync-v2' } })
    void workDir
    return { make, lipsync }
  }
  const job = (workDir: string): ShotJob => {
    const keyframe = path.join(workDir, 'kf.png'); fs.mkdirSync(workDir, { recursive: true }); fs.writeFileSync(keyframe, 'k')
    const line = path.join(workDir, 'line.wav'); fs.writeFileSync(line, 'w')
    const old = new Date(Date.now() - 60_000); fs.utimesSync(keyframe, old, old); fs.utimesSync(line, old, old)
    return { n: 1, videoSeconds: 5, durationSec: 3, motionPrompt: 'Mango waves', keyframe, speech: { file: line }, cast: [mango] }
  }

  it('gives the check and the reel a clip of the full length, and the check can sample the whole shot', async () => {
    const workDir = dir(); const { make, lipsync } = fakes(workDir)
    const seen: number[] = []
    const check = vi.fn(async (clip: string, j: ShotJob) => {
      seen.push((await probe(clip)).videoSec)
      await makeContactSheet(clip, path.join(workDir, 'sheet.jpg'), j.durationSec) // this is what failed before: 3 s of a 1.75 s clip
      return { verdict: { ok: true, worst: null, issues: [], undeclared: [] }, result: { characters: [], undeclaredCharacters: [], costUsd: 0 }, costUsd: 0 }
    })
    const r = await produceVideoShots({ model: M, workDir, allowanceSec: 100, shots: [job(workDir)], make, lipsync, check, concurrency: 1 })
    expect(seen[0]).toBeGreaterThan(4.9)
    expect(r.clips[0].status).toBe('generated')
    expect((await probe(r.files[1])).videoSec).toBeGreaterThan(4.9)
    expect(path.basename(r.files[1])).toBe('shot-1-a1-full.mp4')
    expect(r.totalCostUsd).toBeCloseTo(0.6, 2) // the clip and the lip-sync, once each
  })

  it('on a retry, uses the clip and the lip-sync result the failed attempt left, and pays for neither again', async () => {
    const workDir = dir(); const first = fakes(workDir); const j = job(workDir)
    await produceVideoShots({ model: M, workDir, allowanceSec: 100, shots: [j], make: first.make, lipsync: first.lipsync, concurrency: 1 })
    const again = fakes(workDir)
    const r = await produceVideoShots({ model: M, workDir, allowanceSec: 100, shots: [j], make: again.make, lipsync: again.lipsync, reuseExisting: true, concurrency: 1 })
    expect(again.make).not.toHaveBeenCalled()
    expect(again.lipsync).not.toHaveBeenCalled()
    expect(r.totalCostUsd).toBe(0)
    expect(r.totalSeconds).toBe(0) // nothing new was made, so no video seconds are used
    expect((await probe(r.files[1])).videoSec).toBeGreaterThan(4.9) // and the short lip-synced clip is still made full length
  })

  it('without the retry flag it makes them again, and it makes a clip again when its keyframe is newer', async () => {
    const workDir = dir(); const first = fakes(workDir); const j = job(workDir)
    await produceVideoShots({ model: M, workDir, allowanceSec: 100, shots: [j], make: first.make, lipsync: first.lipsync, concurrency: 1 })
    const plain = fakes(workDir)
    await produceVideoShots({ model: M, workDir, allowanceSec: 100, shots: [j], make: plain.make, lipsync: plain.lipsync, concurrency: 1 })
    expect(plain.make).toHaveBeenCalledTimes(1)
    const future = new Date(Date.now() + 60_000); fs.utimesSync(j.keyframe, future, future) // the keyframe was made again
    const stale = fakes(workDir)
    await produceVideoShots({ model: M, workDir, allowanceSec: 100, shots: [j], make: stale.make, lipsync: stale.lipsync, reuseExisting: true, concurrency: 1 })
    expect(stale.make).toHaveBeenCalledTimes(1)
  })
})
