import type { MediaServices } from '../media/types'
import type { CharacterKit } from '../media/kit'
import type { Workspace } from '../media/workspace'
import type { Timeline } from '../engine/timeline'
import type { AssembleOptions } from '../engine/assemble'
import type { ClipRequest, ClipResult, LipsyncRequest, LipsyncResult } from '../providers/video'
import fs from 'node:fs'
import path from 'node:path'
import type { CastRef } from './continuity'

/**
 * Everything the media agents share for ONE episode (plan phase 9). The Orchestrator owns it and passes it to each agent:
 * the Art Director fills `plates`, `keyframes` and `shotCast`, the Animator reads them and fills `timeline`, the Editor-QA assembles it.
 * When it is absent the agents run their free mock version (used by tests and by PIPELINE mock-only runs).
 */
export type MediaCtx = {
  media: MediaServices
  ws: Workspace
  /** the series' main characters, keyed by character name */
  kits: Record<string, CharacterKit>
  fps: number
  width: number
  height: number
  state: {
    /** background plate file per shot number */
    plates: Record<number, string>
    /** the checked keyframe (file name in assets) per shot: what the shot's video clip starts from */
    keyframes: Record<number, string>
    /** the reference image (file name in assets) of each supporting character this reel declared, by name */
    supporting: Record<string, { file: string; recurring: boolean }>
    /** per shot: the characters in it with the absolute path of their reference, for the continuity check */
    shotCast: Record<number, CastRef[]>
    /** the timeline built by the Editor step */
    timeline?: Timeline
    /** the finished, loudness-normalised episode, relative to the episode folder */
    master?: string
  }
  /** a retry of this episode: clips and lip-sync results an earlier attempt already made are reused (see `reusableFile`) */
  reuseClips?: boolean
  /** injectable for tests; defaults to the FFmpeg assembler */
  renderFn?: (opts: AssembleOptions) => Promise<unknown>
  /** injectable for tests; default to the fal.ai provider (or its free mock) */
  makeClipFn?: (req: ClipRequest) => Promise<ClipResult>
  lipsyncFn?: (req: LipsyncRequest) => Promise<LipsyncResult>
}

/** The part of the media state that later steps (and a paused or finished episode) need: which files are the plates, keyframes and references. */
export type MediaState = Pick<MediaCtx['state'], 'plates' | 'keyframes' | 'supporting' | 'shotCast'>

/** Saves the state next to the episode's files, so the review step can continue from it and "Fix shot" can find a shot's keyframe. */
export function saveMediaState(episodeDir: string, state: MediaCtx['state']): void {
  const { plates, keyframes, supporting, shotCast } = state
  fs.writeFileSync(path.join(episodeDir, 'state.json'), JSON.stringify({ plates, keyframes, supporting, shotCast }, null, 2))
}

export function loadMediaState(episodeDir: string): MediaState | null {
  const file = path.join(episodeDir, 'state.json')
  if (!fs.existsSync(file)) return null
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MediaState>
    return { plates: s.plates ?? {}, keyframes: s.keyframes ?? {}, supporting: s.supporting ?? {}, shotCast: s.shotCast ?? {} }
  } catch { return null }
}
