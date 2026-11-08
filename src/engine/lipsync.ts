import { spawn } from 'node:child_process'

/**
 * Lip-sync from audio loudness (no external binary). Each video frame gets a mouth shape from the speech energy:
 * 0 closed, 1 slightly open, 2 open, 3 wide. This is a simple envelope method, good enough for stylised characters;
 * a phoneme-based tool (Rhubarb) can replace it later for more accurate "ee/oh" shapes.
 */
export type MouthShape = 0 | 1 | 2 | 3
export type MouthKey = { atSec: number; shape: MouthShape }

/** Pure: RMS per frame -> mouth shapes with smoothing so the mouth does not flicker. */
export function mouthTrackFromRms(rms: number[], fps: number): MouthKey[] {
  if (!rms.length) return []
  const peak = Math.max(...rms, 1e-6)
  const norm = rms.map((r) => r / peak)
  // moving average over 3 frames to remove single-frame spikes
  const smooth = norm.map((_, i) => ((norm[i - 1] ?? norm[i]) + norm[i] + (norm[i + 1] ?? norm[i])) / 3)
  const shapeOf = (v: number): MouthShape => (v < 0.08 ? 0 : v < 0.25 ? 1 : v < 0.55 ? 2 : 3)
  const keys: MouthKey[] = []
  let last: MouthShape | -1 = -1
  let holdUntil = -1
  smooth.forEach((v, i) => {
    let s = shapeOf(v)
    // do not change shape faster than every 2 frames
    if (s !== last && i < holdUntil) s = last as MouthShape
    if (s !== last) { keys.push({ atSec: i / fps, shape: s }); last = s; holdUntil = i + 2 }
  })
  return keys
}

/** RMS energy per video frame of an audio file, decoded with FFmpeg to 16 kHz mono PCM. */
export async function rmsPerFrame(file: string, fps: number): Promise<number[]> {
  const sampleRate = 16000
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(sampleRate), '-'])
    const chunks: Buffer[] = []
    let err = ''
    p.stdout.on('data', (c) => chunks.push(c))
    p.stderr.on('data', (c) => { err += c })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg failed: ${err.slice(0, 200)}`))))
  })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
  const per = Math.round(sampleRate / fps)
  const out: number[] = []
  for (let i = 0; i < samples.length; i += per) {
    let sum = 0
    const end = Math.min(i + per, samples.length)
    for (let j = i; j < end; j++) sum += samples[j] * samples[j]
    out.push(Math.sqrt(sum / Math.max(1, end - i)))
  }
  return out
}

export async function mouthTrackFromFile(file: string, fps: number): Promise<MouthKey[]> {
  return mouthTrackFromRms(await rmsPerFrame(file, fps), fps)
}

/** Turns a mouth track into character `frames`: while speaking use the mouth images, otherwise the resting image. */
export function mouthFrames(track: MouthKey[], opts: { startSec: number; endSec: number; mouthSrc: [string, string, string, string]; restSrc: string }) {
  const frames: { atSec: number; src: string }[] = [{ atSec: 0, src: opts.restSrc }]
  for (const k of track) {
    const at = opts.startSec + k.atSec
    if (at >= opts.endSec) break
    frames.push({ atSec: at, src: opts.mouthSrc[k.shape] })
  }
  frames.push({ atSec: opts.endSec, src: opts.restSrc })
  return frames
}


/** Smoothed 0..1 loudness envelope per video frame, used to drive head nods and pulses while a character speaks. */
export function energyEnvelope(rms: number[]): number[] {
  if (!rms.length) return []
  const peak = Math.max(...rms, 1e-6)
  const norm = rms.map((r) => r / peak)
  // fast attack, slower release, so the head "hits" on syllables and settles between them
  const out: number[] = []
  let v = 0
  for (const n of norm) { v = n > v ? v + (n - v) * 0.6 : v + (n - v) * 0.2; out.push(Math.round(v * 100) / 100) }
  return out
}
