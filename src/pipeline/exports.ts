import fs from 'node:fs'
import path from 'node:path'
import { aspectSlug, sizeFor, type Aspect } from '../engine/aspect'
import { reframeVideo } from '../engine/assemble'

/** The master of every reel is vertical 9:16; the other aspects are made from it. */
export const MASTER_ASPECT: Aspect = '9:16'

export type ExportRequest = {
  episodeDir: string
  aspect: Aspect
  /** master file relative to the episode folder, e.g. out/master.mp4 */
  master: string
  /** injectable for tests; defaults to the FFmpeg reframe */
  reframeFn?: typeof reframeVideo
}

/**
 * Makes the episode for another aspect ratio from the finished master (plan §8): the master is shown whole in the middle over
 * a blurred, darkened copy of itself, so nothing is cropped, and its audio is copied untouched. The master's own aspect is just a
 * copy. Returns the file relative to the episode folder.
 */
export async function renderExport(r: ExportRequest): Promise<string> {
  const outRel = path.join('out', `export-${aspectSlug(r.aspect)}.mp4`)
  const out = path.join(r.episodeDir, outRel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const master = path.join(r.episodeDir, r.master)
  if (!fs.existsSync(master)) throw new Error('This episode has no master video to export.')
  if (r.aspect === MASTER_ASPECT) { fs.copyFileSync(master, out); return outRel }
  await (r.reframeFn ?? reframeVideo)(master, out, sizeFor(r.aspect))
  return outRel
}
