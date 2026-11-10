import 'server-only'
import type { Payload } from 'payload'
import type { Character, Series, User } from '@/payload-types'
import type { SeriesProfile, VoiceMode, VoiceProfile } from '@/agents/profile'
import { REEL_TARGET_SEC } from '@/lib/format'
import { expressionsOfBible, imageStyle, lookFor, motionStyle, negativeList, styleSummary, transitionsFor } from '@/lib/styles/bible'
import { runEpisode, type Resume, type RunOutcome, type Store } from './orchestrator'
import { dailyCapUsd, dailyState, DAY_MS, formatCountdown, type DailyState } from '@/lib/daily-limit'
import { pipelineMode, STEPS, type StepKey } from './steps'
import { videoBudgetFor } from './video-budget'
import { buildMediaCtx } from './media-setup'
import { DEFAULT_SERIES_CAP_USD, episodeCeilingUsd } from './budget'
import { pickResume } from './resume'
import { ownResume, retryPlan, savedEpisodeParts, type RetryPlan } from './retry'
import { readMemory, rememberEpisode } from './memory'
import { DROPPED_IDEA_ERROR } from '@/lib/series-state'
import { loadMediaState } from './media-ctx'
import { fixShot, fixShotEstimateUsd, shotJobFrom } from './fix-shot'
import { createMedia } from '../media'
import { openWorkspace } from '../media/workspace'
import { sizeFor } from '../engine/aspect'
import type { ContinueState } from './orchestrator'
import type { ReelQaFlag } from './schemas'
import { tokenOptimization } from '../agents/optimization'

export class PipelineError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const STALE_MS = 30 * 60 * 1000

// Patterns learned from reference pages (plan §4b-2). Topic-neutral on purpose.
const REFERENCE_PATTERNS = [
  { premiseFormula: 'two contrasting friends attempt a wild DIY plan, it escalates, funny payoff', shotRhythm: 'a new camera angle every 2-4 seconds; wide, close-up reactions, one dramatic angle, payoff shot', captionFormat: 'one short playful sentence + 1-2 emojis + 3 hashtags' },
]

const idOf = (v: unknown) => (typeof v === 'object' && v ? (v as { id: string | number }).id : (v as string | number))

async function loadOwnedSeries(payload: Payload, user: User, seriesId: string | number) {
  const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!series || idOf(series.owner) !== user.id || series.status === 'removed') throw new PipelineError('Series not found', 404)
  return series
}

/**
 * Everything that must hold before a video is made: the folder is chosen, no other video of the series is running or waiting for
 * review, and the series cost cap, the daily cost cap and (when this video will count as one) the daily video limit allow it.
 * Shared by a new video and by the retry of a failed one.
 */
async function assertCanRun(payload: Payload, user: User, series: Series, opts: { countsAsDailyVideo?: boolean } = {}) {
  const countsAsDailyVideo = opts.countsAsDailyVideo ?? true
  // Videos are saved into the user's own folder (plan §6): generation starts once access is given.
  if (!series.folderLinked) throw new PipelineError('Choose a folder for this series first. Generation starts once the app can save your videos there.', 428)
  const { docs: running } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: series.id } }, { status: { equals: 'running' } }] }, depth: 0, limit: 5, overrideAccess: true })
  for (const e of running) {
    if (Date.now() - new Date(e.createdAt).getTime() > STALE_MS) {
      await payload.update({ collection: 'episodes', id: e.id, data: { status: 'failed', error: 'Timed out' }, overrideAccess: true })
    } else {
      throw new PipelineError('An episode is already being generated for this series.', 409)
    }
  }
  const { docs: waiting } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: series.id } }, { status: { equals: 'awaiting-approval' } }] }, depth: 0, limit: 1, overrideAccess: true })
  if (waiting.length) throw new PipelineError('A video is waiting for your review. Approve it or ask for a different idea first.', 409)
  if ((series.spentUsd ?? 0) >= (series.costCapUsd ?? DEFAULT_SERIES_CAP_USD)) throw new PipelineError('The cost cap for this series is reached.', 402)
  // Per-user daily limit across all their series (plan §3b), for manual and scheduled runs alike.
  const cap = dailyCapUsd()
  if ((await ownerSpentSince(payload, user.id, new Date(Date.now() - DAY_MS))) >= cap) throw new PipelineError(`The daily cost limit ($${cap.toFixed(2)}) is reached. Try again tomorrow.`, 402)
  // At most 3 videos in any 24 hours, across all of the user's series (plan R1-C). A failed run does not count, so it can be retried.
  if (countsAsDailyVideo) {
    const daily = await getDailyState(payload, user.id)
    if (daily.left <= 0 && daily.nextAt) throw new PipelineError(`You can make ${daily.limit} videos a day. The next one is available in ${formatCountdown(daily.nextAt.getTime() - Date.now())}.`, 423)
  }
}

