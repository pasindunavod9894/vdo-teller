/* Phase 8b proof episode: REAL generated art + REAL OpenAI voices, rendered by the Animation Engine.
 * Costs real money (~$0.7). Every file is cached in render/proof/assets, so re-running never pays twice.
 * Run:  pnpm tsx --env-file=.env scripts/proof-episode.ts [--render-only]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'
import { normalizeBusts, writeBusts } from '../src/engine/assets'
import { normalizeLoudness } from '../src/engine/finish'
import { mouthFrames, mouthTrackFromFile } from '../src/engine/lipsync'
import { renderTimeline } from '../src/engine/render'
import type { TimelineInput } from '../src/engine/timeline'
import { assetPlan, IMAGE_COST } from '../src/lib/art/plan'
import { stylePrompt } from '../src/lib/styles/prompts'

const STYLE = 'pixar-3d'
const BUDGET_USD = 1.0
const root = path.resolve('render/proof')
const assets = path.join(root, 'assets')
fs.mkdirSync(assets, { recursive: true })
const file = (n: string) => path.join(assets, n)
const renderOnly = process.argv.includes('--render-only')

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const CHARACTER = 'Young orange tabby cat with darker stripes, round expressive green eyes, cream muzzle and chest, stocky build, wearing a rumpled green scarf and a small white chef hat.'
const look = stylePrompt(STYLE)

// ---- budget guard: counts only what is actually generated (cached files cost nothing) ----
let spent = 0
const log: string[] = []
function charge(usd: number, what: string) {
  spent += usd
  log.push(`${what}: $${usd.toFixed(3)}`)
  if (spent > BUDGET_USD) throw new Error(`Budget guard: $${spent.toFixed(2)} would exceed $${BUDGET_USD.toFixed(2)}`)
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn() } catch (e) {
      const status = (e as { status?: number }).status
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || /safety system/i.test((e as Error).message)
      if (!retryable || attempt >= 4) throw new Error(`${label} failed: ${(e as Error).message}`)
      const wait = status === 429 ? 20000 : 3000
      console.log(`  ${label}: retry ${attempt} in ${wait / 1000}s (${status ?? 'safety filter'})`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

async function gen(name: string, make: () => Promise<string>, cost: number) {
  if (fs.existsSync(file(name))) { console.log(`  cached  ${name}`); return }
  const b64 = await withRetry(name, make)
  fs.writeFileSync(file(name), Buffer.from(b64, 'base64'))
  charge(cost, name)
  console.log(`  made    ${name}  (spent so far ~$${spent.toFixed(2)})`)
}

async function art() {
  const q = IMAGE_COST.medium
  // 1) reference sheet (everything else is generated from this image)
  await gen('ref-sheet.png', async () => {
    const r = await client.images.generate({
      model: 'gpt-image-2', size: '1536x1024', quality: 'medium', n: 1,
      prompt: `Character reference sheet of ONE character on a plain light-grey background: front view, side view and a three-quarter view, same character in each, full body, evenly spaced. ${CHARACTER} Art style: ${look}. No text, no labels, no other characters.`,
    })
    return r.data![0].b64_json!
  }, q)

  // 2) transparent cut-outs edited from the reference (poses, expressions, mouth shapes)
  const wanted = new Set(['pose:standing-front', 'emotion:happy', 'emotion:surprised', 'emotion:smug', 'mouth:closed', 'mouth:slightly-open', 'mouth:round-oh', 'mouth:wide-open'])
  const specs = assetPlan().filter((s) => wanted.has(`${s.kind}:${s.name}`))
  const ref = fs.readFileSync(file('ref-sheet.png'))
  for (const s of specs) {
    await gen(`${s.kind}-${s.name}.png`, async () => {
      const r = await client.images.edit({
        model: 'gpt-image-1.5', image: await toFile(ref, 'reference.png', { type: 'image/png' }),
        prompt: `${s.prompt} Character: ${CHARACTER} Art style: ${look}.`,
        background: 'transparent', input_fidelity: 'high', output_format: 'png', size: '1024x1024', quality: 'medium',
      })
      return r.data![0].b64_json!
    }, q)
  }

  // 3) vertical backgrounds, no characters
  const bgs: [string, string][] = [
    ['bg-kitchen.png', 'A cosy modern home kitchen, wide view: wooden counters, a stove with a big silver pot, warm morning light through a window, plants, tiled wall.'],
    ['bg-stove.png', 'Close view of a kitchen stove top with a large silver pot on a lit burner, wooden counter, tiled wall, warm light, shallow depth of field.'],
    ['bg-chaos.png', 'The same cosy kitchen in comical chaos: clouds of white steam everywhere, foam overflowing, a few noodles stuck to the tiled wall, warm light.'],
    ['bg-night.png', 'The same cosy kitchen at night, calm and quiet, moonlight through the window, a bowl of cereal on the counter, soft blue and warm lamp light.'],
  ]
  for (const [name, scene] of bgs) {
    await gen(name, async () => {
      const r = await client.images.generate({
        model: 'gpt-image-2', size: '1024x1536', quality: 'medium', n: 1,
        prompt: `Vertical background illustration for an animated story. ${scene} Art style: ${look}. No characters, no people, no animals, no text. Keep the lower-middle area open, since a character will be placed there.`,
      })
      return r.data![0].b64_json!
    }, q)
  }
}

const LINES: { name: string; text: string; instructions: string }[] = [
  { name: 'line1', text: 'Three minutes. Perfect noodles. What could possibly go wrong?', instructions: 'Smug, playful, confident chef. Natural pace.' },
  { name: 'line2', text: 'Wait... why is the pot growling at me?', instructions: 'Suddenly nervous and a little scared, speaking quickly.' },
  { name: 'line3', text: 'Okay. New plan. Cereal.', instructions: 'Deadpan, defeated but calm.' },
]

async function voices() {
  for (const l of LINES) {
    if (fs.existsSync(file(`${l.name}.wav`))) { console.log(`  cached  ${l.name}.wav`); continue }
    const res = await withRetry(l.name, () => client.audio.speech.create({ model: 'gpt-4o-mini-tts', voice: 'coral', input: l.text, instructions: l.instructions, response_format: 'wav' }))
    fs.writeFileSync(file(`${l.name}.wav`), Buffer.from(await res.arrayBuffer()))
    charge(0.005, l.name)
    console.log(`  made    ${l.name}.wav`)
  }
}

const dur = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file(f)]).toString().trim())

async function main() {
  const t0 = Date.now()
  if (!renderOnly) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing')
    console.log('Art:'); await art()
    console.log('Voices:'); await voices()
    console.log(`Generated this run: ~$${spent.toFixed(2)} (estimate)`)
  }

  // Close-ups differ slightly in zoom/position; normalise them so swapping expressions and mouth shapes never makes the head pop.
  const bustNames = ['emotion-happy', 'emotion-surprised', 'emotion-smug', 'mouth-closed', 'mouth-slightly-open', 'mouth-round-oh', 'mouth-wide-open']
  await writeBusts(await normalizeBusts(bustNames.map((n) => ({ name: n, file: file(`${n}.png`) }))), assets)

  const fps = 30
  const [d1, d2, d3] = LINES.map((l) => dur(`${l.name}.wav`))
  const track = await Promise.all(LINES.map((l) => mouthTrackFromFile(file(`${l.name}.wav`), fps)))
  const mouths: [string, string, string, string] = ['mouth-closed-n.png', 'mouth-slightly-open-n.png', 'mouth-round-oh-n.png', 'mouth-wide-open-n.png']
  const pad = 0.15
  const dialogue = (i: number, d: number, rest: string) => mouthFrames(track[i], { startSec: pad, endSec: pad + d, mouthSrc: mouths, restSrc: rest })
  const L = (d: number) => Math.max(2.2, d + pad + 0.5)

  const a = 3.0, b = L(d1), c = 2.4, e = L(d2), f = 2.4, g = L(d3), h = 2.2
  const t = { b: a, e: a + b + c, g: a + b + c + e + f, }
  const stand = 'pose-standing-front.png'
  const timeline: TimelineInput = {
    fps, width: 1080, height: 1920,
    look: { grade: 'warm', grain: 0.18, vignette: 0.35, captionPosition: 'top' },
    shots: [
      { id: 's1', durationSec: a, background: 'bg-kitchen.png', camera: { move: 'push-in', intensity: 0.6, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'dust', count: 14 },
        { kind: 'character', id: 'mango', x: 0.5, y: 0.97, width: 0.78, frames: [{ atSec: 0, src: stand }], enter: 'pop', motion: 'breathe' },
        { kind: 'text', text: "Chef Mango's 3-minute noodles", atSec: 0.3, durationSec: 2.4, position: 'top' },
      ] },
      { id: 's2', durationSec: b, background: 'bg-kitchen.png', transitionIn: 'whip', camera: { move: 'push-in', intensity: 0.5, handheld: 0.35 }, layers: [
        { kind: 'character', id: 'mango', x: 0.5, y: 1.02, width: 1.0, frames: dialogue(0, d1, 'emotion-smug-n.png'), motion: 'breathe' },
      ] },
      { id: 's3', durationSec: c, background: 'bg-stove.png', transitionIn: 'cut', camera: { move: 'pan-right', intensity: 0.7, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'steam', count: 10 },
        { kind: 'text', text: 'Meanwhile...', atSec: 0.2, durationSec: 1.8, position: 'top' },
      ] },
      { id: 's4', durationSec: e, background: 'bg-stove.png', transitionIn: 'whip', camera: { move: 'push-in', intensity: 0.8, handheld: 0.45 }, layers: [
        { kind: 'particles', preset: 'steam', count: 8 },
        { kind: 'character', id: 'mango', x: 0.5, y: 1.02, width: 1.0, frames: dialogue(1, d2, 'emotion-surprised-n.png'), motion: 'breathe' },
      ] },
      { id: 's5', durationSec: f, background: 'bg-chaos.png', transitionIn: 'cut', camera: { move: 'shake', intensity: 0.9, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'steam', count: 16 },
        { kind: 'character', id: 'mango', x: 0.5, y: 1.03, width: 0.95, frames: [{ atSec: 0, src: 'emotion-surprised-n.png' }], motion: 'bob', enter: 'slide-left' },
        { kind: 'text', text: 'BOIL OVER!', atSec: 0.15, durationSec: 1.8, position: 'top' },
      ] },
      { id: 's6', durationSec: g, background: 'bg-night.png', transitionIn: 'fade', camera: { move: 'push-in', intensity: 0.5, handheld: 0.3 }, layers: [
        { kind: 'character', id: 'mango', x: 0.5, y: 1.02, width: 1.0, frames: dialogue(2, d3, 'emotion-happy-n.png'), motion: 'breathe' },
      ] },
      { id: 's7', durationSec: h, background: 'bg-night.png', transitionIn: 'cut', camera: { move: 'pull-out', intensity: 0.6, handheld: 0.2 }, layers: [
        { kind: 'particles', preset: 'dust', count: 10 },
        { kind: 'character', id: 'mango', x: 0.5, y: 0.97, width: 0.78, frames: [{ atSec: 0, src: stand }], motion: 'breathe' },
        { kind: 'text', text: 'Tomorrow: Plan B', atSec: 0.2, durationSec: 1.8, position: 'top' },
      ] },
    ],
    voices: [
      { src: 'line1.wav', startSec: t.b + pad },
      { src: 'line2.wav', startSec: t.e + pad },
      { src: 'line3.wav', startSec: t.g + pad },
    ],
    captions: [
      { text: LINES[0].text, startSec: t.b + pad, endSec: t.b + pad + d1 },
      { text: LINES[1].text, startSec: t.e + pad, endSec: t.e + pad + d2 },
      { text: LINES[2].text, startSec: t.g + pad, endSec: t.g + pad + d3 },
    ],
    music: null,
  }

  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  console.log('Rendering...')
  let last = -1
  const info = await renderTimeline({
    timeline, assetsDir: assets, outFile: path.join(root, 'proof.mp4'), browserExecutable: fs.existsSync(chrome) ? chrome : null,
    onProgress: (p) => { const pct = Math.floor(p.progress * 5) * 20; if (pct !== last) { last = pct; console.log(`  render ${pct}%`) } },
  })
  const loud = await normalizeLoudness(path.join(root, 'proof.mp4'))
  console.log('loudness', JSON.stringify(loud))
  console.log('done', JSON.stringify(info), `${((Date.now() - t0) / 1000).toFixed(0)}s total`)
  // Only record spend when this run actually generated something (a render-only run must not overwrite the real record).
  if (!renderOnly) fs.writeFileSync(path.join(root, 'cost-log.txt'), log.join('\n') + `\nTOTAL (estimate): $${spent.toFixed(3)}\n`)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
