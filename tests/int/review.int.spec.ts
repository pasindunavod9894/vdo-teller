import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as agents from '@/pipeline/agents'
import type { Ctx } from '@/pipeline/agents'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import { loadMediaState, type MediaCtx } from '@/pipeline/media-ctx'
import { createMockMedia } from '@/media/mock'
import { buildMockKit } from '@/media/kit'
import { openWorkspace } from '@/media/workspace'
import { generateMockClip } from '@/providers/video/fal'
import type { Idea, ShotList, Script } from '@/pipeline/schemas'
import { executeFix, PipelineError, reviewEpisode, startFix, startEpisode } from '@/pipeline/payload-store'
import { fakePayload, goodScript, idea, profile, type Doc } from './helpers'

vi.setConfig({ testTimeout: 180_000 })
let root = ''
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'))
  process.env.EPISODES_DIR = path.join(root, 'episodes'); process.env.SERIES_LIBRARY_DIR = path.join(root, 'series')
  process.env.VIDEO_PROVIDER = 'mock'; process.env.MEDIA_PROVIDER = 'mock'
})
afterAll(() => { delete process.env.EPISODES_DIR; delete process.env.SERIES_LIBRARY_DIR; delete process.env.VIDEO_PROVIDER; delete process.env.MEDIA_PROVIDER; fs.rmSync(root, { recursive: true, force: true }) })

const tiny = (req: Parameters<NonNullable<MediaCtx['makeClipFn']>>[0]) => generateMockClip({ imageFile: req.imageFile, seconds: req.seconds, destFile: req.destFile, width: 90, height: 160 })

let n = 0
async function setup(seriesId = `rv-${++n}`) {
  const ws = openWorkspace(++n, seriesId)
  const made: number[] = []
  const media = createMockMedia({ ...ws, width: 180, height: 320 })
  const kits = { Mango: await buildMockKit('Mango', ws.assetsDir), Luna: await buildMockKit('Luna', ws.assetsDir) }
  const m: MediaCtx = { media, ws, kits, fps: 30, width: 180, height: 320, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {} }, makeClipFn: async (req) => { made.push(1); return tiny(req) } }
  const ctx: Ctx = { profile, seriesId, mode: 'mock', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: 400, provider: 'mock' }, media: m }
  const events: string[] = []
  const episode: Record<string, unknown> = {}
  const spend: number[] = []
  const store: Store = {
    stepStart: async (k) => { events.push(k) }, stepDone: async () => {}, stepFail: async (k, msg) => { events.push(`fail:${k}:${msg}`) },
    episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async (usd) => { spend.push(usd) },
  }
  return { ctx, m, ws, made, events, episode, store, spend }
}

describe('Review before video: pause', () => {
  it('stops after the script and the keyframes, before any clip, voice or video money, and says it is waiting for approval', async () => {
    const a = await setup()
    const out = await runEpisode(a.ctx, a.store, [], null, { review: true })
    expect(out.status).toBe('awaiting-approval')
    expect(a.episode.status).toBe('awaiting-approval')
    expect(a.events).toEqual(['orchestrator-plan', 'creator', 'story-builder', 'style', 'art-director'])
    expect(a.made).toHaveLength(0) // no video clip was made
    expect(a.episode.files).toBeUndefined() // no master
    expect(a.episode.shots).toBeDefined(); expect(a.episode.script).toBeDefined()
    expect(loadMediaState(a.ws.episodeDir)!.keyframes).toEqual(a.m.state.keyframes) // the keyframes are saved
    expect(Object.keys(a.m.state.keyframes)).toHaveLength(7)
  })

  it('still stops for review, not for approval, when the clips would not fit the budget', async () => {
    const a = await setup()
    const out = await runEpisode({ ...a.ctx, episodeCeilingUsd: 0.5 }, a.store, [], null, { review: true })
    expect(out.status).toBe('needs-review')
    expect(String(a.episode.error)).toMatch(/video clips would cost/)
  })

  it('runs straight through when review is off', async () => {
    const a = await setup()
    expect((await runEpisode(a.ctx, a.store, [])).status).toBe('done')
    expect(a.made.length).toBeGreaterThan(0)
  })
})

/** A later run for the same episode: same folder, but only what was saved with the episode (a new server process would have nothing else). */
function continued(first: Awaited<ReturnType<typeof setup>>) {
  const made: number[] = []
  const events: string[] = []
  const episode: Record<string, unknown> = {}
  const m2: MediaCtx = { ...first.m, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {}, ...loadMediaState(first.ws.episodeDir) }, makeClipFn: async (req) => { made.push(1); return tiny(req) } }
  const store: Store = {
    stepStart: async (k) => { events.push(k) }, stepDone: async () => {}, stepFail: async (k, msg) => { events.push(`fail:${k}:${msg}`) },
    episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async () => {},
  }
  const saved = { idea: first.episode.idea as Idea, script: first.episode.script as Script, shots: first.episode.shots as ShotList, epStyle: first.episode.styleNotes as never }
  return { ctx: { ...first.ctx, media: m2 } as Ctx, store, events, episode, made, saved }
}

