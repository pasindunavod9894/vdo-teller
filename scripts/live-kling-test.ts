/* LIVE test of the video model: animates one real scene still with Kling 2.5 Turbo on fal.ai, then plays it inside the engine.
 * COSTS MONEY: a 5 s clip is about $0.35 (10 s about $0.70). It refuses to run unless you pass --yes.
 *
 *   pnpm tsx --env-file=.env scripts/live-kling-test.ts            # shows what it would do and the cost, spends nothing
 *   pnpm tsx --env-file=.env scripts/live-kling-test.ts --yes      # really generates (5 s)
 *   pnpm tsx --env-file=.env scripts/live-kling-test.ts --yes --jump   # uses the jump scenario instead
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { renderTimeline } from '../src/engine/render'
import type { TimelineInput } from '../src/engine/timeline'
import { videoCostUsd } from '../src/lib/video'
import { generateClip, probeDuration } from '../src/providers/video/fal'

const SECONDS = 5
const assets = path.resolve('render/proof/assets')
const out = path.resolve('render/live-kling')
fs.mkdirSync(out, { recursive: true })
const yes = process.argv.includes('--yes')
const jump = process.argv.includes('--jump')

const SCENARIOS = {
  walk: { pose: 'pose-standing-front-b.png', prompt: 'The orange cat in the chef hat turns toward the stove and walks a few steps across the kitchen, looks at the pot, ears twitching. Natural, realistic motion. The character looks exactly the same as in the image. Camera: slow push-in.' },
  jump: { pose: 'body-crouch-b.png', prompt: 'The orange cat in the chef hat is startled by steam and jumps backwards in surprise, lands, and looks at the pot. Natural, realistic motion. The character looks exactly the same as in the image. Camera: handheld, following the action.' },
}

async function main() {
  const s = SCENARIOS[jump ? 'jump' : 'walk']
  const cost = videoCostUsd('kling-2.5-turbo', SECONDS)
  console.log(`Scenario: ${jump ? 'jump' : 'walk'} | model: kling-2.5-turbo | ${SECONDS}s | expected cost: $${cost.toFixed(2)}`)
  if (!process.env.FAL_KEY) { console.log('FAL_KEY is missing in .env, so nothing can run. Add it, then run again.'); process.exit(1) }
  if (!yes) { console.log('Dry run: nothing was spent. Add --yes to generate for real.'); return }

  // Kling needs a full scene WITH the character in it (it cannot take a transparent cut-out): compose one from our assets.
  const bg = await sharp(path.join(assets, 'bg-kitchen.png')).resize(1080, 1920, { fit: 'cover' }).toBuffer()
  const body = await sharp(path.join(assets, s.pose)).resize({ width: 760 }).toBuffer()
  const meta = await sharp(body).metadata()
  const still = path.join(out, 'scene-still.png')
  await sharp(bg).composite([{ input: body, left: Math.round((1080 - 760) / 2), top: 1920 - (meta.height ?? 760) - 40 }]).png().toFile(still)

  const t0 = Date.now()
  const clip = await generateClip({ imageFile: still, prompt: s.prompt, seconds: SECONDS, destFile: path.join(out, 'clip.mp4') })
  console.log(`clip ready in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${clip.seconds}s, cost $${clip.costUsd.toFixed(2)}, request ${clip.requestId}`)
  console.log('clip duration on disk:', (await probeDuration(clip.file)).toFixed(2), 's')

  // play it inside the engine, with text on top, next to nothing else (isolates the clip quality)
  fs.copyFileSync(clip.file, path.join(assets, 'clip-live.mp4'))
  fs.copyFileSync(still, path.join(assets, 'scene-still-live.png'))
  const timeline: TimelineInput = {
    fps: 30, width: 1080, height: 1920, look: { grade: 'warm', grain: 0.12, vignette: 0.3, captionPosition: 'top' },
    shots: [{ id: 'kling', durationSec: SECONDS, background: 'scene-still-live.png', video: { src: 'clip-live.mp4' }, camera: { move: 'static', intensity: 0, handheld: 0.1 }, layers: [] }],
    voices: [], captions: [], music: null,
  }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  await renderTimeline({ timeline, assetsDir: assets, outFile: path.join(out, 'kling-in-engine.mp4'), browserExecutable: fs.existsSync(chrome) ? chrome : null })
  fs.writeFileSync(path.join(out, 'cost.txt'), `Live Kling test (${jump ? 'jump' : 'walk'}), ${clip.seconds}s: $${clip.costUsd.toFixed(2)} (fal.ai price table; check the fal dashboard for the real charge)\n`)
  console.log('done: render/live-kling/kling-in-engine.mp4')
}
main().catch((e) => { console.error(e instanceof Error ? `${e.name}: ${e.message}` : e); process.exit(1) })
