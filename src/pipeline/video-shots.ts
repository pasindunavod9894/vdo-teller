import path from 'node:path'
import { DEFAULT_LIPSYNC_MODEL, videoCostUsd, VIDEO_MODELS, type VideoModelId } from '../lib/video'
import { makeClip, makeLipsync, type ClipRequest, type ClipResult, type LipsyncRequest, type LipsyncResult } from '../providers/video'
import { VideoError } from '../providers/video/fal'
import { BudgetError, ContinuityError, withSpend } from './errors'
import { limitFrom, runPool } from './pool'
import { keepFullLength, reusableFile } from './clip-files'
import { probeDuration } from '../providers/video/fal'
import type { CastRef, ClipCheck } from './continuity'
import type { ClipContinuity, VideoClip } from './schemas'

/** Added to every motion prompt: the model must not change who the characters are. */
export const KEEP_LOOK = 'The characters keep exactly the same appearance in every frame: same face, colours, markings and outfit. One simple continuous action, no spinning, no transformation, no new characters.'
/** The retry is stricter still: smaller movements, and the end frame is pinned to the keyframe where the model supports it. */
export const KEEP_LOOK_STRICT = 'Very small, calm movements only. The characters must look identical to the image in every frame. No fast turns, no cuts, no new characters.'
export const NEGATIVE = 'morphing, changing face, changing colours, changing outfit, extra characters, extra limbs, text, watermark, logo, blur, distortion'
export const MAX_ATTEMPTS = 2

/** How many shots are made at the same time (each is its own fal request). 1 = one after another. */
export const videoConcurrency = (env: Record<string, string | undefined> = process.env): number => limitFrom(env.VIDEO_CONCURRENCY)

export type ShotJob = {
  n: number
  /** clip length to request (5 or 10) */
  videoSeconds: number
  /** how long the shot is on screen: the rest of the clip is cut off, and drift after this point does not matter */
  durationSec: number
  motionPrompt: string
  /** absolute path of the shot's approved keyframe */
  keyframe: string
  /** the spoken line of a dialogue shot (absolute path): the clip is lip-synced to it */
  speech: { file: string } | null
  /** the characters in the shot, with their references */
  cast: CastRef[]
}

export type ProduceOptions = {
  model: VideoModelId
  shots: ShotJob[]
  /** where the clips are written */
  workDir: string
  /** real video seconds this run may still use; one that does not fit stops the episode (there is no cheaper shot) */
  allowanceSec: number
  /** the style's own list of things that must not appear, added to the standard negative prompt */
  negative?: string
  /** asked before every paid call; false stops the episode */
  canSpend?: (usd: number) => Promise<boolean>
  /** injectable for tests */
  make?: (req: ClipRequest) => Promise<ClipResult>
  lipsync?: (req: LipsyncRequest) => Promise<LipsyncResult>
  /** the continuity check of a finished clip; absent = not checked */
  check?: (clip: string, job: ShotJob, attempt: number, clipSeconds: number) => Promise<ClipCheck>
  /** start with the strict prompt and the pinned end frame (used by "Fix shot", which remakes a clip that already looked wrong) */
  strictFirst?: boolean
  /** added to the file names, so a remake never overwrites the first clips (for example "fix1") */
  tag?: string
  /** called with each clip that passed, for the approved-frames gallery (one call at a time, even when shots run together) */
  onApproved?: (clip: string, job: ShotJob) => Promise<void>
  /** how many shots are made at the same time; default VIDEO_CONCURRENCY or 4 */
  concurrency?: number
  /** a retry of this episode: a clip or lip-sync result an earlier attempt left in `workDir` (made after its keyframe) is used instead of paying again */
  reuseExisting?: boolean
}

export type ProduceResult = {
  clips: VideoClip[]
  /** shot number -> final clip file (absolute) */
  files: Record<number, string>
  totalCostUsd: number
  totalSeconds: number
  /** money spent on continuity checks (tokens), reported separately from video */
  checkCostUsd: number
}

/**
 * Makes the video clip of every shot: keyframe -> clip -> (lip-sync for a spoken line) -> continuity check. A clip that drifts is
 * made again once with a stricter prompt; if it still drifts the episode stops and names the character and shot. A clip that
 * cannot be made at all stops the episode too: unlike before, no shot falls back to a cheaper renderer.
 *
 * Shots do not depend on each other (each starts from its own approved keyframe), so up to `concurrency` of them are made at the
 * same time. When one fails no new shot is started, the ones already running finish (they are already paid for), and the error of
 * the earliest failed shot is thrown with everything that was spent.
 */
