import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The orchestrator is replaced by a recorder: these tests are about WHAT a retry reuses and where it picks up, not about making a video.
const run = vi.hoisted(() => ({
  calls: [] as { resume: unknown; opts: Record<string, unknown>; ctx: { profile: { expressions?: string[] } } }[],
  media: null as unknown,
  touch: null as null | ((store: any) => Promise<void>),
}))
vi.mock('@/pipeline/orchestrator', () => ({
  runEpisode: vi.fn(async (ctx: never, store: unknown, _titles: string[], resume: unknown, opts: Record<string, unknown>) => {
    run.calls.push({ resume, opts, ctx })
    if (run.touch) await run.touch(store)
    return { status: 'done', costUsd: 0 }
  }),
}))
vi.mock('@/pipeline/media-setup', () => ({ buildMediaCtx: async () => run.media }))

import { executeEpisode, PipelineError, retryEpisode } from '@/pipeline/payload-store'
import { failedStepOf, ownResume, retryLabel, retryPlan, savedEpisodeParts } from '@/pipeline/retry'
import { DROPPED_IDEA_ERROR } from '@/lib/series-state'
import { saveMediaState } from '@/pipeline/media-ctx'
import { bibleFromSpec } from '@/lib/styles/bible'
import { styleSpec } from '@/lib/styles/catalogue'
import { fakePayload, goodScript, idea, type Doc } from './helpers'
import * as agents from '@/pipeline/agents'

let script: Awaited<ReturnType<typeof goodScript>>
let shots: unknown
let root = ''
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-'))
  script = await goodScript()
  shots = { shots: [1, 2, 3, 4].map((n) => ({ n, beat: n, type: 'action', durationSec: 3, videoSeconds: 5, characters: ['Mango'], description: 'd', keyframePrompt: 'k', motionPrompt: 'm', angle: 'wide' })), unfilmable: [] }
  void agents
})
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })
afterEach(() => { run.calls.length = 0; run.media = null; run.touch = null; vi.unstubAllEnvs() })

const critique = { approved: true, score: 9, notes: [], originalityRisk: false, policyRisk: false }
const user = { id: 7 } as never
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const seriesDoc = (over: Doc extends never ? never : Record<string, unknown> = {}): Doc => ({ id: 1, owner: 7, title: 'S', niche: 'Cats', style: 'pixar-3d', format: '15', voiceMode: 'character_voices', folderLinked: true, status: 'active', costCapUsd: 30, spentUsd: 1, videoModel: 'kling-2.5-turbo', ...over })
const failed = (over: Record<string, unknown> = {}): Doc => ({ id: 50, owner: 7, series: 1, status: 'failed', title: 'T', error: 'keyframe 50-shot-1-1 failed: Connection error.', createdAt: hoursAgo(1), costUsd: 0.17, ...over })
const withScript = { idea: idea(1), script: undefined as unknown, critique }
const savedStory = () => ({ ...withScript, script })
const savedShots = () => ({ ...savedStory(), shots })

describe('where a retry picks up (pure)', () => {
  it('continues from the Editor when the shots are saved, from the approved script when only the story is, and from the start otherwise', () => {
    expect(retryPlan(savedShots())).toBe('editor')
    expect(retryPlan(savedStory())).toBe('script')
    expect(retryPlan({})).toBe('start')
    expect(retryPlan({ idea: idea(1) })).toBe('start')
  })

  it('does not reuse a script the Critic did not approve', () => {
    expect(ownResume({ ...savedStory(), critique: { ...critique, approved: false } })).toBeNull()
    expect(ownResume({ idea: idea(1), script })).toBeNull()
    expect(ownResume(savedStory())).toMatchObject({ idea: { title: idea(1).title }, script: { title: script.title } })
  })

  it('treats empty or malformed saved shots as not saved', () => {
    expect(savedEpisodeParts({ ...savedStory(), shots: { shots: [] } })).toBeNull()
    expect(savedEpisodeParts({ ...savedStory(), shots: 'nope' })).toBeNull()
    expect(savedEpisodeParts(savedShots())).not.toBeNull()
  })

  it('names the agent whose step failed on the button, and says "Try again" when nothing had started', () => {
    expect(retryLabel('art-director')).toBe('Retry from Art Director')
    expect(retryLabel('editor-clips')).toBe('Retry from Editor')
    expect(retryLabel('story-builder')).toBe('Retry from Story Builder')
    expect(retryLabel('orchestrator-plan')).toBe('Try again')
    expect(retryLabel(null)).toBe('Try again')
    expect(retryLabel('something-else')).toBe('Try again')
    expect(failedStepOf([{ stepKey: 'creator', status: 'done' }, { stepKey: 'art-director', status: 'failed' }, { stepKey: 'editor-clips', status: 'pending' }])).toBe('art-director')
    expect(failedStepOf([{ stepKey: 'creator', status: 'pending' }])).toBeNull()
  })
})

