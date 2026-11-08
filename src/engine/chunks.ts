import { framesOf, shotStarts, type Timeline } from './timeline'

/**
 * Long videos are rendered in chunks (plan 8e): each chunk is a range of frames of the SAME composition, split only at shot
 * boundaries, so every chunk starts on a clean cut. Chunks carry no audio; the audio is mixed once for the whole episode.
 */
export type Chunk = { index: number; fromFrame: number; toFrame: number /* inclusive */; shots: number }

/** Where each shot starts and how long it lasts in frames. Uses the same rounding as the Remotion composition. */
export function shotFrameRanges(t: Pick<Timeline, 'shots' | 'fps'>) {
  const starts = shotStarts(t)
  return t.shots.map((s, i) => ({ from: Math.round(starts[i] * t.fps), frames: framesOf(s.durationSec, t.fps) }))
}

/** The number of frames the composition renders (the sum of the shots, as in `calculateMetadata`). */
export const totalFrames = (t: Pick<Timeline, 'shots' | 'fps'>) => t.shots.reduce((n, s) => n + framesOf(s.durationSec, t.fps), 0)

/**
 * Greedily packs consecutive shots into chunks of at most `maxChunkFrames`. A single shot longer than the limit gets a chunk
 * of its own. The chunks are contiguous and cover frames 0..total-1 exactly once.
 */
export function planChunks(t: Pick<Timeline, 'shots' | 'fps'>, maxChunkFrames: number): Chunk[] {
  const ranges = shotFrameRanges(t)
  const total = totalFrames(t)
  const chunks: Chunk[] = []
  let first = 0 // index of the first shot of the chunk being built
  for (let i = 1; i < ranges.length; i++) {
    const sizeIfShotJoins = ranges[i].from + ranges[i].frames - ranges[first].from
    if (sizeIfShotJoins > maxChunkFrames) {
      chunks.push({ index: chunks.length, fromFrame: ranges[first].from, toFrame: ranges[i].from - 1, shots: i - first })
      first = i
    }
  }
  chunks.push({ index: chunks.length, fromFrame: ranges[first].from, toFrame: total - 1, shots: ranges.length - first })
  return chunks
}
