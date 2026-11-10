import fs from 'node:fs'
import { probe, run as ffmpeg } from './ffmpeg'


export type Loudness = { integrated: number; truePeak: number }

/** Duration in seconds of the video stream of a file. */
export async function videoSeconds(file: string): Promise<number> {
  const d = (await probe(file)).videoSec
  if (!(d > 0)) throw new Error('Could not read the video duration')
  return d
}

/** Measures integrated loudness (LUFS) and true peak (dBTP) with the EBU R128 filter. */
export async function measureLoudness(file: string): Promise<Loudness> {
  const log = await ffmpeg(['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
  const summary = log.slice(log.lastIndexOf('Summary:'))
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(summary)
  const p = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)
  if (!i) throw new Error('Could not read loudness')
  return { integrated: Number(i[1]), truePeak: p ? Number(p[1]) : 0 }
}

/**
 * Normalises the audio to the social-video target (-14 LUFS, true peak <= -1.5 dB) in place; video is copied untouched.
 * Real two-pass loudnorm: pass 1 measures the file, pass 2 applies exactly the gain needed (linear mode), so the
 * result lands on target instead of being an approximation.
 */
export async function normalizeLoudness(file: string, target = -14): Promise<{ before: Loudness; after: Loudness }> {
  const before = await measureLoudness(file)
  const base = `loudnorm=I=${target}:TP=-1.5:LRA=11`
  const log = await ffmpeg(['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `${base}:print_format=json`, '-f', 'null', '-'])
  const json = log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1)
  const m = JSON.parse(json) as Record<string, string>
  const pass2 = `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  const tmp = `${file}.norm.mp4`
  // the loudnorm filter flushes a little padding at the end; pin the output to the video's own length so no silent tail remains
  const seconds = await videoSeconds(file)
  await ffmpeg(['-y', '-v', 'error', '-i', file, '-c:v', 'copy', '-af', pass2, '-c:a', 'aac', '-b:a', '192k', '-t', seconds.toFixed(3), tmp])
  fs.renameSync(tmp, file)
  return { before, after: await measureLoudness(file) }
}
