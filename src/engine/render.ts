import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { mixTimelineAudio } from './audio'
import { planChunks, totalFrames } from './chunks'
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

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr.on('data', (c) => { err += c })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-300)}`))))
  })
}

export type ChunkedOptions = Omit<RenderOptions, 'onProgress'> & {
  /** scratch folder for the chunk files and the mixed audio */
  workDir: string
  /** longest chunk in seconds (chunks only ever split at shot boundaries) */
  maxChunkSec?: number
  onProgress?: (p: { chunk: number; chunks: number; progress: number }) => void
}

/**
 * Renders in chunks (plan 8e) so a long episode never has to fit in one render: every chunk is a frame range of the same
 * composition with NO audio, the chunks are joined losslessly, and ALL audio (voices, effects, music) is mixed once for the
 * whole episode and added at the end. That keeps a long video in sync, because no audio ever has to be stitched.
 */
export async function renderTimelineChunked(opts: ChunkedOptions) {
  const timeline: Timeline = TimelineSchema.parse(opts.timeline)
  const chunks = planChunks(timeline, Math.max(timeline.fps, Math.round((opts.maxChunkSec ?? 60) * timeline.fps)))
  fs.mkdirSync(opts.workDir, { recursive: true })

  const serveUrl = await bundle({ entryPoint: path.resolve(process.cwd(), 'src/remotion/index.ts'), publicDir: opts.assetsDir })
  const common = { serveUrl, inputProps: { timeline }, browserExecutable: opts.browserExecutable ?? null }
  const composition = await selectComposition({ ...common, id: 'Episode' })

  const files: string[] = []
  for (const c of chunks) {
    const file = path.join(opts.workDir, `chunk-${String(c.index).padStart(3, '0')}.mp4`)
    await renderMedia({
      ...common, composition, codec: 'h264', outputLocation: file, frameRange: [c.fromFrame, c.toFrame], muted: true,
      concurrency: opts.concurrency ?? 2,
      onProgress: (p) => opts.onProgress?.({ chunk: c.index, chunks: chunks.length, progress: p.progress }),
    })
    files.push(file)
  }

  // join the chunks without re-encoding
  const list = path.join(opts.workDir, 'chunks.txt')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
  const joined = path.join(opts.workDir, 'video-only.mp4')
  await ffmpeg(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined])

  // mix all the audio once, then add it
  const audio = path.join(opts.workDir, 'audio.wav')
  await mixTimelineAudio(timeline, opts.assetsDir, audio)
  const seconds = totalFrames(timeline) / timeline.fps
  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true })
  await ffmpeg(['-y', '-v', 'error', '-i', joined, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', seconds.toFixed(3), opts.outFile])

  return { chunks: chunks.length, durationInFrames: totalFrames(timeline), fps: timeline.fps, width: composition.width, height: composition.height, chunkRanges: chunks }
}
