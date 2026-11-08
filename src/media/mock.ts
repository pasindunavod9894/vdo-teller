import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { probeDuration } from '../providers/video/fal'
import type { Word } from '../engine/transcribe'
import type { MediaServices, SpeechSpec } from './types'
import { hashOf, safeName } from './workspace'

/** Free stand-ins: they cost nothing and make the whole pipeline (render, stitch, playback, cost tracking) testable. */
const run = (args: string[]) => new Promise<void>((resolve, reject) => {
  const p = spawn('ffmpeg', args)
  let err = ''
  p.stderr.on('data', (c) => { err += c })
  p.on('error', reject)
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-200)}`))))
})

/** Deterministic colours from a key, so the same location always gets the same placeholder. */
function colours(key: string): [string, string] {
  const h = parseInt(hashOf(key).slice(0, 6), 16)
  const hue = h % 360
  return [`hsl(${hue},45%,62%)`, `hsl(${(hue + 40) % 360},50%,28%)`]
}

export const SECONDS_PER_WORD = 0.42

/** Even word timing for a line spoken over `seconds` (clip-relative). */
export function evenWords(text: string, seconds: number): Word[] {
  const words = text.split(/\s+/).filter(Boolean)
  const per = seconds / Math.max(1, words.length)
  return words.map((w, i) => ({ text: w, startSec: i * per, endSec: (i + 1) * per * 0.92 }))
}

export function createMockMedia(opts: { assetsDir: string; libraryDir: string }): MediaServices {
  return {
    provider: 'mock',
    assetsDir: opts.assetsDir,

    async plate({ key, prompt }) {
      const lib = path.join(opts.libraryDir, `plate-${safeName(key)}.png`)
      const name = `plate-${safeName(key)}.png`
      const cached = fs.existsSync(lib)
      if (!cached) {
        const [top, bottom] = colours(key)
        const label = key.replace(/[<>&]/g, '').slice(0, 28)
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect y="1050" width="1024" height="486" fill="rgba(0,0,0,0.22)"/><text x="512" y="260" font-size="54" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-family="Helvetica">${label}</text></svg>`
        await sharp(Buffer.from(svg)).png().toFile(lib)
      }
      fs.copyFileSync(lib, path.join(opts.assetsDir, name))
      void prompt
      return { file: name, costUsd: 0, cached }
    },

    async speech(spec: SpeechSpec) {
      const id = hashOf(spec.voice, spec.instructions ?? '', spec.text)
      const name = `speech-${safeName(spec.name)}-${id}.wav`
      const dest = path.join(opts.assetsDir, name)
      const nWords = spec.text.split(/\s+/).filter(Boolean).length
      const seconds = Math.max(1.2, Math.round(nWords * SECONDS_PER_WORD * 100) / 100)
      if (!fs.existsSync(dest)) {
        // a tone whose loudness pulses like syllables (about 4 per second), so lip-sync and head motion have a shape to follow
        const hz = 140 + (parseInt(id.slice(0, 2), 16) % 120)
        await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`, '-af', 'tremolo=f=4:d=0.9,volume=0.35', '-ar', '24000', '-ac', '1', dest])
      }
      return { file: name, seconds: await probeDuration(dest), words: evenWords(spec.text, seconds), costUsd: 0 }
    },

    async gate() {
      return { pass: true, notes: 'mock: not checked', costUsd: 0 }
    },
  }
}