/** Creates the episode row and rejects overlapping runs and exhausted budgets. The caller then runs `executeEpisode`. */
export async function startEpisode(payload: Payload, user: User, seriesId: string | number) {
  const series = await loadOwnedSeries(payload, user, seriesId)
  await assertCanRun(payload, user, series)
  const mode = pipelineMode()
  const episode = await payload.create({ collection: 'episodes', data: { owner: user.id, series: series.id, status: 'running', mode, title: 'New episode' }, overrideAccess: true })
  // Two requests can pass the checks above at the same moment. After inserting, the OLDEST running episode wins and
  // the other backs off, so only one run ever executes per series (works across server processes too).
  const { docs: runningNow } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: series.id } }, { status: { equals: 'running' } }] }, sort: 'id', limit: 1, depth: 0, overrideAccess: true })
  if (runningNow[0] && runningNow[0].id !== episode.id) {
    await payload.delete({ collection: 'episodes', id: episode.id, overrideAccess: true })
    throw new PipelineError('An episode is already being generated for this series.', 409)
  }
  return { episodeId: episode.id, mode }
}

function buildProfile(series: Series, cast: Character[]): SeriesProfile {
  const voiceOf = (c: Character): VoiceProfile | null => (c.voiceProfile?.voice ? { voice: c.voiceProfile.voice, instructions: c.voiceProfile.instructions ?? undefined } : null)
  const narrator = series.narratorVoice && typeof series.narratorVoice === 'object' ? (series.narratorVoice as VoiceProfile) : null
  const bibleLook = (c: Character) => (c.bible && typeof c.bible === 'object' ? ((c.bible as { look?: string }).look ?? '') : '')
  return {
    niche: series.niche, subNiche: series.subNiche ?? undefined,
    style: {
      id: series.style, promptTemplate: styleSummary(series.styleBible, series.style), imagePrompt: imageStyle(series.styleBible, series.style),
      motion: motionStyle(series.styleBible, series.style), negative: negativeList(series.styleBible, series.style),
      look: lookFor(series.styleBible, series.style), transitions: transitionsFor(series.styleBible, series.style),
    },
    durationTargetSec: REEL_TARGET_SEC, expressions: expressionsOfBible(series.styleBible, series.style), aspect: series.aspect,
    voiceMode: series.voiceMode as VoiceMode, narrator,
    cast: cast.map((c) => ({ name: c.name, canonical: c.canonicalDescription || bibleLook(c) || c.name, voiceProfile: voiceOf(c) })),
    referencePatterns: REFERENCE_PATTERNS,
  }
}

