import fs from 'node:fs'
import type { MediaServices } from '../media/types'
import type { CharacterKit } from '../media/kit'
import type { Workspace } from '../media/workspace'
import type { Timeline } from '../engine/timeline'
import type { ChunkedOptions } from '../engine/render'

/**
 * Everything the media agents share for ONE episode (plan phase 9). The Orchestrator owns it and passes it to each agent:
 * the Art Director fills `plates` and `stills`, the Animator reads them and fills `engine`, the Editor-QA renders `engine`.
 * When it is absent the agents run their free mock version (used by tests and by PIPELINE mock-only runs).
 */
export type MediaCtx = {
  media: MediaServices
  ws: Workspace
  /** keyed by character name */
  kits: Record<string, CharacterKit>
  fps: number
  width: number
  height: number
  state: {
    /** background plate file per shot number */
    plates: Record<number, string>
    /** the checked scene still (plate + character) per video shot */
    stills: Record<number, string>
    /** the engine timeline built by the Animator */
    engine?: Timeline
    /** the finished, loudness-normalised episode, relative to the episode folder */
    master?: string
  }
  /** injectable for tests; defaults to the Remotion chunked renderer */
  renderFn?: (opts: ChunkedOptions) => Promise<unknown>
}

export function chromePath(): string | null {
  const p = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return fs.existsSync(p) ? p : null
}
