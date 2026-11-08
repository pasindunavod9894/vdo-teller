import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { measureLoudness, normalizeLoudness, videoSeconds } from '@/engine/finish'

let dir = ''
const streamSeconds = (file: string, kind: 'v:0' | 'a:0') =>
  parseFloat(spawnSync('ffprobe', ['-v', 'error', '-select_streams', kind, '-show_entries', 'stream=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim())

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-')) })

/** A short video with a quiet tone, like our raw renders (which come out far below -14 LUFS). */
function quietVideo(name: string, sec: number) {
  const f = path.join(dir, name)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=128x128:r=30:d=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=300:duration=${sec},volume=0.05`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f])
  return f
}

describe('normalizeLoudness', () => {
  it('brings a quiet video to about -14 LUFS without a true peak above the limit', async () => {
    const f = quietVideo('a.mp4', 6)
    const before = await measureLoudness(f)
    expect(before.integrated).toBeLessThan(-25)
    const r = await normalizeLoudness(f)
    expect(Math.abs(r.after.integrated - -14)).toBeLessThan(1.2)
    expect(r.after.truePeak).toBeLessThan(-0.5)
  }, 60000)

  it('works on a file built the way the chunked renderer builds it (joined chunks + separate audio)', async () => {
    // two silent video chunks joined with the concat demuxer (-c copy), then muxed with a separately mixed audio track
    const c1 = path.join(dir, 'c1.mp4'), c2 = path.join(dir, 'c2.mp4')
    for (const c of [c1, c2]) execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=128x128:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', c])
    const list = path.join(dir, 'list.txt')
    fs.writeFileSync(list, `file '${c1}'\nfile '${c2}'\n`)
    const joined = path.join(dir, 'joined.mp4'), wav = path.join(dir, 'a.wav'), out = path.join(dir, 'muxed.mp4')
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined])
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6,volume=0.05', '-ar', '48000', wav])
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', joined, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-t', '6.000', out])
    expect(await videoSeconds(out)).toBeCloseTo(6, 1)
    await normalizeLoudness(out)
    expect(streamSeconds(out, 'a:0') - streamSeconds(out, 'v:0')).toBeLessThan(0.03)
  }, 60000)

  it('leaves no silent tail: the audio is not longer than the video (regression: 0.1 s overhang)', async () => {
    const f = quietVideo('b.mp4', 10)
    await normalizeLoudness(f)
    const v = streamSeconds(f, 'v:0'), a = streamSeconds(f, 'a:0')
    expect(a - v).toBeLessThan(0.03)
    expect(await videoSeconds(f)).toBeCloseTo(v, 2)
  }, 60000)
})
