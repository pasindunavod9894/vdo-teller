import fs from 'node:fs'
import path from 'node:path'
import { aspectSlug, recompose, sizeFor, type Aspect } from '../engine/aspect'
import { TimelineSchema } from '../engine/timeline'
import { normalizeLoudness } from '../engine/finish'
import type { ChunkedOptions } from '../engine/render'
import { chromePath } from './media-ctx'

export type ExportRequest = {
  episodeDir: string
  aspect: Aspect
  /** the series' own (master) aspect and the quality tier */
  masterAspect: Aspect
  tier: string
  /** master file relative to the episode folder, e.g. out/master.mp4 */
  master: string
  /** injectable for tests; defaults to the Remotion chunked renderer */
  renderFn?: (opts: ChunkedOptions) => Promise<unknown>
}

/**
 * Renders the episode for another aspect ratio from the saved timeline (plan §8), re-composed rather than cropped, with the
 * same assets, voices and music. The master's own aspect is just a copy. Returns the file relative to the episode folder.
 */
export async function renderExport(r: ExportRequest): Promise<string> {
  const outRel = path.join('out', `export-${aspectSlug(r.aspect)}.mp4`)
  const out = path.join(r.episodeDir, outRel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  if (r.aspect === r.masterAspect) {
    fs.copyFileSync(path.join(r.episodeDir, r.master), out)
    return outRel
  }
  const file = path.join(r.episodeDir, 'timeline.json')
  if (!fs.existsSync(file)) throw new Error('This episode has no saved timeline to re-render.')
  const base = TimelineSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
  const timeline = recompose(base, sizeFor(r.aspect, r.tier))
  const render = r.renderFn ?? (await import('../engine/render')).renderTimelineChunked
  await render({ timeline, assetsDir: path.join(r.episodeDir, 'assets'), outFile: out, workDir: path.join(r.episodeDir, 'out', `work-${aspectSlug(r.aspect)}`), browserExecutable: chromePath(), concurrency: 2 })
  await normalizeLoudness(out)
  return outRel
}