describe('retryEpisode: who may retry what', () => {
  it('puts a failed video back to running, clears its error, keeps its cost, and says where it will pick up', async () => {
    const { payload, db } = fakePayload({ episodes: [failed({ ...savedStory() })], series: [seriesDoc()] })
    expect(await retryEpisode(payload, user, 50)).toEqual({ episodeId: 50, plan: 'script' })
    expect(db.episodes[0]).toMatchObject({ status: 'running', error: null, costUsd: 0.17 })
  })

  it('reports each plan', async () => {
    for (const [data, plan] of [[savedShots(), 'editor'], [savedStory(), 'script'], [{}, 'start']] as const) {
      const { payload } = fakePayload({ episodes: [failed({ ...data })], series: [seriesDoc()] })
      expect((await retryEpisode(payload, user, 50)).plan).toBe(plan)
    }
  })

  it('only retries a video that failed: not a finished, running, waiting or reviewed one, and not one dropped for a new idea', async () => {
    for (const status of ['done', 'running', 'awaiting-approval', 'needs-review']) {
      const { payload } = fakePayload({ episodes: [failed({ status })], series: [seriesDoc()] })
      await expect(retryEpisode(payload, user, 50)).rejects.toMatchObject({ status: status === 'running' ? 409 : 409 })
    }
    const dropped = fakePayload({ episodes: [failed({ error: DROPPED_IDEA_ERROR })], series: [seriesDoc()] })
    await expect(retryEpisode(dropped.payload, user, 50)).rejects.toThrow(/Only a video that failed/)
  })

  it('is only for the owner, and the video must exist', async () => {
    const { payload } = fakePayload({ episodes: [failed()], series: [seriesDoc()] })
    await expect(retryEpisode(payload, { id: 99 } as never, 50)).rejects.toMatchObject({ status: 404 })
    await expect(retryEpisode(payload, user, 777)).rejects.toMatchObject({ status: 404 })
  })

  it('cannot be started twice: the second click finds it already running', async () => {
    const { payload } = fakePayload({ episodes: [failed()], series: [seriesDoc()] })
    await retryEpisode(payload, user, 50)
    await expect(retryEpisode(payload, user, 50)).rejects.toBeInstanceOf(PipelineError)
  })

  it('needs the same room as a new video: folder, nothing else running or waiting, and the series cost cap', async () => {
    const folder = fakePayload({ episodes: [failed()], series: [seriesDoc({ folderLinked: false })] })
    await expect(retryEpisode(folder.payload, user, 50)).rejects.toMatchObject({ status: 428 })
    const busy = fakePayload({ episodes: [failed(), { id: 51, owner: 7, series: 1, status: 'running', createdAt: new Date().toISOString() }], series: [seriesDoc()] })
    await expect(retryEpisode(busy.payload, user, 50)).rejects.toThrow(/already being generated/)
    const waiting = fakePayload({ episodes: [failed(), { id: 51, owner: 7, series: 1, status: 'awaiting-approval', createdAt: new Date().toISOString() }], series: [seriesDoc()] })
    await expect(retryEpisode(waiting.payload, user, 50)).rejects.toThrow(/waiting for your review/)
    const capped = fakePayload({ episodes: [failed()], series: [seriesDoc({ spentUsd: 30 })] })
    await expect(retryEpisode(capped.payload, user, 50)).rejects.toMatchObject({ status: 402 })
  })

  it('respects the 3 videos a day, because a finished retry will count as one (a failed video did not)', async () => {
    const three = [60, 61, 62].map((id) => ({ id, owner: 7, series: 1, status: 'done', createdAt: hoursAgo(2), costUsd: 0 }))
    const full = fakePayload({ episodes: [failed(), ...three], series: [seriesDoc()] })
    await expect(retryEpisode(full.payload, user, 50)).rejects.toMatchObject({ status: 423 })
    // made more than 24 hours ago, so finishing it does not use up a video of today
    const old = fakePayload({ episodes: [failed({ createdAt: hoursAgo(30) }), ...three], series: [seriesDoc()] })
    expect((await retryEpisode(old.payload, user, 50)).episodeId).toBe(50)
  })
})

