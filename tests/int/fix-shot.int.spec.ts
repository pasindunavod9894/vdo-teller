import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as agents from '@/pipeline/agents'
import type { Ctx } from '@/pipeline/agents'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import { loadMediaState, type MediaCtx } from '@/pipeline/media-ctx'
import { findSpeechFile, fixShot, fixShotEstimateUsd, shotJobFrom } from '@/pipeline/fix-shot'
import { KEEP_LOOK_STRICT } from '@/pipeline/video-shots'
import { BudgetError, ContinuityError, spentOf } from '@/pipeline/errors'
import { createMockMedia } from '@/media/mock'
import { buildMockKit } from '@/media/kit'
import { openWorkspace } from '@/media/workspace'
import type { MediaServices } from '@/media/types'
import type { ClipRequest } from '@/providers/video'
import { generateMockClip } from '@/providers/video/fal'
import { probe } from '@/engine/ffmpeg'
import { goodScript, profile } from './helpers'
import type { ReelQaFlag, ShotList } from '@/pipeline/schemas'

vi.setConfig({ testTimeout: 180_000 })
let root = ''
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-shot-')); process.env.VIDEO_PROVIDER = 'mock' })
afterAll(() => { delete process.env.VIDEO_PROVIDER; fs.rmSync(root, { recursive: true, force: true }) })

const smallClip = (cost = 0) => async (req: ClipRequest) => ({ ...(await generateMockClip({ imageFile: req.imageFile, seconds: req.seconds, destFile: req.destFile, width: 90, height: 160 })), costUsd: cost, mock: cost === 0 })

let n = 0
async function makeEpisode(mediaOver: (m: MediaServices) => MediaServices = (m) => m) {
  const ws = openWorkspace(++n, `fix-${n}`, { episodes: path.join(root, 'ep'), series: path.join(root, 'se') })
  const media = mediaOver(createMockMedia({ ...ws, width: 180, height: 320 }))
  const kits = { Mango: await buildMockKit('Mango', ws.assetsDir), Luna: await buildMockKit('Luna', ws.assetsDir) }
  const m: MediaCtx = { media, ws, kits, fps: 30, width: 180, height: 320, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {} }, makeClipFn: smallClip() }
  const ctx: Ctx = { profile, seriesId: 1, mode: 'mock', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: 400, provider: 'mock' }, media: m }
  const episode: Record<string, unknown> = {}
  const store: Store = { stepStart: async () => {}, stepDone: async () => {}, stepFail: async () => {}, episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async () => {} }
  return { ctx, m, ws, episode, store, media }
}

describe('the reel check', () => {
  it('flags the shots the vision check names, saves them with the finished video, and never fails or re-makes anything', async () => {
    const flag: ReelQaFlag = { shot: 2, kind: 'captions', issue: 'The caption is cut off at the edge' }
    const { ctx, m, episode, store } = await makeEpisode((b) => ({ ...b, reelQa: vi.fn(async () => ({ flags: [flag], costUsd: 0.004 })) }))
    const made = vi.spyOn(m, 'makeClipFn')
    const out = await runEpisode(ctx, store, [])
    expect(out.status).toBe('done')
    expect(episode.qaFlags).toEqual([flag])
    expect(episode.status).toBe('done')
    expect(made).toBeUndefined // nothing is made a second time: the clip function was only used by the Editor
    expect(out.costUsd).toBeCloseTo(0.004, 4) // the check itself is the only cost with mock media
  })

  it('looks at one frame per shot, in shot order, and a check that cannot run does not stop the episode', async () => {
    const seen: number[][] = []
    const ok = await makeEpisode((b) => ({ ...b, reelQa: async (s) => { seen.push(s.shots); expect(fs.existsSync(s.sheetFile)).toBe(true); return { flags: [], costUsd: 0 } } }))
    expect((await runEpisode(ok.ctx, ok.store, [])).status).toBe('done')
    expect(seen[0]).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(ok.episode.qaFlags).toBeUndefined()
    const broken = await makeEpisode((b) => ({ ...b, reelQa: async () => { throw new Error('vision service down') } }))
    const out = await runEpisode(broken.ctx, broken.store, [])
    expect(out.status).toBe('done')
  })
})

