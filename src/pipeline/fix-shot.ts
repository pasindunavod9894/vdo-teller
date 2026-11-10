import fs from 'node:fs'
import path from 'node:path'
import { assembleTimeline } from '../engine/assemble'
import { normalizeLoudness } from '../engine/finish'
import { shotStarts, TimelineSchema } from '../engine/timeline'
import type { MediaServices } from '../media/types'
import { clipSeconds, DEFAULT_LIPSYNC_MODEL, lipsyncCostUsd, videoCostUsd, type VideoModelId } from '../lib/video'
import type { ClipRequest, ClipResult, LipsyncRequest, LipsyncResult } from '../providers/video'
import { NARRATOR } from './cast'
import { checkClipContinuity, makeSheetAt, type CastRef } from './continuity'
import type { MediaState } from './media-ctx'
import type { ClipContinuity, ReelQaFlag, Script, ShotList } from './schemas'
import { produceVideoShots, type ShotJob } from './video-shots'

/**
 * "Fix shot" (plan R3): the vision check of a finished reel only FLAGS a shot; remaking it costs money, so it happens only when the user
 * clicks. This remakes ONE clip from its saved keyframe with the stricter prompt (and the pinned end frame where the model allows it),
 * lip-syncs it if it carries a line, runs the continuity check, assembles the reel again from the saved timeline, and looks at the result.
 */

/** The latest speech file made for a beat (speech files are named after the beat and a hash of the words and the voice). */
export function findSpeechFile(assetsDir: string, beat: number): string | null {
  if (!fs.existsSync(assetsDir)) return null
  const files = fs.readdirSync(assetsDir).filter((f) => f.startsWith(`speech-beat-${beat}-`) && /\.(wav|mp3)$/.test(f))
  if (!files.length) return null
  return path.join(assetsDir, files.map((f) => ({ f, t: fs.statSync(path.join(assetsDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f)
}

/** Rebuilds the job of one shot (what the Editor used) from what was saved: the shot list, the script and the media state. */
export function shotJobFrom(o: { shot: ShotList['shots'][number]; script: Script; state: MediaState; assetsDir: string }): ShotJob {
  const { shot, script, state, assetsDir } = o
  const keyframe = state.keyframes[shot.n]
  if (!keyframe) throw new Error(`Shot ${shot.n} has no saved keyframe, so it cannot be remade.`)
  const beat = script.beats.find((b) => b.n === shot.beat)
  const cast: CastRef[] = state.shotCast[shot.n] ?? []
  const speaks = !!(beat?.line && beat.speaker && beat.speaker !== NARRATOR && cast.some((c) => c.name === beat.speaker))
  const speechFile = speaks ? findSpeechFile(assetsDir, shot.beat) : null
  return {
    n: shot.n, durationSec: shot.durationSec, videoSeconds: Math.max(shot.videoSeconds, 5), motionPrompt: shot.motionPrompt,
    keyframe: path.join(assetsDir, keyframe), speech: speechFile ? { file: speechFile } : null, cast,
  }
}

export type FixShotInput = {
  episodeDir: string
  job: ShotJob
  model: VideoModelId
  media: MediaServices
  /** the flags the episode has now; the ones of this shot are replaced by what the new look finds */
  flags: ReelQaFlag[]
  /** the series' own list of things that must not appear */
  negative?: string
  canSpend?: (usd: number) => Promise<boolean>
  make?: (req: ClipRequest) => Promise<ClipResult>
  lipsync?: (req: LipsyncRequest) => Promise<LipsyncResult>
}
export type FixShotResult = { costUsd: number; videoSeconds: number; flags: ReelQaFlag[]; continuity: ClipContinuity | undefined; master: string }

export async function fixShot(i: FixShotInput): Promise<FixShotResult> {
  const timelineFile = path.join(i.episodeDir, 'timeline.json')
  if (!fs.existsSync(timelineFile)) throw new Error('This video has no saved timeline, so a shot cannot be remade.')
  const timeline = TimelineSchema.parse(JSON.parse(fs.readFileSync(timelineFile, 'utf8')))
  const id = `shot-${i.job.n}`
  const index = timeline.shots.findIndex((s) => s.id === id)
  if (index < 0) throw new Error(`Shot ${i.job.n} is not in this video.`)
  const assetsDir = path.join(i.episodeDir, 'assets')
  const clipsDir = path.join(i.episodeDir, 'clips')
  const outDir = path.join(i.episodeDir, 'out')

  const r = await produceVideoShots({
    model: i.model, shots: [i.job], workDir: clipsDir, allowanceSec: 100000, canSpend: i.canSpend, negative: i.negative, make: i.make, lipsync: i.lipsync,
    strictFirst: true, tag: `-fix${Date.now()}`,
    check: (clip, job, attempt, clipSec) => (job.cast.length
      ? checkClipContinuity(i.media, { clip, workDir: clipsDir, label: `${id}-fix-a${attempt}`, cast: job.cast, usedSeconds: job.durationSec, clipSeconds: clipSec })
      : Promise.resolve({ verdict: { ok: true, worst: null, issues: [], undeclared: [] }, result: { characters: [], undeclaredCharacters: [], costUsd: 0 }, costUsd: 0 })),
  })
  // the new clip takes the old one's place under the same name, so the timeline needs no change
  fs.copyFileSync(r.files[i.job.n], path.join(assetsDir, timeline.shots[index].clip))

  const master = path.join(outDir, 'master.mp4')
  await assembleTimeline({ timeline, assetsDir, outFile: master, workDir: path.join(outDir, 'work') })
  await normalizeLoudness(master)

  // look at the reel again, and keep only this shot's new verdict (the other flags stay as they were)
  let flags = i.flags.filter((f) => f.shot !== i.job.n)
  let qaUsd = 0
  try {
    const starts = shotStarts(timeline)
    const sheet = await makeSheetAt(master, path.join(outDir, 'reel-sheet.jpg'), timeline.shots.map((s, k) => starts[k] + s.durationSec / 2), 320)
    const q = await i.media.reelQa({ sheetFile: sheet, shots: timeline.shots.map((s) => Number(s.id.replace(/^shot-/, ''))) })
    qaUsd = q.costUsd
    flags = [...flags, ...q.flags.filter((f) => f.shot === i.job.n)]
  } catch { /* the remade clip stays; the flag of this shot is simply cleared */ }
  return {
    costUsd: Math.round((r.totalCostUsd + r.checkCostUsd + qaUsd) * 10000) / 10000, videoSeconds: r.totalSeconds, flags,
    continuity: r.clips[0]?.continuity, master: path.relative(i.episodeDir, master),
  }
}

/** What remaking one clip is expected to cost, for the confirmation in the dashboard: the clip, its lip-sync if it carries a line, and the checks. */
export function fixShotEstimateUsd(model: VideoModelId, shotSeconds: number, hasLine: boolean): number {
  return Math.round((videoCostUsd(model, shotSeconds) + (hasLine ? lipsyncCostUsd(DEFAULT_LIPSYNC_MODEL, clipSeconds(model, shotSeconds)) : 0) + 0.02) * 100) / 100
}