/** Runs the whole episode and records every step so the dashboard can show live progress. Never throws. */
export async function executeEpisode(payload: Payload, episodeId: string | number, delayMs = 900, opts: {
  scheduled?: boolean
  /** the user approved a paused video: continue from the Editor step */
  approved?: boolean
  /** the user retried a failed video: continue from what it saved (see `retryPlan`) */
  retry?: boolean
} = {}): Promise<RunOutcome> {
  try {
    const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true })
    const seriesId = idOf(episode.series)
    const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
    const { docs: cast } = await payload.find({ collection: 'characters', where: { series: { equals: seriesId } }, depth: 0, limit: 20, overrideAccess: true })
    const { docs: past } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: seriesId } }, { id: { not_equals: episodeId } }] }, sort: '-createdAt', limit: 10, depth: 0, overrideAccess: true })
    const ownerId = idOf(episode.owner) as number

    const rows = new Map<StepKey, string | number>()
    // an approved or retried episode keeps the step rows it already has (they show the finished steps); only missing ones are made
    if (opts.approved || opts.retry) {
      const { docs } = await payload.find({ collection: 'pipeline-steps', where: { episode: { equals: episode.id } }, limit: 50, depth: 0, overrideAccess: true })
      for (const d of docs) rows.set(d.stepKey as StepKey, d.id)
    }
    for (const [order, s] of STEPS.entries()) {
      if (rows.has(s.key)) continue
      const row = await payload.create({ collection: 'pipeline-steps', overrideAccess: true, data: { owner: ownerId, episode: episode.id, agent: s.agent, stepKey: s.key, label: s.label, order, status: 'pending' } })
      rows.set(s.key, row.id)
    }
    const rowId = (k: StepKey) => rows.get(k) as string | number
    const update = (k: StepKey, data: Record<string, unknown>) => payload.update({ collection: 'pipeline-steps', id: rowId(k), data, overrideAccess: true })

    const store: Store = {
      stepStart: async (k, note) => { await update(k, { status: 'running', startedAt: new Date().toISOString(), endedAt: null, summary: note ?? '' }) },
      stepDone: async (k, r) => {
        // A step can run several times (Writer/Critic revisions): accumulate usage instead of overwriting it.
        const prev = r.usage ? await payload.findByID({ collection: 'pipeline-steps', id: rowId(k), depth: 0, overrideAccess: true }) : null
        const add = (a: number | null | undefined, b: number) => (a ?? 0) + b
        await update(k, {
          status: 'done', endedAt: new Date().toISOString(), summary: r.summary,
          ...(r.usage && prev ? {
            model: r.usage.model, inputTokens: add(prev.inputTokens, r.usage.inputTokens), cachedTokens: add(prev.cachedTokens, r.usage.cachedTokens),
            outputTokens: add(prev.outputTokens, r.usage.outputTokens), reasoningTokens: add(prev.reasoningTokens, r.usage.reasoningTokens), costUsd: add(prev.costUsd, r.usage.costUsd), imageCount: add(prev.imageCount, r.usage.images ?? 0), videoSeconds: add(prev.videoSeconds, r.usage.videoSeconds ?? 0),
          } : {}),
        })
      },
      stepFail: async (k, message) => { await update(k, { status: 'failed', endedAt: new Date().toISOString(), summary: message }) },
      episodePatch: async (patch) => { await payload.update({ collection: 'episodes', id: episodeId, data: patch as never, overrideAccess: true }) },
      budgetOk: async (extra) => {
        const s = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
        return (s.spentUsd ?? 0) + extra <= (s.costCapUsd ?? DEFAULT_SERIES_CAP_USD)
      },
      episodeDone: async ({ idea, script }) => {
        // the series remembers this video: its idea, its running gag, and any supporting character the story marked as recurring
        const s = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
        await payload.update({ collection: 'series', id: seriesId, data: { memory: rememberEpisode(readMemory(s.memory), { idea, script }) as never }, overrideAccess: true })
      },
      addSpend: async (usd, videoSeconds = 0) => {
        const s = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
        await payload.update({
          collection: 'series', id: seriesId, overrideAccess: true,
          data: { spentUsd: (s.spentUsd ?? 0) + usd, ...(videoSeconds ? { videoSpentSec: (s.videoSpentSec ?? 0) + videoSeconds } : {}) },
        })
      },
    }

    const mode = pipelineMode()
    const profile = buildProfile(series, cast)
    const media = await buildMediaCtx(payload, { episodeId, seriesId, cast })
    // with real media the work itself takes time, so the simulated delay is only for the fixture-only run
    const ctx = {
      profile, seriesId, mode, memory: readMemory(series.memory), delayMs: mode === 'mock' && !media ? delayMs : 0, video: videoBudgetFor(series),
      episodeCeilingUsd: episodeCeilingUsd(profile.durationTargetSec, videoBudgetFor(series).model), scheduled: opts.scheduled === true,
      ...(media ? { media } : {}),
    }
    // an approved video continues from what was saved when it paused; otherwise the series' switch decides whether to pause for review
    let continueFrom: ContinueState | undefined
    // a retried video reuses its own approved idea and script, whatever TOKEN_OPTIMIZATION says: nothing is paid for twice
    let resume: Resume | null = opts.approved || opts.retry ? null : (!tokenOptimization() ? null : pickResume(past))
    if (opts.approved) {
      const saved = savedEpisodeParts(episode)
      if (!saved) throw new Error('This video cannot be continued: its saved story or shots are missing.')
      continueFrom = saved
      if (media) Object.assign(media.state, loadMediaState(media.ws.episodeDir) ?? {})
    } else if (opts.retry) {
      // from the Editor when its shots and every keyframe are still there; otherwise from the Art Director with the approved script
      const saved = savedEpisodeParts(episode)
      const state = media ? loadMediaState(media.ws.episodeDir) : null
      const keyframesKept = !media || (!!saved && !!state && saved.shots.shots.every((x) => state.keyframes?.[x.n]))
      if (saved && keyframesKept) {
        continueFrom = saved
        if (media && state) Object.assign(media.state, state)
        // the clips and lip-sync results of the failed attempt were paid for: they are used again, not made again
        if (media) media.reuseClips = true
      } else {
        resume = ownResume(episode)
      }
    }
    return await runEpisode(
      ctx, store, past.map((e) => e.title ?? '').filter(Boolean), resume,
      { review: !continueFrom && series.reviewBeforeVideo === true, continueFrom, startingCostUsd: opts.approved || opts.retry ? (episode.costUsd ?? 0) : 0 },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[pipeline] run failed:', message)
    await payload.update({ collection: 'episodes', id: episodeId, data: { status: 'failed', error: message }, overrideAccess: true }).catch(() => {})
    return { status: 'failed', reason: message, costUsd: 0 }
  }
}

