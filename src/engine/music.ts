import fs from 'node:fs'
import path from 'node:path'

/**
 * Background music made in code (no downloads, no licences): short, loop-ready instrumentals in four moods. They are plain
 * on purpose (bass, pads, plucks, soft percussion) and stand in until a licensed music library is added; the track names
 * and the `ensureMusic` call stay the same, so swapping them is a drop-in change.
 */
export const MOODS = ['playful', 'calm', 'tense', 'upbeat'] as const
export type Mood = (typeof MOODS)[number]
export const MUSIC_SAMPLE_RATE = 32000

type Ev = { t: number; freq: number; dur: number; amp: number; kind: 'pluck' | 'pad' | 'bass' | 'thud' | 'hat' }

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)

/** Deterministic pseudo-random numbers, so the same mood always sounds the same. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

type Spec = { bpm: number; bars: number; events: (beat: number) => Ev[] }

const PENTA = [0, 2, 4, 7, 9]
const pick = (scale: number[], root: number, i: number) => root + scale[i % scale.length] + 12 * Math.floor(i / scale.length)

const SPECS: Record<Mood, Spec> = {
  playful: {
    bpm: 120, bars: 8,
    events: (beat) => {
      const roots = [48, 45, 41, 43] // C A F G
      const ev: Ev[] = []
      const r = rng(11)
      const motif = Array.from({ length: 16 }, () => (r() < 0.25 ? -1 : Math.floor(r() * 8)))
      for (let bar = 0; bar < 8; bar++) {
        const root = roots[bar % 4]
        for (let b = 0; b < 4; b++) ev.push({ t: (bar * 4 + b) * beat, freq: midi(root + (b % 2 ? 7 : 0)), dur: beat * 0.55, amp: 0.5, kind: 'bass' })
        for (let s = 0; s < 8; s++) {
          const n = motif[(bar % 2) * 8 + s]
          if (n >= 0) ev.push({ t: (bar * 4 + s / 2) * beat, freq: midi(pick(PENTA, 72, n)), dur: beat * 0.4, amp: 0.3, kind: 'pluck' })
          if (s % 2) ev.push({ t: (bar * 4 + s / 2) * beat, freq: 0, dur: 0.05, amp: 0.12, kind: 'hat' })
        }
      }
      return ev
    },
  },
  calm: {
    bpm: 72, bars: 8,
    events: (beat) => {
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] // Am F C G
      const ev: Ev[] = []
      for (let bar = 0; bar < 8; bar++) {
        const c = chords[bar % 4]
        for (const n of c) ev.push({ t: bar * 4 * beat, freq: midi(n), dur: beat * 4, amp: 0.2, kind: 'pad' })
        ev.push({ t: bar * 4 * beat, freq: midi(c[0] - 12), dur: beat * 4, amp: 0.3, kind: 'bass' })
        for (let b = 0; b < 4; b++) ev.push({ t: (bar * 4 + b) * beat + beat * 0.5, freq: midi(c[b % 3] + 12), dur: beat * 0.9, amp: 0.16, kind: 'pluck' })
      }
      return ev
    },
  },
  tense: {
    bpm: 90, bars: 8,
    events: (beat) => {
      const ev: Ev[] = []
      for (let bar = 0; bar < 8; bar++) {
        ev.push({ t: bar * 4 * beat, freq: midi(33), dur: beat * 4, amp: 0.4, kind: 'pad' }) // low A drone
        ev.push({ t: bar * 4 * beat, freq: midi(40), dur: beat * 4, amp: 0.2, kind: 'pad' })
        for (let b = 0; b < 4; b++) ev.push({ t: (bar * 4 + b) * beat, freq: 55, dur: 0.22, amp: b % 2 ? 0.35 : 0.6, kind: 'thud' }) // heartbeat
        if (bar % 2) { ev.push({ t: (bar * 4 + 3) * beat, freq: midi(69), dur: beat * 0.8, amp: 0.2, kind: 'pluck' }); ev.push({ t: (bar * 4 + 3) * beat, freq: midi(75), dur: beat * 0.8, amp: 0.15, kind: 'pluck' }) }
      }
      return ev
    },
  },
  upbeat: {
    bpm: 132, bars: 8,
    events: (beat) => {
      const roots = [43, 50, 52, 48] // G D E C
      const ev: Ev[] = []
      for (let bar = 0; bar < 8; bar++) {
        const root = roots[bar % 4]
        for (let s = 0; s < 8; s++) ev.push({ t: (bar * 4 + s / 2) * beat, freq: midi(root), dur: beat * 0.4, amp: 0.4, kind: 'bass' })
        for (let s = 0; s < 16; s++) ev.push({ t: (bar * 4 + s / 4) * beat, freq: midi(root + 24 + [0, 4, 7, 12][s % 4]), dur: beat * 0.22, amp: 0.2, kind: 'pluck' })
        for (let s = 0; s < 8; s++) ev.push({ t: (bar * 4 + s / 2) * beat, freq: 0, dur: 0.05, amp: s % 2 ? 0.16 : 0.07, kind: 'hat' })
      }
      return ev
    },
  },
}

export const loopSeconds = (mood: Mood) => { const s = SPECS[mood]; return (s.bars * 4 * 60) / s.bpm }

/** The samples of one loop of a mood (mono, -1..1, peak 0.8). Pure and deterministic. */
export function synthMusic(mood: Mood, sampleRate = MUSIC_SAMPLE_RATE): Float32Array {
  const spec = SPECS[mood]
  const beat = 60 / spec.bpm
  const total = Math.round(loopSeconds(mood) * sampleRate)
  const out = new Float32Array(total)
  const noise = rng(5)
  for (const e of spec.events(beat)) {
    const start = Math.round(e.t * sampleRate)
    const len = Math.min(Math.round((e.dur + 0.25) * sampleRate), total - start) // short release tail
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate
      let env: number
      let v: number
      switch (e.kind) {
        case 'pad': {
          env = Math.min(1, t / 0.35) * (t < e.dur ? 1 : Math.max(0, 1 - (t - e.dur) / 0.25))
          v = Math.sin(2 * Math.PI * e.freq * t) + 0.25 * Math.sin(4 * Math.PI * e.freq * t) + 0.1 * Math.sin(2 * Math.PI * e.freq * 1.005 * t)
          break
        }
        case 'bass': {
          env = Math.min(1, t / 0.01) * Math.exp(-t / (e.dur * 0.7)) * (t < e.dur ? 1 : Math.max(0, 1 - (t - e.dur) / 0.25))
          v = Math.sin(2 * Math.PI * e.freq * t) + 0.3 * Math.sin(4 * Math.PI * e.freq * t)
          break
        }
        case 'thud': {
          env = Math.exp(-t / 0.07)
          v = Math.sin(2 * Math.PI * e.freq * (1 - 0.3 * Math.min(1, t / 0.2)) * t)
          break
        }
        case 'hat': {
          env = Math.exp(-t / 0.018)
          v = noise() * 2 - 1
          break
        }
        default: { // pluck
          env = Math.min(1, t / 0.004) * Math.exp(-t / (e.dur * 0.5))
          v = Math.sin(2 * Math.PI * e.freq * t) + 0.35 * Math.sin(4 * Math.PI * e.freq * t) + 0.12 * Math.sin(6 * Math.PI * e.freq * t)
        }
      }
      out[start + i] += v * env * e.amp
    }
  }
  // loop-friendly: tiny fade at both ends, then normalise
  const fade = Math.round(0.01 * sampleRate)
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] *= g; out[total - 1 - i] *= g }
  let peak = 1e-6
  for (const s of out) peak = Math.max(peak, Math.abs(s))
  for (let i = 0; i < total; i++) out[i] = (out[i] / peak) * 0.8
  return out
}

/** 16-bit mono PCM WAV file bytes. */
export function wavBytes(samples: Float32Array, sampleRate = MUSIC_SAMPLE_RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(sampleRate, 24)
  head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** Writes `<dir>/music-<mood>.wav` unless it exists, and returns the file name. */
export function ensureMusic(mood: Mood, dir: string): string {
  const file = `music-${mood}.wav`
  const dest = path.join(dir, file)
  if (!fs.existsSync(dest)) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dest, wavBytes(synthMusic(mood))) }
  return file
}

/** Which mood suits a niche. Keyword based and deliberately simple; the default is playful. */
export function moodFor(...words: (string | undefined | null)[]): Mood {
  const text = words.filter(Boolean).join(' ').toLowerCase()
  if (/horror|scary|creep|crime|mystery|thriller|haunt|ghost|dark/.test(text)) return 'tense'
  if (/sleep|bedtime|relax|medit|calm|nature|asmr|lullaby|story time|gentle/.test(text)) return 'calm'
  if (/motivat|fitness|sport|football|soccer|workout|gaming|dance|hustle|success|energy/.test(text)) return 'upbeat'
  return 'playful'
}
