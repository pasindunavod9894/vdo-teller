import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { TimelineSchema, type Timeline, type TimelineInput } from './timeline'

export type RenderOptions = {
  timeline: TimelineInput
  /** folder that holds every asset the timeline references (copied into the bundle) */
  assetsDir: string
  outFile: string
  /** use an installed Chrome instead of letting Remotion download its own browser */
  browserExecutable?: string | null
  concurrency?: number
  onProgress?: (p: { progress: number; renderedFrames: number; totalFrames: number }) => void
}

export async function renderTimeline(opts: RenderOptions) {
  const timeline: Timeline = TimelineSchema.parse(opts.timeline) // fail early on a bad timeline
  const serveUrl = await bundle({ entryPoint: path.resolve(process.cwd(), 'src/remotion/index.ts'), publicDir: opts.assetsDir })
  const inputProps = { timeline }
  const common = { serveUrl, inputProps, browserExecutable: opts.browserExecutable ?? null }
  const composition = await selectComposition({ ...common, id: 'Episode' })
  await renderMedia({
    ...common, composition, codec: 'h264', outputLocation: opts.outFile, concurrency: opts.concurrency ?? 2,
    onProgress: (p) => opts.onProgress?.({ progress: p.progress, renderedFrames: p.renderedFrames, totalFrames: composition.durationInFrames }),
  })
  return { durationInFrames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height }
}
