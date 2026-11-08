import 'server-only'
import type { Payload } from 'payload'
import type { Character, Series, User } from '@/payload-types'
import type { SeriesProfile, VoiceMode, VoiceProfile } from '@/agents/profile'
import { stylePrompt } from '@/lib/styles/prompts'
import { runEpisode, type RunOutcome, type Store } from './orchestrator'
import { formatCountdown, nextState, type Frequency } from '@/lib/schedule'
import { pipelineMode, STEPS, type StepKey } from './steps'
import { videoBudgetFor } from './video-budget'
import { buildMediaCtx } from './media-setup'

export class PipelineError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const STALE_MS = 30 * 60 * 1000
const DURATION: Record<string, number> = { 'story-reel': 45, 'quick-reel': 25, 'long-form': 180 }

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

/** Creates the episode row and rejects overlapping runs and exhausted budgets. The caller then runs `executeEpisode`. */
export async function startEpisode(payload: Payload, user: User, seriesId: string | number) {
  const series = await loadOwnedSeries(payload, user, seriesId)
  const { docs: running } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: series.id } }, { status: { equals: 'running' } }] }, depth: 0, limit: 5, overrideAccess: true })
  for (const e of running) {
    if (Date.now() - new Date(e.createdAt).getTime() > STALE_MS) {
      await payload.update({ collection: 'episodes', id: e.id, data: { status: 'failed', error: 'Timed out' }, overrideAccess: true })
    } else {
      throw new PipelineError('An episode is already being generated for this series.', 409)
    }
  }
  if ((series.spentUsd ?? 0) >= (series.costCapUsd ?? 5)) throw new PipelineError('The cost cap for this series is reached.', 402)
  // Same lock as the dashboard card (plan §7): the next episode unlocks one interval after the last one.
  // Failed episodes do not count, so a failed run can be retried right away.
  const { docs: last } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: series.id } }, { status: { not_equals: 'failed' } }] }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
  const lock = nextState(series.frequency as Frequency, last[0] ? new Date(last[0].createdAt) : null)
  if (lock.state === 'locked') throw new PipelineError(`The next episode unlocks in ${formatCountdown(lock.remainingMs)}.`, 423)
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
    style: { id: series.style, promptTemplate: stylePrompt(series.style) },
    format: series.format, durationTargetSec: DURATION[series.format] ?? 45, aspect: series.aspect,
    voiceMode: series.voiceMode as VoiceMode, narrator,
    cast: cast.map((c) => ({ name: c.name, canonical: c.canonicalDescription || bibleLook(c) || c.name, voiceProfile: voiceOf(c) })),
    referencePatterns: REFERENCE_PATTERNS, qualityTier: series.qualityTier,
  }
}

/** Runs the whole episode and records every step so the dashboard can show live progress. Never throws. */
export async function executeEpisode(payload: Payload, episodeId: string | number, delayMs = 900): Promise<RunOutcome> {
  try {
    const episode = await payload.findByID({ collection: 'episodes', id: episodeId, depth: 0, overrideAccess: true })
    const seriesId = idOf(episode.series)
    const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
    const { docs: cast } = await payload.find({ collection: 'characters', where: { series: { equals: seriesId } }, depth: 0, limit: 20, overrideAccess: true })
    const { docs: past } = await payload.find({ collection: 'episodes', where: { and: [{ series: { equals: seriesId } }, { id: { not_equals: episodeId } }] }, sort: '-createdAt', limit: 10, depth: 0, overrideAccess: true })
    const ownerId = idOf(episode.owner) as number

    const rows = new Map<StepKey, string | number>()
    for (const [order, s] of STEPS.entries()) {
      const row = await payload.create({ collection: 'pipeline-steps', overrideAccess: true, data: { owner: ownerId, episode: episode.id, agent: s.agent, stepKey: s.key, label: s.label, order, status: 'pending' } })
      rows.set(s.key, row.id)
    }
    const rowId = (k: StepKey) => rows.get(k) as string | number
    const update = (k: StepKey, data: Record<string, unknown>) => payload.update({ collection: 'pipeline-steps', id: rowId(k), data, overrideAccess: true })

    const store: Store = {
      stepStart: async (k, note) => { await update(k, { status: 'running', startedAt: new Date().toISOString(), ...(note ? { summary: note } : {}) }) },
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
        return (s.spentUsd ?? 0) + extra <= (s.costCapUsd ?? 5)
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
    const media = await buildMediaCtx(payload, { episodeId, seriesId, cast, tier: series.qualityTier, aspect: series.aspect })
    // with real media the work itself takes time, so the simulated delay is only for the fixture-only run
    return await runEpisode({ profile, seriesId, mode, delayMs: mode === 'mock' && !media ? delayMs : 0, video: videoBudgetFor(series, profile.durationTargetSec), ...(media ? { media } : {}) }, store, past.map((e) => e.title ?? '').filter(Boolean))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[pipeline] run failed:', message)
    await payload.update({ collection: 'episodes', id: episodeId, data: { status: 'failed', error: message }, overrideAccess: true }).catch(() => {})
    return { status: 'failed', reason: message, costUsd: 0 }
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