describe('executeEpisode with retry: what is reused', () => {
  /** Episode 50 with its nine step rows: the first ones done, the failed one marked failed, the rest pending. */
  const withRows = (failedKey: string, extra: Record<string, unknown> = {}, seriesOver: Record<string, unknown> = {}) => {
    const keys = ['orchestrator-plan', 'creator', 'story-builder', 'style', 'art-director', 'editor-clips', 'editor-assemble', 'publisher', 'orchestrator-final']
    const at = keys.indexOf(failedKey)
    const rows = keys.map((stepKey, i) => ({ id: 200 + i, episode: 50, owner: 7, stepKey, order: i, status: i < at ? 'done' : i === at ? 'failed' : 'pending', summary: i === at ? 'keyframe 50-shot-1-1 failed: Connection error.' : '', endedAt: i <= at ? 'x' : null }))
    return fakePayload({ episodes: [failed({ status: 'running', error: null, ...extra })], series: [seriesDoc(seriesOver)], 'pipeline-steps': rows })
  }

  it('from the Editor: reuses the story and shots, keeps the money already spent, and does not pause for review again', async () => {
    const { payload, db } = withRows('editor-clips', savedShots(), { reviewBeforeVideo: true })
    await executeEpisode(payload, 50, 0, { retry: true })
    const { resume, opts } = run.calls[0]
    expect(resume).toBeNull()
    expect(opts.continueFrom).toMatchObject({ idea: { title: idea(1).title }, shots: { shots: expect.any(Array) } })
    expect(opts.startingCostUsd).toBe(0.17)
    expect(opts.review).toBe(false) // the story and pictures were already approved
    expect(db['pipeline-steps']).toHaveLength(9) // the rows are reused, not made again
  })

  it('from the Art Director: reuses the approved idea and script even with TOKEN_OPTIMIZATION off, and still honours "review before video"', async () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'off')
    const { payload } = withRows('art-director', savedStory(), { reviewBeforeVideo: true })
    await executeEpisode(payload, 50, 0, { retry: true })
    const { resume, opts } = run.calls[0]
    expect(resume).toMatchObject({ idea: { title: idea(1).title }, script: { title: script.title } })
    expect(opts.continueFrom).toBeUndefined()
    expect(opts.startingCostUsd).toBe(0.17)
    expect(opts.review).toBe(true)
  })

  it('from the start: nothing to reuse, but the same video and the same step rows', async () => {
    const { payload, db } = withRows('orchestrator-plan', { costUsd: 0 })
    await executeEpisode(payload, 50, 0, { retry: true })
    expect(run.calls[0].resume).toBeNull()
    expect(run.calls[0].opts.continueFrom).toBeUndefined()
    expect(db['pipeline-steps']).toHaveLength(9)
  })

  it('goes back to the Art Director when the saved keyframes are gone, instead of failing in the Editor', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'ep-'))
    saveMediaState(dir, { plates: {}, keyframes: { 1: 'a.png' }, supporting: {}, shotCast: {} }) // only shot 1 of 4 is left
    run.media = { ws: { episodeDir: dir }, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {} } }
    const { payload } = withRows('editor-clips', savedShots())
    await executeEpisode(payload, 50, 0, { retry: true })
    expect(run.calls[0].opts.continueFrom).toBeUndefined()
    expect(run.calls[0].resume).toMatchObject({ script: { title: script.title } })
  })

  it('restores the saved plates, keyframes and cast into the media state when every keyframe is there', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'ep-'))
    const saved = { plates: { 1: 'p.png' }, keyframes: { 1: 'k1.png', 2: 'k2.png', 3: 'k3.png', 4: 'k4.png' }, supporting: {}, shotCast: {} }
    saveMediaState(dir, saved)
    const media = { ws: { episodeDir: dir }, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {} } }
    run.media = media
    const { payload } = withRows('editor-clips', savedShots())
    await executeEpisode(payload, 50, 0, { retry: true })
    expect(run.calls[0].opts.continueFrom).toBeDefined()
    expect(media.state.keyframes).toEqual(saved.keyframes)
    expect(media.state.plates).toEqual(saved.plates)
  })

  it('a step that starts again does not keep the failure text of the last attempt', async () => {
    const { payload, db } = withRows('art-director', savedStory())
    run.touch = async (store) => { await store.stepStart('art-director') }
    await executeEpisode(payload, 50, 0, { retry: true })
    const row = db['pipeline-steps'].find((r) => r.stepKey === 'art-director')!
    expect(row).toMatchObject({ status: 'running', summary: '', endedAt: null })
  })

  it('gives the agents the faces of the series: the base four, and the extras its style bible has', async () => {
    const extras = ['determined', 'scared', 'excited', 'proud', 'curious']
    const rich = withRows('art-director', savedStory(), { styleBible: { ...bibleFromSpec(styleSpec('pixar-3d')), expressions: extras } })
    await executeEpisode(rich.payload, 50, 0, { retry: true })
    expect(run.calls[0].ctx.profile.expressions).toEqual(['neutral', 'happy', 'surprised', 'sad', ...extras])
    const plain = withRows('art-director', savedStory())
    await executeEpisode(plain.payload, 50, 0, { retry: true })
    expect(run.calls[1].ctx.profile.expressions).toEqual(['neutral', 'happy', 'surprised', 'sad'])
  })

  it('a normal run does not reuse anything from the episode itself', async () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'off')
    const { payload } = fakePayload({ episodes: [failed({ status: 'running', error: null, ...savedStory() })], series: [seriesDoc()] })
    await executeEpisode(payload, 50, 0)
    expect(run.calls[0].resume).toBeNull()
    expect(run.calls[0].opts.startingCostUsd).toBe(0)
  })
})
