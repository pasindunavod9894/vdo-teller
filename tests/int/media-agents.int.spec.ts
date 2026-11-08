import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as agents from '@/pipeline/agents'
import type { Ctx } from '@/pipeline/agents'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import type { MediaCtx } from '@/pipeline/media-ctx'
import type { SeriesProfile } from '@/agents/profile'
import type { ShotList } from '@/pipeline/schemas'
import { createMockMedia } from '@/media/mock'
import { buildMockKit } from '@/media/kit'
import { openWorkspace } from '@/media/workspace'
import type { MediaServices } from '@/media/types'
import { videoSeconds } from '@/engine/finish'

let root = ''
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-agents-')); process.env.VIDEO_PROVIDER = 'mock' })
afterAll(() => { delete process.env.VIDEO_PROVIDER })

const profile = (voiceMode: SeriesProfile['voiceMode']): SeriesProfile => ({
  niche: 'Cat videos', style: { id: 'pixar-3d', promptTemplate: 'soft 3D animated-film render' }, format: 'story-reel', durationTargetSec: 45, aspect: '9:16', voiceMode,
  cast: [{ name: 'Mango', canonical: 'orange tabby', voiceProfile: { voice: 'coral' } }, { name: 'Luna', canonical: 'grey cat', voiceProfile: { voice: 'onyx' } }],
  narrator: { voice: 'fable' }, qualityTier: 'standard',
})

