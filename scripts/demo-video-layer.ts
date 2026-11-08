/* Free check that a video-model shot plays inside the engine (Remotion OffthreadVideo) with captions/text on top.
 * Uses the free mock clip provider, so it costs nothing. Needs render/proof/assets from the proof episode.
 *   pnpm tsx scripts/demo-video-layer.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { renderTimeline } from '../src/engine/render'
import type { TimelineInput } from '../src/engine/timeline'
import { generateMockClip } from '../src/providers/video/fal'

const assets = path.resolve('render/proof/assets')
const out = path.resolve('render/video-layer')
fs.mkdirSync(out, { recursive: true })

async function main() {
  // A full-scene still WITH the character in it: this is what the video model needs (it cannot take a transparent cut-out).
  const bg = await sharp(path.join(assets, 'bg-kitchen.png')).resize(1080, 1920, { fit: 'cover' }).toBuffer()
  const body = await sharp(path.join(assets, 'pose-standing-front-b.png')).resize({ width: 760 }).toBuffer()
  const meta = await sharp(body).metadata()
  const sceneStill = path.join(assets, 'scene-still-stand.png')
  await sharp(bg).composite([{ input: body, left: Math.round((1080 - 760) / 2), top: 1920 - (meta.height ?? 760) - 40 }]).png().toFile(sceneStill)

  const clip = await generateMockClip({ imageFile: sceneStill, seconds: 5, destFile: path.join(assets, 'clip-mock.mp4'), width: 540, height: 960 })
  console.log('mock clip', clip.seconds, 's, cost $' + clip.costUsd)

  const timeline: TimelineInput = {
    fps: 30, width: 540, height: 960,
    look: { grade: 'warm', grain: 0.15, vignette: 0.3, captionPosition: 'top' },
    shots: [
      { id: 'video-shot', durationSec: 3, background: 'scene-still-stand.png', video: { src: 'clip-mock.mp4' }, camera: { move: 'static', intensity: 0, handheld: 0.2 }, layers: [
        { kind: 'text', text: 'Real-motion clip plays here', atSec: 0.3, durationSec: 2.4, position: 'top' },
      ] },
      { id: 'engine-shot', durationSec: 2, background: 'bg-night.png', transitionIn: 'whip', camera: { move: 'push-in', intensity: 0.5, handheld: 0.3 }, layers: [] },
    ],
    voices: [], captions: [], music: null,
  }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const info = await renderTimeline({ timeline, assetsDir: assets, outFile: path.join(out, 'video-layer.mp4'), browserExecutable: fs.existsSync(chrome) ? chrome : null })
  console.log('rendered', JSON.stringify(info))
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
