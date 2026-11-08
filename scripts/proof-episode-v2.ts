/* Proof episode v2: LIVE movement (walk, hop, speech-driven head, blinks, shiver), steady-face lip-sync, real word timing.
 * Only generation cost: whisper-1 word timings (~$0.001). All art is cached in render/proof/assets.
 *   pnpm tsx --env-file=.env scripts/proof-episode-v2.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { alignBodies } from '../src/engine/assets'
import { normalizeLoudness } from '../src/engine/finish'
import { energyEnvelope, mouthFrames, mouthTrackFromRms, rmsPerFrame } from '../src/engine/lipsync'
import { renderTimeline } from '../src/engine/render'
import { buildPatchOverlay, buildTalkingFrames } from '../src/engine/talk'
import type { TimelineInput } from '../src/engine/timeline'
import { alignToScript, transcribeWords, type Word } from '../src/engine/transcribe'

const root = path.resolve('render/proof')
const assets = path.join(root, 'assets')
const file = (n: string) => path.join(assets, n)
const fps = 30

const LINES = [
  { name: 'line1', text: 'Three minutes. Perfect noodles. What could possibly go wrong?', talk: 1.0, shiver: 0 },
  { name: 'line2', text: 'Wait... why is the pot growling at me?', talk: 1.4, shiver: 0.8 },
  { name: 'line3', text: 'Okay. New plan. Cereal.', talk: 0.6, shiver: 0 },
]

async function prepareArt() {
  // 1) steady face: base + mouth patches (only the mouth changes)
  const base = file('mouth-closed-n.png')
  const frames = await buildTalkingFrames(base, [
    { name: 'face-1', file: file('talk-slightly-open.png') }, { name: 'face-2', file: file('talk-round-oh.png') }, { name: 'face-3', file: file('talk-wide-open.png') },
  ])
  await sharp(base).resize(1024, 1024, { fit: 'fill' }).png().toFile(file('face-0.png'))
  for (const f of frames) fs.writeFileSync(file(`${f.name}.png`), f.data)
  // 2) blink overlay: only the eyes region of the closed-eyes edit
  fs.writeFileSync(file('face-blink.png'), await buildPatchOverlay(base, file('talk-blink.png'), 'eyes'))
  // 3) full bodies on one foot baseline (stand, two walk strides, crouch, jump)
  const bodies = await alignBodies(['pose-standing-front', 'body-walk-a', 'body-walk-b', 'body-crouch', 'body-air'].map((n) => ({ name: n, file: file(`${n}.png`) })))
  for (const b of bodies) fs.writeFileSync(file(`${b.name}-b.png`), b.data)
}

async function words(name: string, text: string, start: number): Promise<Word[]> {
  const cache = file(`${name}.words.json`)
  if (!fs.existsSync(cache)) fs.writeFileSync(cache, JSON.stringify(await transcribeWords(file(`${name}.wav`)))) // ~$0.001, once
  return alignToScript(text, JSON.parse(fs.readFileSync(cache, 'utf8')) as Word[], start)
}

async function main() {
  const t0 = Date.now()
  await prepareArt()
  console.log(`art prepared (${((Date.now() - t0) / 1000).toFixed(1)}s)`)

  const probe = LINES.map((l) => ({ ...l }))
  const info = await Promise.all(probe.map(async (l) => {
    const rms = await rmsPerFrame(file(`${l.name}.wav`), fps)
    return { dur: rms.length / fps, track: mouthTrackFromRms(rms, fps), energy: energyEnvelope(rms) }
  }))

  const pad = 0.15
  const L = (d: number) => Math.max(2.4, d + pad + 0.6)
  const dA = 3.2, dB = L(info[0].dur), dC = 2.2, dD = L(info[1].dur), dE = 2.8, dF = L(info[2].dur), dG = 3.0
  const sB = dA, sD = dA + dB + dC, sF = dA + dB + dC + dD + dE
  const start = [sB, sD, sF]

  const mouths: [string, string, string, string] = ['face-0.png', 'face-1.png', 'face-2.png', 'face-3.png']
  const talker = (i: number, shotStart: number) => ({
    kind: 'character' as const, id: 'mango-face', x: 0.5, y: 1.005, width: 1.0, motion: 'breathe' as const,
    frames: mouthFrames(info[i].track, { startSec: pad, endSec: pad + info[i].dur, mouthSrc: mouths, restSrc: 'face-0.png' }),
    talk: { energy: info[i].energy, startSec: pad, amount: LINES[i].talk },
    blinks: { src: 'face-blink.png', times: [0.5, 1.9, 3.3, 4.6].filter((b) => b < (i === 0 ? dB : i === 1 ? dD : dF)).map((b) => b + (i === 1 ? -0.2 : 0)), holdSec: 0.13 },
    ...(LINES[i].shiver ? { shiver: { fromSec: pad, toSec: pad + info[i].dur, amount: LINES[i].shiver } } : {}),
    _shot: shotStart,
  })
  const strip = (o: Record<string, unknown>) => { const { _shot, ...rest } = o; void _shot; return rest }
  const W = ['body-walk-a-b.png', 'body-walk-b-b.png']
  const STAND = 'pose-standing-front-b.png'

  const timeline: TimelineInput = {
    fps, width: 1080, height: 1920,
    look: { grade: 'warm', grain: 0.18, vignette: 0.35, captionPosition: 'top' },
    shots: [
      // A: Mango WALKS into the kitchen (two strides alternate, bounce + lean on every step), then stands
      { id: 'A-walk-in', durationSec: dA, background: 'bg-kitchen.png', camera: { move: 'pan-right', intensity: 0.5, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'dust', count: 14 },
        { kind: 'character', id: 'mango', x: 0.5, y: 0.98, width: 0.95, frames: [{ atSec: 0, src: STAND }], motion: 'breathe',
          path: { from: { x: -0.2, y: 0.98 }, to: { x: 0.5, y: 0.98 }, startSec: 0.1, endSec: 2.3, ease: 'inOut', arc: 0, scaleTo: 1 },
          cycle: { frames: W, hz: 3.4, fromSec: 0.1, toSec: 2.3, bounce: 0.014, lean: 3 } },
        { kind: 'text', text: "Chef Mango's 3-minute noodles", atSec: 0.5, durationSec: 2.4, position: 'top' },
      ] },
      // B: dialogue, steady face (only the mouth changes), blinks, head nods with the speech
      { id: 'B-line1', durationSec: dB, background: 'bg-kitchen.png', transitionIn: 'whip', camera: { move: 'push-in', intensity: 0.5, handheld: 0.35 }, layers: [strip(talker(0, sB)) as never] },
      { id: 'C-stove', durationSec: dC, background: 'bg-stove.png', camera: { move: 'pan-right', intensity: 0.7, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'steam', count: 10 },
        { kind: 'text', text: 'Meanwhile...', atSec: 0.2, durationSec: 1.8, position: 'top' },
      ] },
      // D: scared line: the face shivers while he talks
      { id: 'D-line2', durationSec: dD, background: 'bg-stove.png', transitionIn: 'whip', camera: { move: 'push-in', intensity: 0.8, handheld: 0.45 }, layers: [
        { kind: 'particles', preset: 'steam', count: 8 }, strip(talker(1, sD)) as never] },
      // E: the pot boils over and Mango JUMPS back: crouch -> air -> crouch -> stand, with a hop arc + squash and stretch
      { id: 'E-jump', durationSec: dE, background: 'bg-chaos.png', camera: { move: 'shake', intensity: 0.9, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'steam', count: 16 },
        { kind: 'character', id: 'mango', x: 0.62, y: 0.98, width: 0.85, motion: 'none',
          frames: [{ atSec: 0, src: 'pose-standing-front-b.png' }, { atSec: 0.25, src: 'body-crouch-b.png' }, { atSec: 0.55, src: 'body-air-b.png' }, { atSec: 1.35, src: 'body-crouch-b.png' }, { atSec: 1.7, src: STAND }],
          path: { from: { x: 0.62, y: 0.98 }, to: { x: 0.36, y: 0.98 }, startSec: 0.55, endSec: 1.4, arc: 0.3, ease: 'inOut', scaleTo: 1 } },
        { kind: 'text', text: 'BOIL OVER!', atSec: 0.1, durationSec: 2.2, position: 'top' },
      ] },
      { id: 'F-line3', durationSec: dF, background: 'bg-night.png', transitionIn: 'fade', camera: { move: 'push-in', intensity: 0.5, handheld: 0.3 }, layers: [strip(talker(2, sF)) as never] },
      // G: he WALKS AWAY into the distance (smaller as he goes)
      { id: 'G-walk-away', durationSec: dG, background: 'bg-night.png', camera: { move: 'pull-out', intensity: 0.6, handheld: 0.2 }, layers: [
        { kind: 'particles', preset: 'dust', count: 10 },
        { kind: 'character', id: 'mango', x: 0.4, y: 0.98, width: 0.95, motion: 'breathe', frames: [{ atSec: 0, src: STAND }],
          path: { from: { x: 0.4, y: 0.98 }, to: { x: 0.9, y: 0.9 }, startSec: 0.5, endSec: dG, ease: 'inOut', arc: 0, scaleTo: 0.5 },
          cycle: { frames: W, hz: 3.0, fromSec: 0.5, toSec: dG + 0.1, bounce: 0.012, lean: 2.5 } }, // runs to the end of the shot so he never snaps back to the standing pose
        { kind: 'text', text: 'Tomorrow: Plan B', atSec: 0.2, durationSec: 2.6, position: 'top' },
      ] },
    ],
    voices: LINES.map((l, i) => ({ src: `${l.name}.wav`, startSec: start[i] + pad })),
    captions: await Promise.all(LINES.map(async (l, i) => ({
      text: l.text, startSec: start[i] + pad, endSec: start[i] + pad + info[i].dur, words: await words(l.name, l.text, start[i] + pad),
    }))),
    music: null,
  }

  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  console.log('Rendering...')
  let last = -1
  const out = await renderTimeline({
    timeline, assetsDir: assets, outFile: path.join(root, 'proof-v2.mp4'), browserExecutable: fs.existsSync(chrome) ? chrome : null,
    onProgress: (p) => { const pct = Math.floor(p.progress * 5) * 20; if (pct !== last) { last = pct; console.log(`  render ${pct}%`) } },
  })
  const loud = await normalizeLoudness(path.join(root, 'proof-v2.mp4'))
  console.log('loudness', JSON.stringify(loud))
  console.log('done', JSON.stringify(out), `${((Date.now() - t0) / 1000).toFixed(0)}s`)
  fs.writeFileSync(path.join(root, 'v2-times.json'), JSON.stringify({ sB, sD, sE: sD + dD, sF, sG: sF + dF, dB, dD, dE }))
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