/** How many of the daily videos the user has used (episodes in the last 24 hours that did not fail), across all their series. */
export async function getDailyState(payload: Payload, ownerId: string | number): Promise<DailyState> {
  const since = new Date(Date.now() - DAY_MS).toISOString()
  const { docs } = await payload.find({
    collection: 'episodes', where: { and: [{ owner: { equals: ownerId } }, { status: { not_equals: 'failed' } }, { createdAt: { greater_than: since } }] },
    limit: 100, depth: 0, overrideAccess: true,
  })
  return dailyState(docs.map((e) => new Date(e.createdAt)))
}

/** What a user's episodes cost since `since` (all their series together), for the daily cost cap. */
export async function ownerSpentSince(payload: Payload, ownerId: string | number, since: Date): Promise<number> {
  let total = 0
  for (let page = 1; ; page++) {
    const r = await payload.find({ collection: 'episodes', where: { and: [{ owner: { equals: ownerId } }, { createdAt: { greater_than: since.toISOString() } }] }, limit: 200, page, depth: 0, overrideAccess: true })
    for (const e of r.docs) total += e.costUsd ?? 0
    if (!r.hasNextPage) return total
  }
}

export async function getProgress(payload: Payload, user: User, episodeId: string | number) {
  const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!episode || idOf(episode.owner) !== user.id) throw new PipelineError('Episode not found', 404)
  const { docs } = await payload.find({ collection: 'pipeline-steps', where: { episode: { equals: episode.id } }, sort: 'order', limit: 50, depth: 0, overrideAccess: true })
  return {
    episode: { id: episode.id, status: episode.status, title: episode.title, error: episode.error ?? null, costUsd: episode.costUsd ?? 0, mode: episode.mode ?? null },
    steps: docs.map((s) => ({ key: s.stepKey, agent: s.agent, label: s.label ?? s.agent, status: s.status, summary: s.summary ?? '' })),
  }
}

