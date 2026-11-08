import { spawn } from 'node:child_process'
import fs from 'node:fs'

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr.on('data', (c) => { err += c })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed: ${err.slice(-300)}`))))
  })
}

export type Loudness = { integrated: number; truePeak: number }

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
  await ffmpeg(['-y', '-v', 'error', '-i', file, '-c:v', 'copy', '-af', pass2, '-c:a', 'aac', '-b:a', '192k', tmp])
  fs.renameSync(tmp, file)
  return { before, after: await measureLoudness(file) }
}