describe('Review before video: continue', () => {
  it('makes only the Editor, Publisher and final steps from what was saved, and finishes the video', async () => {
    const first = await setup()
    await runEpisode(first.ctx, first.store, [], null, { review: true })
    const second = continued(first)
    const creator = vi.spyOn(agents, 'creator'), writer = vi.spyOn(agents, 'writer')
    const out = await runEpisode(second.ctx, second.store, [], null, { continueFrom: second.saved, startingCostUsd: 0.4 })
    expect(second.events.filter((e) => e.startsWith('fail'))).toEqual([])
    expect(out.status).toBe('done')
    expect(second.events).toEqual(['editor-clips', 'editor-assemble', 'publisher', 'orchestrator-final'])
    expect(creator).not.toHaveBeenCalled(); expect(writer).not.toHaveBeenCalled()
    expect(second.made).toHaveLength(7)
    expect((second.episode.files as { master?: string }).master).toBe(path.join('out', 'master.mp4'))
    expect(out.costUsd).toBeGreaterThanOrEqual(0.4) // the cost of the first part is part of the total
    vi.restoreAllMocks()
  })

  it('applies the episode ceiling to the whole video, including what the first part already cost', async () => {
    const first = await setup()
    await runEpisode(first.ctx, first.store, [], null, { review: true })
    const second = continued(first)
    const out = await runEpisode({ ...second.ctx, episodeCeilingUsd: 3 }, second.store, [], null, { continueFrom: second.saved, startingCostUsd: 2.9 })
    expect(out.status).toBe('needs-review') // 2.9 spent + the clips would pass the ceiling
    expect(second.made).toHaveLength(0)
  })
})

// ---------- the store, against an in-memory stand-in for Payload (see helpers) ----------
const user = { id: 7 } as never
const seriesDoc = (over: Record<string, unknown> = {}): Doc => ({ id: 1, owner: 7, title: 'S', niche: 'Cats', style: 'pixar-3d', format: '15', voiceMode: 'character_voices', folderLinked: true, status: 'active', costCapUsd: 30, spentUsd: 1, videoModel: 'kling-2.5-turbo', ...over })

/** A series with a finished, paused or running episode whose files are really on disk (made by the mock pipeline). */
async function episodeOnDisk(status: string) {
  const a = await setup('1')
  const script = await goodScript()
  const shots = (await agents.artDirector(a.ctx, script)).output
  if (status === 'done') { await agents.animator(a.ctx, script, shots); await agents.editorQa(a.ctx, { durationSec: 0, shots: [], audio: { voices: [], music: '', sfx: [] }, videoClips: [], mock: false }) }
  const epId = Number(path.basename(a.ws.episodeDir))
  const ep: Doc = { id: epId, owner: 7, series: 1, status, title: 'T', createdAt: new Date().toISOString(), costUsd: 0.4, idea: idea(1), script, shots, files: status === 'done' ? { master: 'out/master.mp4' } : {}, videoClips: shots.shots.map((s) => ({ shot: s.n, costUsd: 0 })) }
  return { ...a, ep, shots, script }
}

describe('reviewing a paused video', () => {
  it('approve puts it back to running, and only its owner, and only while it is waiting, may do it', async () => {
    const e = await episodeOnDisk('awaiting-approval')
    const { payload, db } = fakePayload({ episodes: [e.ep], series: [seriesDoc()] })
    expect(await reviewEpisode(payload, user, e.ep.id, 'approve')).toEqual({ episodeId: e.ep.id, action: 'approve' })
    expect(db.episodes[0].status).toBe('running')
    await expect(reviewEpisode(payload, user, e.ep.id, 'approve')).rejects.toMatchObject({ status: 409 }) // no longer waiting
    await expect(reviewEpisode(payload, { id: 99 } as never, e.ep.id, 'approve')).rejects.toMatchObject({ status: 404 })
  })

  it('refuses to approve a video whose saved story or shots are missing', async () => {
    const e = await episodeOnDisk('awaiting-approval')
    const { payload } = fakePayload({ episodes: [{ ...e.ep, shots: null }], series: [seriesDoc()] })
    await expect(reviewEpisode(payload, user, e.ep.id, 'approve')).rejects.toMatchObject({ status: 409 })
  })

  it('"a different idea" drops the paused video (so it does not count as one of the day\'s videos) and starts a new one', async () => {
    const e = await episodeOnDisk('awaiting-approval')
    const { payload, db } = fakePayload({ episodes: [e.ep], series: [seriesDoc()] })
    const r = await reviewEpisode(payload, user, e.ep.id, 'new-idea')
    expect(r.action).toBe('new-idea')
    expect(r.episodeId).not.toBe(e.ep.id)
    expect(db.episodes.find((x) => x.id === e.ep.id)).toMatchObject({ status: 'failed' })
    expect(String(db.episodes.find((x) => x.id === e.ep.id)!.error)).toMatch(/different idea/)
    expect(db.episodes.find((x) => x.id === r.episodeId)).toMatchObject({ status: 'running', series: 1 })
  })

  it('does not start a new video while one is waiting for review', async () => {
    const e = await episodeOnDisk('awaiting-approval')
    const { payload } = fakePayload({ episodes: [e.ep], series: [seriesDoc()] })
    await expect(startEpisode(payload, user, 1)).rejects.toThrow(/waiting for your review/)
  })
})

