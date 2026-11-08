/* Phase 8 showcase: ONE 10-second video that uses everything the engine has built.
 *   0-5 s  the real Kling clip (walk) + a NARRATOR voice-over, captions with real word timing
 *   5-10 s engine close-up: steady-face lip-sync, blinks, head nods, a CHARACTER line, steam particles
 *   sound  synthesized effects (whoosh on the cut, steam hiss), loudness -14 LUFS, audio mixed once
 *   render in TWO chunks joined losslessly (8e); the same timeline is also rendered in one piece to prove they match
 * Cost: ~$0.01 (two speech lines + Whisper). Reuses render/proof/assets and render/live-kling.
 *   pnpm tsx --env-file=.env scripts/phase8-video.ts
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'
import { normalizeLoudness } from '../src/engine/finish'
import { energyEnvelope, mouthFrames, mouthTrackFromRms, rmsPerFrame } from '../src/engine/lipsync'
import { renderTimeline, renderTimelineChunked } from '../src/engine/render'
import { ensureSfx } from '../src/engine/sfx'
import type { TimelineInput } from '../src/engine/timeline'
import { alignToScript, transcribeWords, type Word } from '../src/engine/transcribe'

const root = path.resolve('render/phase8')
const assets = path.resolve('render/proof/assets')
fs.mkdirSync(root, { recursive: true })
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const fps = 30

const LINES = [
  { name: 'p8-narr', who: 'narrator', voice: 'fable', text: 'Chef Mango had a plan for the perfect noodles.', instructions: 'Warm, gentle storyteller, unhurried.' },
  { name: 'p8-line', who: 'mango', voice: 'coral', text: 'Three minutes. What could possibly go wrong?', instructions: 'Smug, playful, confident chef.' },
]
const dur = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(assets, f)]).toString().trim())

async function speech() {
  let spent = 0
  for (const l of LINES) {
    const f = path.join(assets, `${l.name}.wav`)
    if (!fs.existsSync(f)) {
      const r = await client.audio.speech.create({ model: 'gpt-4o-mini-tts', voice: l.voice, input: l.text, instructions: l.instructions, response_format: 'wav' })
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); spent += 0.005
    }
    const w = path.join(assets, `${l.name}.words.json`)
    if (!fs.existsSync(w)) { fs.writeFileSync(w, JSON.stringify(await transcribeWords(f, client))); spent += 0.001 }
  }
  console.log(`speech ready (new spend ~$${spent.toFixed(3)})`)
}

async function main() {
  const t0 = Date.now()
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing')
  for (const f of ['clip.mp4', 'scene-still.png']) if (!fs.existsSync(path.resolve('render/live-kling', f))) throw new Error(`Missing render/live-kling/${f}: run scripts/live-kling-test.ts --yes first`)
  fs.copyFileSync(path.resolve('render/live-kling/clip.mp4'), path.join(assets, 'clip-live.mp4'))
  fs.copyFileSync(path.resolve('render/live-kling/scene-still.png'), path.join(assets, 'scene-still-live.png'))
  await speech()
  const whoosh = await ensureSfx('whoosh', assets), hiss = await ensureSfx('steam-hiss', assets)

  // character line: steady-face lip-sync + head nods from the speech energy
  const rms = await rmsPerFrame(path.join(assets, 'p8-line.wav'), fps)
  const lineDur = rms.length / fps
  const pad = 0.5
  const mouths: [string, string, string, string] = ['face-0.png', 'face-1.png', 'face-2.png', 'face-3.png']
  const A = 5, B = 5
  const bStart = A
  const narrStart = 0.4, lineStart = bStart + pad
  const words = (name: string, text: string, start: number): Word[] => alignToScript(text, JSON.parse(fs.readFileSync(path.join(assets, `${name}.words.json`), 'utf8')) as Word[], start)

  const timeline: TimelineInput = {
    fps, width: 1080, height: 1920,
    look: { grade: 'warm', grain: 0.14, vignette: 0.32, captionPosition: 'top' },
    shots: [
      // real Kling motion
      { id: 'A-kling', durationSec: A, background: 'scene-still-live.png', video: { src: 'clip-live.mp4' }, camera: { move: 'static', intensity: 0, handheld: 0.12 }, layers: [] },
      // engine close-up
      { id: 'B-talk', durationSec: B, background: 'bg-kitchen.png', transitionIn: 'whip', camera: { move: 'push-in', intensity: 0.5, handheld: 0.35 }, layers: [
        { kind: 'particles', preset: 'steam', count: 8 },
        { kind: 'character', id: 'mango-face', x: 0.5, y: 1.005, width: 1.0, motion: 'breathe',
          frames: mouthFrames(mouthTrackFromRms(rms, fps), { startSec: pad, endSec: pad + lineDur, mouthSrc: mouths, restSrc: 'face-0.png' }),
          talk: { energy: energyEnvelope(rms), startSec: pad, amount: 1 },
          blinks: { src: 'face-blink.png', times: [0.3, 1.9, 3.6], holdSec: 0.13 } },
      ] },
    ],
    voices: [{ src: 'p8-narr.wav', startSec: narrStart, volume: 1 }, { src: 'p8-line.wav', startSec: lineStart, volume: 1 }],
    sfx: [{ src: whoosh, startSec: bStart - 0.15, volume: 0.7 }, { src: hiss, startSec: bStart + 1.0, volume: 0.22 }],
    captions: [
      { text: LINES[0].text, startSec: narrStart, endSec: narrStart + dur('p8-narr.wav'), words: words('p8-narr', LINES[0].text, narrStart) },
      { text: LINES[1].text, startSec: lineStart, endSec: lineStart + lineDur, words: words('p8-line', LINES[1].text, lineStart) },
    ],
    music: null,
  }

  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = fs.existsSync(chrome) ? chrome : null

  console.log('Rendering in 2 chunks...')
  const chunked = await renderTimelineChunked({ timeline, assetsDir: assets, outFile: path.join(root, 'phase8-chunked.mp4'), workDir: path.join(root, 'work'), maxChunkSec: 5, browserExecutable: browser,
    onProgress: (p) => process.stdout.write(`\r  chunk ${p.chunk + 1}/${p.chunks} ${Math.round(p.progress * 100)}%   `) })
  console.log(`\n  ${chunked.chunks} chunks: ${chunked.chunkRanges.map((c) => `[${c.fromFrame}-${c.toFrame}]`).join(' ')}`)
  const loud = await normalizeLoudness(path.join(root, 'phase8-chunked.mp4'))
  console.log('loudness', JSON.stringify(loud))

  console.log('Rendering the same timeline in ONE piece (to prove the chunks match)...')
  await renderTimeline({ timeline, assetsDir: assets, outFile: path.join(root, 'phase8-single.mp4'), browserExecutable: browser })
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
main().catch((e) => { console.error(e instanceof Error ? `${e.name}: ${e.message}` : e); process.exit(1) })
