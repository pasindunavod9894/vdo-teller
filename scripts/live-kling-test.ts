/* LIVE check of a video model on fal.ai: animates ONE keyframe image and reports what really came back (size, length, price),
 * then plays it through the FFmpeg assembler at the master size. Use it to verify a model before making it a series' default,
 * in particular `kling-2.5-turbo-standard`: its fal.ai page does not say whether it outputs 720p or accepts an end frame.
 * COSTS MONEY: a 5 s Pro clip is about USD 0.35, a Standard one about USD 0.21. It refuses to run unless you pass --yes.
 *
 *   pnpm tsx --env-file=.env scripts/live-kling-test.ts --image path/to/keyframe.png                       # dry run: shows the cost, spends nothing
 *   pnpm tsx --env-file=.env scripts/live-kling-test.ts --image path/to/keyframe.png --yes                 # Pro model, 5 s
 *   pnpm tsx --env-file=.env scripts/live-kling-test.ts --image path/to/keyframe.png --yes --model kling-2.5-turbo-standard
 *   add --tail to also pin the END of the clip to the same image (shows whether the model accepts an end frame)
 */
import fs from 'node:fs'
import path from 'node:path'
import { assembleTimeline } from '../src/engine/assemble'
import { probe } from '../src/engine/ffmpeg'
import { sizeFor } from '../src/engine/aspect'
import { isVideoModel, VIDEO_MODELS, videoCostUsd } from '../src/lib/video'
import { generateClip } from '../src/providers/video/fal'
import { KEEP_LOOK } from '../src/pipeline/video-shots'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
const SECONDS = 5
const out = path.resolve('render/live-kling')

async function main() {
  const image = arg('image')
  const model = arg('model') ?? 'kling-2.5-turbo'
  if (!isVideoModel(model)) throw new Error(`Unknown model "${model}". Known: ${Object.keys(VIDEO_MODELS).join(', ')}`)
  if (!image || !fs.existsSync(image)) throw new Error('Pass --image <a keyframe image>. Make one in the app, or use any vertical picture with a character in it.')
  const yes = process.argv.includes('--yes')
  const tail = process.argv.includes('--tail')
  console.log(`model: ${model} (${VIDEO_MODELS[model].endpoint}) | ${SECONDS}s | expected cost: USD ${videoCostUsd(model, SECONDS).toFixed(2)} | end frame: ${tail ? 'requested' : 'no'}`)
  if (!process.env.FAL_KEY) { console.log('FAL_KEY is missing in .env, so nothing can run. Add it, then run again.'); process.exit(1) }
  if (!yes) { console.log('Dry run: nothing was spent. Add --yes to generate for real.'); return }

  fs.mkdirSync(out, { recursive: true })
  const t0 = Date.now()
  const clip = await generateClip({
    model, imageFile: image, seconds: SECONDS, destFile: path.join(out, `${model}.mp4`), ...(tail ? { tailImageFile: image } : {}),
    prompt: `The character turns toward the camera and smiles, a small natural movement. Camera: slow push-in. ${KEEP_LOOK}`,
  })
  const p = await probe(clip.file)
  console.log(`clip ready in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${p.width}x${p.height}, ${p.durationSec.toFixed(2)}s, ${p.fps.toFixed(0)} fps, cost USD ${clip.costUsd.toFixed(2)}, request ${clip.requestId}`)
  const target = sizeFor('9:16')
  console.log(p.height >= target.height ? `Output is at least the ${target.width}x${target.height} master size: it can be used as it is.` : `Output is SMALLER than the ${target.width}x${target.height} master: it would be scaled up. Check how it looks before using this model.`)
  if (tail) console.log(`End frame: ${VIDEO_MODELS[model].endFrame ? 'this model accepts it (sent as tail_image_url).' : 'this model is registered as NOT supporting it, so it was not sent. If you believe it does, check the fal.ai schema and set endFrame in src/lib/video.ts.'}`)

  const assets = path.join(out, 'assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.copyFileSync(clip.file, path.join(assets, 'clip.mp4'))
  await assembleTimeline({ timeline: { ...target, shots: [{ id: 'check', clip: 'clip.mp4', durationSec: SECONDS }] }, assetsDir: assets, outFile: path.join(out, `${model}-reel.mp4`), workDir: path.join(out, 'work') })
  fs.writeFileSync(path.join(out, 'cost.txt'), `${model}, ${clip.seconds}s: USD ${clip.costUsd.toFixed(2)} (fal.ai price table; check the fal dashboard for the real charge)\n`)
  console.log(`done: render/live-kling/${model}-reel.mp4`)
}
main().catch((e) => { console.error(e instanceof Error ? `${e.name}: ${e.message}` : e); process.exit(1) })