describe('saved media state', () => {
  it('is written after the Art Director so a paused or finished episode can continue from it', async () => {
    const { ctx, m, ws } = await makeEpisode()
    const script = await goodScript()
    await agents.artDirector(ctx, script)
    const saved = loadMediaState(ws.episodeDir)!
    expect(saved.keyframes).toEqual(m.state.keyframes)
    expect(Object.keys(saved.shotCast)).toHaveLength(7)
    expect(loadMediaState(path.join(root, 'nowhere'))).toBeNull()
  })
})

/** A finished mock episode on disk (timeline, assets, master) plus what Fix shot needs to find a shot again. */
async function finished(mediaOver?: (m: MediaServices) => MediaServices) {
  const e = await makeEpisode(mediaOver)
  const script = await goodScript()
  const shots = (await agents.artDirector(e.ctx, script)).output
  await agents.animator(e.ctx, script, shots)
  await agents.editorQa(e.ctx, { durationSec: 0, shots: [], audio: { voices: [], music: '', sfx: [] }, videoClips: [], mock: false })
  return { ...e, script, shots }
}

describe('Fix shot', () => {
  it('remakes one clip with the strict prompt and the pinned end frame, keeps its place in the timeline, and assembles the reel again', async () => {
    const e = await finished()
    const master = path.join(e.ws.episodeDir, 'out', 'master.mp4')
    const clipFile = path.join(e.ws.assetsDir, 'clip-2.mp4')
    const beforeClip = fs.statSync(clipFile).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    const beforeMaster = fs.statSync(master).mtimeMs
    const calls: ClipRequest[] = []
    const make = async (req: ClipRequest) => { calls.push(req); return smallClip(0.35)(req) }
    const job = shotJobFrom({ shot: e.shots.shots[1], script: e.script, state: loadMediaState(e.ws.episodeDir)!, assetsDir: e.ws.assetsDir })
    expect(job.speech).not.toBeNull() // shot 2 is a character's line, so it is lip-synced again
    const flags: ReelQaFlag[] = [{ shot: 2, kind: 'frame', issue: 'a broken frame' }, { shot: 4, kind: 'captions', issue: 'overlapping captions' }]
    const r = await fixShot({ episodeDir: e.ws.episodeDir, job, model: 'kling-2.5-turbo', media: e.media, flags, make })
    expect(calls).toHaveLength(1)
    expect(calls[0].prompt).toContain(KEEP_LOOK_STRICT)
    expect(calls[0].tailImageFile).toBe(job.keyframe)
    expect(calls[0].negativePrompt).toContain('extra characters')
    expect(fs.statSync(clipFile).mtimeMs).toBeGreaterThan(beforeClip) // the clip was replaced under the same name
    expect(fs.readdirSync(path.join(e.ws.episodeDir, 'clips')).some((f) => /^shot-2-fix\d+-a1\.mp4$|^shot-2-fix\d+-a1-lip\.mp4$/.test(f))).toBe(true) // the earlier clips are kept
    expect(fs.statSync(master).mtimeMs).toBeGreaterThan(beforeMaster)
    expect((await probe(master)).durationSec).toBeGreaterThan(5)
    expect(r.flags).toEqual([{ shot: 4, kind: 'captions', issue: 'overlapping captions' }]) // this shot's flag cleared, the other kept
    expect(r.continuity).toMatchObject({ ok: true, attempts: 1 })
    expect(r.costUsd).toBeGreaterThanOrEqual(0.35)
    expect(r.videoSeconds).toBe(5)
  })

  it('keeps the flag when the look at the new clip still finds the problem, and says what it cost', async () => {
    const e = await finished((b) => ({ ...b, reelQa: async () => ({ flags: [{ shot: 3, kind: 'text', issue: 'garbled text' }], costUsd: 0.004 }) }))
    const job = shotJobFrom({ shot: e.shots.shots[2], script: e.script, state: loadMediaState(e.ws.episodeDir)!, assetsDir: e.ws.assetsDir })
    const r = await fixShot({ episodeDir: e.ws.episodeDir, job, model: 'kling-2.5-turbo', media: e.media, flags: [{ shot: 3, kind: 'text', issue: 'garbled text' }], make: smallClip(0.35) })
    expect(r.flags).toEqual([{ shot: 3, kind: 'text', issue: 'garbled text' }])
    expect(r.costUsd).toBeCloseTo(0.35 + 0.004 + 0.004 * 0, 3) // the clip plus the look at the result (this shot has no character check cost with mock media)
  })

  it('stops with a clear error, and reports the money spent, when the remade clip drifts twice', async () => {
    const e = await finished()
    const drifting: MediaServices = { ...e.media, continuity: async ({ characters }) => ({ characters: characters.map((c) => ({ name: c.name, sameIdentity: 0.3, driftStartSec: 0.2, issues: ['face changes'] })), undeclaredCharacters: [], costUsd: 0.003 }) }
    const job = shotJobFrom({ shot: e.shots.shots[0], script: e.script, state: loadMediaState(e.ws.episodeDir)!, assetsDir: e.ws.assetsDir })
    const before = fs.readFileSync(path.join(e.ws.assetsDir, 'clip-1.mp4'))
    const masterBefore = fs.statSync(path.join(e.ws.episodeDir, 'out', 'master.mp4')).mtimeMs
    const err = await fixShot({ episodeDir: e.ws.episodeDir, job, model: 'kling-2.5-turbo', media: drifting, flags: [], make: smallClip(0.35) }).catch((x) => x)
    expect(err).toBeInstanceOf(ContinuityError)
    expect(spentOf(err).usd).toBeCloseTo(0.7 + 0.006, 3)
    expect(fs.readFileSync(path.join(e.ws.assetsDir, 'clip-1.mp4')).equals(before)).toBe(true) // the reel is untouched
    expect(fs.statSync(path.join(e.ws.episodeDir, 'out', 'master.mp4')).mtimeMs).toBe(masterBefore)
  })

  it('does not start when the spend is not allowed, and rejects a shot that does not exist or a video with no timeline', async () => {
    const e = await finished()
    const job = shotJobFrom({ shot: e.shots.shots[0], script: e.script, state: loadMediaState(e.ws.episodeDir)!, assetsDir: e.ws.assetsDir })
    await expect(fixShot({ episodeDir: e.ws.episodeDir, job, model: 'kling-2.5-turbo', media: e.media, flags: [], canSpend: async () => false, make: smallClip() })).rejects.toBeInstanceOf(BudgetError)
    await expect(fixShot({ episodeDir: e.ws.episodeDir, job: { ...job, n: 9 }, model: 'kling-2.5-turbo', media: e.media, flags: [], make: smallClip() })).rejects.toThrow(/Shot 9 is not in this video/)
    await expect(fixShot({ episodeDir: path.join(root, 'empty'), job, model: 'kling-2.5-turbo', media: e.media, flags: [] })).rejects.toThrow(/no saved timeline/)
  })

  it('cannot remake a shot that has no saved keyframe', async () => {
    const e = await finished()
    const state = { ...loadMediaState(e.ws.episodeDir)!, keyframes: {} }
    expect(() => shotJobFrom({ shot: e.shots.shots[0], script: e.script, state, assetsDir: e.ws.assetsDir })).toThrow(/no saved keyframe/)
  })

  it('finds the latest speech file of a beat, and estimates the cost to show before the user confirms', async () => {
    const e = await finished()
    expect(findSpeechFile(e.ws.assetsDir, 2)).toMatch(/speech-beat-2-.*\.wav$/)
    expect(findSpeechFile(e.ws.assetsDir, 99)).toBeNull()
    expect(fixShotEstimateUsd('kling-2.5-turbo', 3.75, false)).toBe(0.37) // 5 s clip + checks
    expect(fixShotEstimateUsd('kling-2.5-turbo', 3.75, true)).toBe(0.62) // plus lip-sync
    expect(fixShotEstimateUsd('kling-2.5-turbo-standard', 3.75, false)).toBeLessThan(0.37)
  })
})

describe('the ShotList type', () => {
  it('keeps the angle the Art Director chose', () => {
    const s: ShotList['shots'][number] = { n: 1, type: 'action', description: 'd', durationSec: 3, characters: ['Mango'], beat: 1, videoSeconds: 5, keyframePrompt: 'k', motionPrompt: 'm', angle: 'low angle' }
    expect(s.angle).toBe('low angle')
  })
})