/**
 * What the user chose for a video that is waiting for review (plan R3, "Review before video"):
 *  - 'approve': the clips are made now (the caller runs `executeEpisode(..., { approved: true })`);
 *  - 'new-idea': this video is dropped (it does not count as one of the day's videos, what it cost stays booked) and a new one starts, which will not repeat its idea.
 */
export async function reviewEpisode(payload: Payload, user: User, episodeId: string | number, action: 'approve' | 'new-idea'): Promise<{ episodeId: string | number; action: 'approve' | 'new-idea' }> {
  const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!episode || idOf(episode.owner) !== user.id) throw new PipelineError('Episode not found', 404)
  if (episode.status !== 'awaiting-approval') throw new PipelineError('This video is not waiting for review.', 409)
  if (action === 'approve') {
    if (!savedEpisodeParts(episode)) throw new PipelineError('This video cannot be continued: its saved story or shots are missing.', 409)
    await payload.update({ collection: 'episodes', id: episode.id, data: { status: 'running', error: null }, overrideAccess: true })
    return { episodeId: episode.id, action }
  }
  await payload.update({ collection: 'episodes', id: episode.id, data: { status: 'failed', error: DROPPED_IDEA_ERROR }, overrideAccess: true })
  const next = await startEpisode(payload, user, idOf(episode.series))
  return { episodeId: next.episodeId, action }
}

/**
 * Retry of a failed video, from the step where it stopped (see `retryPlan`): the same episode goes back to running, keeps its
 * finished steps and what it already cost, and the caller runs `executeEpisode(..., { retry: true })`. It needs the same room as a
 * new video (nothing else running, caps not reached, and a daily video left if this one will count as one).
 */
export async function retryEpisode(payload: Payload, user: User, episodeId: string | number): Promise<{ episodeId: string | number; plan: RetryPlan }> {
  const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!episode || idOf(episode.owner) !== user.id) throw new PipelineError('Episode not found', 404)
  if (episode.status !== 'failed' || episode.error === DROPPED_IDEA_ERROR) throw new PipelineError('Only a video that failed can be retried.', 409)
  const series = await loadOwnedSeries(payload, user, idOf(episode.series))
  // a failed video is not one of the day's videos, but a finished one will be (if it was made in the last 24 hours)
  const countsAsDailyVideo = Date.now() - new Date(episode.createdAt).getTime() < DAY_MS
  await assertCanRun(payload, user, series, { countsAsDailyVideo })
  await payload.update({ collection: 'episodes', id: episode.id, data: { status: 'running', error: null }, overrideAccess: true })
  return { episodeId: episode.id, plan: retryPlan(episode) }
}

type FixingFiles = { master?: string; fixing?: { shot: number; at: string } | null; fixError?: string | null; [k: string]: unknown }

/** Checks a "Fix shot" request and marks the episode as being fixed. The caller then runs `executeFix`. Returns the expected cost. */
export async function startFix(payload: Payload, user: User, episodeId: string | number, shotNumber: number) {
  const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!episode || idOf(episode.owner) !== user.id) throw new PipelineError('Episode not found', 404)
  const series = await payload.findByID({ collection: 'series', id: idOf(episode.series), depth: 0, overrideAccess: true })
  const files = (episode.files ?? {}) as FixingFiles
  if (episode.status !== 'done' || !files.master) throw new PipelineError('Only a finished video can have a shot fixed.', 409)
  if (files.fixing && Date.now() - new Date(files.fixing.at).getTime() < STALE_MS) throw new PipelineError('A shot of this video is already being fixed.', 409)
  const saved = savedEpisodeParts(episode)
  const shot = saved?.shots.shots.find((x) => x.n === shotNumber)
  if (!saved || !shot) throw new PipelineError('That shot is not in this video.', 404)
  const model = videoBudgetFor(series).model
  const hasLine = saved.script.beats.some((b) => b.n === shot.beat && b.line && b.speaker && b.speaker !== 'narrator')
  const estimateUsd = fixShotEstimateUsd(model, shot.durationSec, hasLine)
  if ((series.spentUsd ?? 0) + estimateUsd > (series.costCapUsd ?? DEFAULT_SERIES_CAP_USD)) throw new PipelineError(`Remaking this shot (about $${estimateUsd.toFixed(2)}) would pass the cost cap of this series.`, 402)
  await payload.update({ collection: 'episodes', id: episode.id, data: { files: { ...files, fixing: { shot: shotNumber, at: new Date().toISOString() }, fixError: null } as never }, overrideAccess: true })
  return { estimateUsd }
}