describe('Fix shot through the store', () => {
  it('only works on a finished video, shows an estimate, respects the series cap, and blocks a second fix at the same time', async () => {
    const waiting = await episodeOnDisk('awaiting-approval')
    await expect(startFix(fakePayload({ episodes: [waiting.ep], series: [seriesDoc()] }).payload, user, waiting.ep.id, 2)).rejects.toMatchObject({ status: 409 })

    const done = await episodeOnDisk('done')
    const f = fakePayload({ episodes: [done.ep], series: [seriesDoc()] })
    await expect(startFix(f.payload, user, done.ep.id, 99)).rejects.toMatchObject({ status: 404 })
    const { estimateUsd } = await startFix(f.payload, user, done.ep.id, 2)
    expect(estimateUsd).toBeGreaterThan(0.35); expect(estimateUsd).toBeLessThan(1) // a 5 s clip with lip-sync and checks
    expect((f.db.episodes[0].files as { fixing?: { shot: number } }).fixing).toMatchObject({ shot: 2 })
    await expect(startFix(f.payload, user, done.ep.id, 3)).rejects.toThrow(/already being fixed/)

    const poor = fakePayload({ episodes: [{ ...done.ep, files: { master: 'out/master.mp4' } }], series: [seriesDoc({ spentUsd: 29.9 })] })
    await expect(startFix(poor.payload, user, done.ep.id, 2)).rejects.toMatchObject({ status: 402 })
  })

  it('remakes the shot, assembles the reel again, clears the flag and the fixing mark, and books the cost on the episode and the series', async () => {
    const done = await episodeOnDisk('done')
    const ep = { ...done.ep, qaFlags: [{ shot: 2, kind: 'frame', issue: 'a broken frame' }, { shot: 4, kind: 'captions', issue: 'cut off' }], files: { master: 'out/master.mp4', fixing: { shot: 2, at: new Date().toISOString() } } }
    const f = fakePayload({ episodes: [ep], series: [seriesDoc()] })
    const master = path.join(done.ws.episodeDir, 'out', 'master.mp4')
    const before = fs.statSync(master).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    const r = await executeFix(f.payload, ep.id, 2)
    expect(r.ok).toBe(true)
    expect(fs.statSync(master).mtimeMs).toBeGreaterThan(before)
    const saved = f.db.episodes[0]
    expect((saved.files as { fixing: unknown }).fixing).toBeNull()
    expect(saved.qaFlags).toEqual([{ shot: 4, kind: 'captions', issue: 'cut off' }]) // only shot 2's flag is cleared
    expect((saved.videoClips as { shot: number; status?: string }[]).find((c) => c.shot === 2)).toMatchObject({ status: 'generated' })
    expect(f.db.series[0].spentUsd).toBe(1) // mock provider: nothing real was spent
  })

  it('saves the reason on the episode and clears the fixing mark when the shot cannot be remade', async () => {
    const done = await episodeOnDisk('done')
    fs.rmSync(path.join(done.ws.episodeDir, 'state.json'))
    const ep = { ...done.ep, files: { master: 'out/master.mp4', fixing: { shot: 2, at: new Date().toISOString() } } }
    const f = fakePayload({ episodes: [ep], series: [seriesDoc()] })
    const r = await executeFix(f.payload, ep.id, 2)
    expect(r.ok).toBe(false)
    const files = f.db.episodes[0].files as { fixing: unknown; fixError: string }
    expect(files.fixing).toBeNull()
    expect(files.fixError).toMatch(/no saved keyframes/)
  })
})

describe('the error type', () => {
  it('carries a status for the routes', () => {
    expect(new PipelineError('x', 409).status).toBe(409)
  })
})