let n = 0
/** Real mock media + real (placeholder) kits in a fresh workspace; the renderer is replaced by a fast fake that makes a real mp4. */
async function setup(voiceMode: SeriesProfile['voiceMode'], over: { media?: (m: MediaServices) => MediaServices; allowanceSec?: number; canSpend?: Ctx['canSpend'] } = {}) {
  const ws = openWorkspace(++n, `s${n}`, { episodes: path.join(root, 'ep'), series: path.join(root, 'se') })
  const base = createMockMedia(ws)
  const media = over.media ? over.media(base) : base
  const kits = { Mango: await buildMockKit('Mango', ws.assetsDir), Luna: await buildMockKit('Luna', ws.assetsDir) }
  const m: MediaCtx = {
    media, ws, kits, fps: 30, width: 270, height: 480, state: { plates: {}, stills: {} },
    renderFn: async (o) => {
      const secs = o.timeline.shots.reduce((t, s) => t + s.durationSec, 0)
      fs.mkdirSync(path.dirname(o.outFile), { recursive: true })
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=270x480:rate=30:duration=${secs}`, '-f', 'lavfi', '-i', `sine=frequency=330:duration=${secs}`, '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', o.outFile])
    },
  }
  const ctx: Ctx = { profile: profile(voiceMode), seriesId: 1, mode: 'mock', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: over.allowanceSec ?? 10, provider: 'mock' }, media: m, canSpend: over.canSpend }
  return { ctx, m, ws }
}

const script = (n = 4) => ({
  title: 'T', hook: 'h', payoff: 'p',
  beats: Array.from({ length: n }, (_, i) => ({ n: i + 1, action: i === 2 ? 'Mango jumps up' : 'they talk', speaker: i % 2 ? 'Luna' : 'Mango', line: i === 2 ? null : `Line number ${i + 1} here`, emotion: 'smug', delivery: null, onScreenText: null })),
})

describe('Art Director with media', () => {
  it('makes a few background plates, reuses them across shots, and checks a scene still for each video shot', async () => {
    const { ctx, m } = await setup('character_voices')
    const r = await agents.artDirector(ctx, script(8))
    expect(Object.keys(m.state.plates)).toHaveLength(8)
    expect(new Set(Object.values(m.state.plates)).size).toBeLessThanOrEqual(3)
    for (const s of r.output.shots.filter((x) => x.render === 'video')) {
      expect(m.state.stills[s.n]).toBe(`scene-${s.n}.png`)
      expect(fs.existsSync(path.join(m.ws.assetsDir, m.state.stills[s.n]))).toBe(true)
    }
    expect(r.output.shots.some((s) => s.render === 'video')).toBe(true)
    expect(r.usage?.costUsd).toBe(0) // mock media is free
  })

  it('sends a video shot to the engine when its scene still fails the vision check', async () => {
    const { ctx, m } = await setup('character_voices', { media: (b) => ({ ...b, gate: async () => ({ pass: false, notes: 'extra paw', costUsd: 0.002 }) }) })
    const r = await agents.artDirector(ctx, script(8))
    expect(r.output.shots.every((s) => s.render === 'engine')).toBe(true)
    expect(Object.keys(m.state.stills)).toHaveLength(0)
    expect(r.summary).toMatch(/failed the check/)
    expect(r.usage!.costUsd).toBeGreaterThan(0)
  })

  it('charges for plates and checks, and stops asking for images when the cost cap is hit', async () => {
    const paid = (b: MediaServices): MediaServices => ({ ...b, plate: async (a) => ({ ...(await b.plate(a)), costUsd: 0.05 }) })
    const ok = await setup('narrator', { media: paid })
    const r = await agents.artDirector(ok.ctx, script(6))
    expect(r.usage!.costUsd).toBeGreaterThanOrEqual(0.15)
    let allowed = 1
    const capped = await setup('narrator', { media: paid, canSpend: async () => allowed-- > 0 })
    const r2 = await agents.artDirector(capped.ctx, script(6))
    expect(r2.summary).toMatch(/reused \(cost cap\)/)
    const none = await setup('narrator', { canSpend: async () => false })
    await expect(agents.artDirector(none.ctx, script(6))).rejects.toThrow(/Cost cap/)
  })
})

describe('Animator with media', () => {
  it('speaks every line, builds a valid engine timeline, saves it, and uses video clips where they exist', async () => {
    const { ctx, m, ws } = await setup('character_voices')
    const s = script(8)
    const shots = (await agents.artDirector(ctx, s)).output
    const r = await agents.animator(ctx, s, shots)
    const lines = s.beats.filter((b) => b.line).length
    expect(r.output.mock).toBe(false)
    expect(r.output.audio.voices).toHaveLength(lines)
    expect(m.state.engine!.voices).toHaveLength(lines)
    expect(m.state.engine!.captions).toHaveLength(lines)
    expect(fs.existsSync(path.join(ws.episodeDir, 'timeline.json'))).toBe(true)
    expect(m.state.engine!.music).toMatchObject({ src: 'music-playful.wav', volume: 0.16 }) // niche: Cat videos
    expect(fs.existsSync(path.join(ws.assetsDir, 'music-playful.wav'))).toBe(true)
    const videoShots = shots.shots.filter((x) => x.render === 'video')
    expect(videoShots.length).toBeGreaterThan(0)
    expect(m.state.engine!.shots.filter((x) => x.video)).toHaveLength(videoShots.length)
    for (const x of m.state.engine!.shots.filter((y) => y.video)) expect(fs.existsSync(path.join(ws.assetsDir, x.video!.src))).toBe(true)
    expect(r.output.videoClips.every((c) => c.status === 'mock')).toBe(true)
    expect(r.usage!.videoSeconds ?? 0).toBe(0) // mock clips are free and do not count as real seconds
    // every voice file the timeline names exists
    for (const v of m.state.engine!.voices) expect(fs.existsSync(path.join(ws.assetsDir, v.src))).toBe(true)
  })

  it('a narrator-only episode has narrator voices and no talking faces', async () => {
    const { ctx, m } = await setup('narrator')
    const s = { ...script(4), beats: script(4).beats.map((b) => ({ ...b, speaker: b.line ? 'narrator' : null })) }
    const shots = (await agents.artDirector(ctx, s)).output
    await agents.animator(ctx, s, shots)
    expect(m.state.engine!.voices.length).toBe(3)
    expect(m.state.engine!.shots.some((x) => x.layers.some((l) => l.kind === 'character' && l.talk))).toBe(false)
  })

  it('a no-voice episode needs no speech at all', async () => {
    const { ctx, m } = await setup('none')
    const s = { ...script(4), beats: script(4).beats.map((b, i) => ({ ...b, speaker: null, line: null, onScreenText: `Text ${i}` })) }
    const shots = (await agents.artDirector(ctx, s)).output
    const r = await agents.animator(ctx, s, shots)
    expect(r.output.audio.voices).toHaveLength(0)
    expect(m.state.engine!.voices).toHaveLength(0)
    expect(m.state.engine!.music!.volume).toBe(0.3) // music carries a no-voice episode
    expect(m.state.engine!.shots.some((x) => x.layers.some((l) => l.kind === 'text'))).toBe(true)
  })

  it('a shot whose clip could not be made is rendered by the engine and the episode still builds', async () => {
    const { ctx, m } = await setup('character_voices', { allowanceSec: 10 })
    const s = script(8)
    const shots = (await agents.artDirector(ctx, s)).output
    ctx.video.allowanceSec = 0 // budget gone by the time the Animator runs
    const r = await agents.animator(ctx, s, shots)
    expect(m.state.engine!.shots.some((x) => x.video)).toBe(false)
    expect(r.output.videoClips.every((c) => c.status === 'skipped-budget')).toBe(true)
  })
})

describe('Editor-QA with media', () => {
  it('renders, normalises loudness, and passes a healthy episode', async () => {
    const { ctx, m, ws } = await setup('character_voices')
    const s = script(6)
    const shots = (await agents.artDirector(ctx, s)).output
    const tl = (await agents.animator(ctx, s, shots)).output
    const r = await agents.editorQa(ctx, tl)
    expect(r.output.passed).toBe(true)
    expect(r.output.mock).toBe(false)
    expect(m.state.master).toBe(path.join('out', 'master.mp4'))
    expect(await videoSeconds(path.join(ws.episodeDir, m.state.master!))).toBeGreaterThan(5)
  })

  it('fails the check when the render is the wrong length', async () => {
    const { ctx, m } = await setup('character_voices')
    const s = script(6)
    const shots = (await agents.artDirector(ctx, s)).output
    const tl = (await agents.animator(ctx, s, shots)).output
    const real = m.renderFn!
    m.renderFn = async (o) => real({ ...o, timeline: { ...o.timeline, shots: o.timeline.shots.slice(0, 1) } })
    const r = await agents.editorQa(ctx, tl)
    expect(r.output.passed).toBe(false)
    expect(r.output.checks.find((c) => c.name === 'Length matches the timeline')!.ok).toBe(false)
  })
})

describe('whole episode with real (mock-provider) media', () => {
  it('runs through the Orchestrator and ends with a master file recorded', async () => {
    const { ctx, m } = await setup('character_voices')
    const episode: Record<string, unknown> = {}
    const spend: number[] = []
    const store: Store = {
      stepStart: async () => {}, stepDone: async () => {}, stepFail: async (k, msg) => { throw new Error(`${k}: ${msg}`) },
      episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async (usd) => { spend.push(usd) },
    }
    const out = await runEpisode(ctx, store, [])
    expect(out.status).toBe('done')
    expect((episode.files as { master?: string }).master).toBe(m.state.master)
    expect((episode.files as { mockRender?: boolean }).mockRender).toBeUndefined()
    expect(spend).toHaveLength(2) // the Art Director and the Animator report their media spend
  })
})