export async function produceVideoShots(opts: ProduceOptions): Promise<ProduceResult> {
  const make = opts.make ?? makeClip
  const lipsync = opts.lipsync ?? makeLipsync
  const clips: VideoClip[] = []
  const files: Record<number, string> = {}
  let left = opts.allowanceSec
  let video = 0, seconds = 0, checks = 0

  const ask = async (usd: number) => { if (opts.canSpend && !(await opts.canSpend(usd))) throw new BudgetError('Cost cap reached before the video was finished.') }
  // the approved-frames gallery is a folder of files per character: one writer at a time
  let approvedChain: Promise<unknown> = Promise.resolve()
  const approved = (clip: string, job: ShotJob) => (approvedChain = approvedChain.catch(() => undefined).then(() => opts.onApproved?.(clip, job)))

  async function runShot(job: ShotJob) {
    const estimatedUsd = videoCostUsd(opts.model, job.videoSeconds)
    const base = { shot: job.n, model: opts.model, seconds: job.videoSeconds, estimatedUsd }
    let shotCost = 0
    let lipsyncInfo: VideoClip['lipsync']
    let last: ClipCheck | null = null
    let attempts = 0
    let done = false

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
      attempts = attempt
      if (job.videoSeconds > left) throw new BudgetError(`Shot ${job.n}: the video-second budget is used up.`)
      // the seconds are held back before anything is awaited, so shots running together never share the same seconds twice
      left -= job.videoSeconds
      try { await ask(estimatedUsd) } catch (e) { left += job.videoSeconds; throw e }
      const strict = attempt > 1 || opts.strictFirst === true
      const clipFile = path.join(opts.workDir, `shot-${job.n}${opts.tag ?? ''}-a${attempt}.mp4`)
      let r: ClipResult
      try {
        r = opts.reuseExisting && await reusableFile(clipFile, [job.keyframe])
          ? { file: clipFile, seconds: await probeDuration(clipFile), costUsd: 0, model: opts.model, remoteUrl: 'episode-folder', cached: true }
          : await make({
            model: opts.model, imageFile: job.keyframe, seconds: job.videoSeconds,
            prompt: `${job.motionPrompt} ${strict ? KEEP_LOOK_STRICT : KEEP_LOOK}`, negativePrompt: opts.negative ? `${NEGATIVE}, ${opts.negative}` : NEGATIVE,
            destFile: clipFile,
            ...(strict && VIDEO_MODELS[opts.model].endFrame ? { tailImageFile: job.keyframe } : {}),
          })
      } catch (e) {
        left += job.videoSeconds
        const msg = e instanceof VideoError ? `${e.kind}: ${e.message}` : (e as Error).message
        clips.push({ ...base, costUsd: shotCost, status: 'failed', error: msg.slice(0, 200) })
        throw new Error(`Shot ${job.n}: the video clip could not be made (${msg.slice(0, 160)}).`)
      }
      // mock and library (cached) clips are free: they must not use up the video seconds
      if (r.mock || r.cached) left += job.videoSeconds
      else { left += job.videoSeconds - r.seconds; seconds += r.seconds }
      video += r.costUsd
      shotCost += r.costUsd
      let file = r.file

      if (job.speech) {
        await ask(0.1)
        try {
          const lipFile = path.join(opts.workDir, `shot-${job.n}${opts.tag ?? ''}-a${attempt}-lip.mp4`)
          const l = opts.reuseExisting && await reusableFile(lipFile, [file, job.speech.file])
            ? { file: lipFile, costUsd: 0, model: DEFAULT_LIPSYNC_MODEL }
            : await lipsync({ videoFile: file, audioFile: job.speech.file, destFile: lipFile })
          // the model cuts the clip to the length of the line: the rest of the shot is taken from the original clip
          file = await keepFullLength(l.file, file, path.join(opts.workDir, `shot-${job.n}${opts.tag ?? ''}-a${attempt}-full.mp4`))
          video += l.costUsd
          shotCost += l.costUsd
          lipsyncInfo = { model: l.model, costUsd: l.costUsd }
        } catch (e) {
          const msg = e instanceof VideoError ? `${e.kind}: ${e.message}` : (e as Error).message
          clips.push({ ...base, costUsd: shotCost, status: 'failed', error: `lip-sync: ${msg}`.slice(0, 200) })
          throw new Error(`Shot ${job.n}: the lip-sync failed (${msg.slice(0, 160)}).`)
        }
      }

      if (!opts.check) { files[job.n] = file; done = true; clips.push({ ...base, seconds: r.seconds, costUsd: shotCost, status: r.mock ? 'mock' : 'generated', file, ...(lipsyncInfo ? { lipsync: lipsyncInfo } : {}) }); break }

      await ask(0.01)
      last = await opts.check(file, job, attempt, r.seconds)
      checks += last.costUsd
      if (last.verdict.ok) {
        files[job.n] = file
        done = true
        const continuity: ClipContinuity = { ok: true, attempts: attempt, scores: Object.fromEntries(last.result.characters.map((c) => [c.name, c.sameIdentity])), issues: [] }
        clips.push({ ...base, seconds: r.seconds, costUsd: shotCost, status: r.mock ? 'mock' : 'generated', file, continuity, ...(lipsyncInfo ? { lipsync: lipsyncInfo } : {}) })
        await approved(file, job)
      }
    }

    if (!done) {
      const v = last!.verdict
      clips.push({ ...base, costUsd: shotCost, status: 'drifted', continuity: { ok: false, attempts, scores: Object.fromEntries(last!.result.characters.map((c) => [c.name, c.sameIdentity])), issues: v.issues } })
      throw new ContinuityError(`Shot ${job.n}: ${v.issues.join('; ')} (after ${attempts} attempts).`, job.n, v.worst?.name ?? v.undeclared[0] ?? 'unknown')
    }
  }

  const failures = await runPool(opts.shots, opts.concurrency ?? videoConcurrency(), (job) => runShot(job))
  if (failures.length) {
    // the clips already paid for are still the episode's cost, even though it stops here
    throw withSpend(failures[0].error as Error, video + checks, seconds)
  }
  clips.sort((a, b) => a.shot - b.shot)
  return { clips, files, totalCostUsd: Math.round(video * 100) / 100, totalSeconds: seconds, checkCostUsd: Math.round(checks * 10000) / 10000 }
}
