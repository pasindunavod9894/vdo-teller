import fs from 'node:fs'
import path from 'node:path'
import { run } from '../engine/ffmpeg'
import { probeDuration } from '../providers/video/fal'
import type { Word } from '../engine/transcribe'
import { colourFor, placeholderPng } from './placeholder'
import type { MediaServices, SpeechSpec } from './types'
import { hashOf, safeName } from './workspace'

/** Free stand-ins: they cost nothing and make the whole pipeline (assembly, stitch, playback, cost tracking) testable. */
export const SECONDS_PER_WORD = 0.42

/** Even word timing for a line spoken over `seconds` (clip-relative). */
export function evenWords(text: string, seconds: number): Word[] {
  const words = text.split(/\s+/).filter(Boolean)
  const per = seconds / Math.max(1, words.length)
  return words.map((w, i) => ({ text: w, startSec: i * per, endSec: (i + 1) * per * 0.92 }))
}

export function createMockMedia(opts: { assetsDir: string; libraryDir: string; width?: number; height?: number }): MediaServices {
  const W = opts.width ?? 720, H = opts.height ?? 1280
  return {
    provider: 'mock',
    assetsDir: opts.assetsDir,

    async plate({ key }) {
      const name = `plate-${safeName(key)}.png`
      const lib = path.join(opts.libraryDir, name)
      const cached = fs.existsSync(lib)
      if (!cached) await placeholderPng(lib, { width: W, height: H, colour: colourFor(key, 0.6), shape: 'scene' })
      fs.copyFileSync(lib, path.join(opts.assetsDir, name))
      return { file: name, costUsd: 0, cached }
    },

    async keyframe({ key, references }) {
      const name = `keyframe-${safeName(key)}.png`
      // the colour follows the references, so a shot with the same characters on the same plate looks related
      await placeholderPng(path.join(opts.assetsDir, name), { width: W, height: H, colour: colourFor(references.join('|') || key, 0.58), shape: 'character' })
      return { file: name, costUsd: 0 }
    },

    async reference({ key }) {
      const name = `ref-${safeName(key)}.png`
      const lib = path.join(opts.libraryDir, name)
      const cached = fs.existsSync(lib)
      if (!cached) await placeholderPng(lib, { width: 512, height: 512, colour: colourFor(key), shape: 'face', variant: 1 })
      fs.copyFileSync(lib, path.join(opts.assetsDir, name))
      return { file: name, costUsd: 0, cached }
    },

    async speech(spec: SpeechSpec) {
      const id = hashOf(spec.voice, spec.instructions ?? '', spec.text)
      const name = `speech-${safeName(spec.name)}-${id}.wav`
      const dest = path.join(opts.assetsDir, name)
      const nWords = spec.text.split(/\s+/).filter(Boolean).length
      const seconds = Math.max(1.2, Math.round(nWords * SECONDS_PER_WORD * 100) / 100)
      if (!fs.existsSync(dest)) {
        // a tone whose loudness pulses like syllables (about 4 per second)
        const hz = 140 + (parseInt(id.slice(0, 2), 16) % 120)
        await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`, '-af', 'tremolo=f=4:d=0.9,volume=0.35', '-ar', '24000', '-ac', '1', dest])
      }
      return { file: name, seconds: await probeDuration(dest), words: evenWords(spec.text, seconds), costUsd: 0 }
    },

    async gate() {
      return { pass: true, notes: 'mock: not checked', costUsd: 0 }
    },

    async reelQa() {
      return { flags: [], costUsd: 0 }
    },

    async continuity({ characters }) {
      return { characters: characters.map((c) => ({ name: c.name, sameIdentity: 1, driftStartSec: null, issues: [] })), undeclaredCharacters: [], costUsd: 0 }
    },
  }
}