/** Remakes the shot (see `fixShot`), books what it cost, and saves the new flags. Never throws: a failure is saved on the episode. */
export async function executeFix(payload: Payload, episodeId: string | number, shotNumber: number): Promise<{ ok: boolean; costUsd: number; error?: string }> {
  let spent = 0
  try {
    const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true })
    const seriesId = idOf(episode.series)
    const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
    const saved = savedEpisodeParts(episode)
    const shot = saved?.shots.shots.find((x) => x.n === shotNumber)
    if (!saved || !shot) throw new Error('That shot is not in this video.')
    const ws = openWorkspace(episode.id, seriesId)
    const state = loadMediaState(ws.episodeDir)
    if (!state) throw new Error('This video has no saved keyframes, so a shot cannot be remade.')
    const model = videoBudgetFor(series).model
    const media = createMedia({ ...ws, ...sizeFor('9:16') })
    const cap = series.costCapUsd ?? DEFAULT_SERIES_CAP_USD
    let paid = 0
    const flags = (Array.isArray(episode.qaFlags) ? episode.qaFlags : []) as ReelQaFlag[]
    const r = await fixShot({
      episodeDir: ws.episodeDir, job: shotJobFrom({ shot, script: saved.script, state, assetsDir: ws.assetsDir }), model, media, flags,
      negative: negativeList(series.styleBible, series.style),
      canSpend: async (usd) => { const ok = (series.spentUsd ?? 0) + paid + usd <= cap; if (ok) paid += usd; return ok },
    })
    spent = r.costUsd
    const files = (episode.files ?? {}) as FixingFiles
    const clips = (Array.isArray(episode.videoClips) ? episode.videoClips : []) as { shot: number; [k: string]: unknown }[]
    const nextClips = clips.map((c) => (c.shot === shotNumber ? { ...c, status: 'generated', costUsd: ((c.costUsd as number) ?? 0) + r.costUsd, ...(r.continuity ? { continuity: r.continuity } : {}) } : c))
    await payload.update({
      collection: 'episodes', id: episode.id, overrideAccess: true,
      data: { qaFlags: r.flags as never, videoClips: nextClips as never, costUsd: (episode.costUsd ?? 0) + r.costUsd, videoCostUsd: (episode.videoCostUsd ?? 0) + r.costUsd, files: { ...files, fixing: null, fixError: null } as never },
    })
    await payload.update({ collection: 'series', id: seriesId, data: { spentUsd: (series.spentUsd ?? 0) + r.costUsd, videoSpentSec: (series.videoSpentSec ?? 0) + r.videoSeconds }, overrideAccess: true })
    return { ok: true, costUsd: r.costUsd }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The shot could not be remade.'
    console.error('[fix-shot]', message)
    const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true }).catch(() => null)
    const files = ((episode?.files ?? {}) as FixingFiles)
    // paid work of a failed try is still money spent
    const paid = (e as { spentUsd?: number } | null)?.spentUsd ?? spent
    await payload.update({ collection: 'episodes', id: episodeId, data: { files: { ...files, fixing: null, fixError: message.slice(0, 200) } as never, ...(paid > 0 ? { costUsd: (episode?.costUsd ?? 0) + paid } : {}) }, overrideAccess: true }).catch(() => {})
    if (paid > 0 && episode) {
      const series = await payload.findByID({ collection: 'series', id: idOf(episode.series), depth: 0, overrideAccess: true }).catch(() => null)
      if (series) await payload.update({ collection: 'series', id: series.id, data: { spentUsd: (series.spentUsd ?? 0) + paid }, overrideAccess: true }).catch(() => {})
    }
    return { ok: false, costUsd: paid, error: message }
  }
}
