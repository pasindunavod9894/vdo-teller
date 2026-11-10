/* LIVE proof of a fal.ai lip-sync model on one clip and one line of speech. The model pages do not say whether the models work on
 * cartoon or animal faces, so run this on a clip of each look you care about (realistic animal, 3D cartoon, 2D cartoon) and watch
 * the result before relying on it. COSTS MONEY (about USD 0.05 per second of clip). It refuses to run unless you pass --yes.
 *
 *   pnpm tsx --env-file=.env scripts/lipsync-proof.ts --video clip.mp4 --audio line.wav            # dry run
 *   pnpm tsx --env-file=.env scripts/lipsync-proof.ts --video clip.mp4 --audio line.wav --yes
 */
import fs from 'node:fs'
import path from 'node:path'
import { probe } from '../src/engine/ffmpeg'
import { DEFAULT_LIPSYNC_MODEL, LIPSYNC_MODELS, lipsyncCostUsd, type LipsyncModelId } from '../src/lib/video'
import { generateLipsync } from '../src/providers/video/lipsync'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
  const video = arg('video'), audio = arg('audio')
  const model = (arg('model') ?? DEFAULT_LIPSYNC_MODEL) as LipsyncModelId
  if (!(model in LIPSYNC_MODELS)) throw new Error(`Unknown lip-sync model "${model}". Known: ${Object.keys(LIPSYNC_MODELS).join(', ')}`)
  if (!video || !audio || !fs.existsSync(video) || !fs.existsSync(audio)) throw new Error('Pass --video <clip.mp4> and --audio <line.wav>.')
  const seconds = (await probe(video)).durationSec
  console.log(`model: ${model} (${LIPSYNC_MODELS[model].endpoint}) | clip ${seconds.toFixed(1)}s | expected cost: USD ${lipsyncCostUsd(model, seconds).toFixed(2)}`)
  if (!process.env.FAL_KEY) { console.log('FAL_KEY is missing in .env, so nothing can run.'); process.exit(1) }
  if (!process.argv.includes('--yes')) { console.log('Dry run: nothing was spent. Add --yes to run for real.'); return }
  const dest = path.resolve('render/lipsync-proof', `${path.basename(video, path.extname(video))}-${model}.mp4`)
  const r = await generateLipsync({ model, videoFile: video, audioFile: audio, destFile: dest })
  const p = await probe(dest)
  console.log(`done: ${dest} (${p.width}x${p.height}, ${p.durationSec.toFixed(2)}s, cost USD ${r.costUsd.toFixed(2)}). Play it and check the mouth and that the face did not change.`)
}
main().catch((e) => { console.error(e instanceof Error ? `${e.name}: ${e.message}` : e); process.exit(1) })
