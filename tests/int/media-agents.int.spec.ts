import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as agents from '@/pipeline/agents'
import type { Ctx } from '@/pipeline/agents'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import type { MediaCtx } from '@/pipeline/media-ctx'
import type { SeriesProfile } from '@/agents/profile'
import { ContinuityError, BudgetError, spentOf } from '@/pipeline/errors'
import type { Script, ShotList } from '@/pipeline/schemas'
import { createMockMedia } from '@/media/mock'
import { buildMockKit } from '@/media/kit'
import { openWorkspace } from '@/media/workspace'
import type { MediaServices } from '@/media/types'
import { lookFor } from '@/lib/styles/bible'
import { generateMockClip } from '@/providers/video/fal'
import { videoSeconds } from '@/engine/finish'
import { probe } from '@/engine/ffmpeg'
import { artDirectorMedia } from '@/pipeline/media-agents'

vi.setConfig({ testTimeout: 180_000 })
let root = ''
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-agents-')); process.env.VIDEO_PROVIDER = 'mock' })
afterAll(() => { delete process.env.VIDEO_PROVIDER })

const profile = (voiceMode: SeriesProfile['voiceMode']): SeriesProfile => ({
  niche: 'Cat videos', durationTargetSec: 28, aspect: '9:16', voiceMode,
  style: { id: 'pixar-3d', promptTemplate: 'soft 3D render', imagePrompt: 'soft 3D animated-film render, warm light', motion: 'smooth weighty 3D motion', negative: 'photoreal skin', look: lookFor(null, 'pixar-3d'), transitions: ['fade', 'slideleft'] },
  cast: [{ name: 'Mango', canonical: 'orange tabby', voiceProfile: { voice: 'coral' } }, { name: 'Luna', canonical: 'grey cat', voiceProfile: { voice: 'onyx' } }],
  narrator: { voice: 'fable' },
})

type Over = { series?: string; media?: (m: MediaServices) => MediaServices; allowanceSec?: number; canSpend?: Ctx['canSpend']; makeClipFn?: MediaCtx['makeClipFn'] }
let n = 0
/** Real mock media, real (placeholder) kits and the real assembler in a fresh workspace, at a small size so it runs fast. */
async function setup(voiceMode: SeriesProfile['voiceMode'], over: Over = {}) {
  const ws = openWorkspace(++n, over.series ?? `s${n}`, { episodes: path.join(root, 'ep'), series: path.join(root, 'se') })
  const base = createMockMedia({ ...ws, width: 270, height: 480 })
  const media = over.media ? over.media(base) : base
  const kits = { Mango: await buildMockKit('Mango', ws.assetsDir), Luna: await buildMockKit('Luna', ws.assetsDir) }
  const m: MediaCtx = {
    media, ws, kits, fps: 30, width: 270, height: 480, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {} },
    makeClipFn: over.makeClipFn ?? ((req) => generateMockClip({ imageFile: req.imageFile, seconds: req.seconds, destFile: req.destFile, width: 180, height: 320 })),
  }
  const ctx: Ctx = { profile: profile(voiceMode), seriesId: 1, mode: 'mock', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: over.allowanceSec ?? 400, provider: 'mock' }, media: m, canSpend: over.canSpend }
  return { ctx, m, ws }
}

const beat = (n: number, speaker: string | null, line: string | null, over: Partial<Script['beats'][number]> = {}): Script['beats'][number] =>
  ({ n, action: n === 3 ? 'Mango jumps up' : 'they talk', speaker, line, emotion: 'smug', delivery: null, expression: 'neutral' as const, onScreenText: null, ...over })
const script = (count = 4, over: Partial<Script> = {}): Script => ({
  title: 'T', hook: 'h', payoff: 'p', supportingCast: [],
  beats: Array.from({ length: count }, (_, i) => (i === 2 ? beat(3, null, null) : beat(i + 1, i % 2 ? 'Luna' : 'Mango', `Line number ${i + 1} here`))), ...over,
})
const owl = { name: 'Grumble', role: 'a grumpy shopkeeper', canonicalLook: 'a tall grey owl in a brown apron', personality: 'grumpy and slow', voice: null, recurring: false }

describe('Art Director with media', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('makes a few plates, one checked keyframe per shot from the references, and records who is in each shot', async () => {
    const { ctx, m } = await setup('character_voices')
    const keyframe = vi.spyOn(m.media, 'keyframe')
    const r = await agents.artDirector(ctx, script(8))
    expect(Object.keys(m.state.plates)).toHaveLength(8)
    expect(new Set(Object.values(m.state.plates)).size).toBeLessThanOrEqual(3)
    expect(Object.keys(m.state.keyframes)).toHaveLength(8)
    for (const f of Object.values(m.state.keyframes)) expect(fs.existsSync(path.join(m.ws.assetsDir, f))).toBe(true)
    // every keyframe is an edit of the plate plus the characters' references, and carries the series look and the cast rule
    const first = keyframe.mock.calls[0][0]
    expect(first.references[0]).toBe(m.state.plates[1])
    expect(first.references.some((f) => f.endsWith('-sheet.png'))).toBe(true)
    expect(first.prompt).toContain('soft 3D animated-film render')
    expect(first.prompt).toMatch(/No other characters/)
    expect(m.state.shotCast[2]).toEqual([expect.objectContaining({ name: 'Luna', main: true })])
    expect(r.output.shots).toHaveLength(8)
    expect(r.usage?.costUsd).toBe(0) // mock media is free
    expect(r.summary).toMatch(/8 keyframe checks/)
  })

  it('gives each supporting character a reference image and uses it in the shots they are in', async () => {
    const { ctx, m } = await setup('character_voices')
    const keyframe = vi.spyOn(m.media, 'keyframe')
    const reference = vi.spyOn(m.media, 'reference')
    const s = script(4, { supportingCast: [owl], beats: [beat(1, 'Mango', 'Hello'), beat(2, 'Grumble', 'What do you want?'), beat(3, null, null), beat(4, 'Luna', 'Bye')] })
    await agents.artDirector(ctx, s)
    expect(reference).toHaveBeenCalledTimes(1)
    expect(reference.mock.calls[0][0].prompt).toContain('tall grey owl')
    expect(m.state.supporting.Grumble.file).toBe('ref-sup-grumble-' + path.basename(m.ws.episodeDir) + '.png')
    expect(m.state.shotCast[2]).toEqual([{ name: 'Grumble', reference: path.join(m.ws.assetsDir, m.state.supporting.Grumble.file), main: false }])
    expect(keyframe.mock.calls[1][0].references).toContain(m.state.supporting.Grumble.file)
  })

  it('reuses a recurring supporting character from the series library in the next reel, but not a one-off', async () => {
    const recurring = { ...owl, recurring: true }
    const s = script(4, { supportingCast: [recurring], beats: [beat(1, 'Mango', 'Hi'), beat(2, 'Grumble', 'Hm'), beat(3, null, null), beat(4, 'Luna', 'Bye')] })
    const first = await setup('character_voices', { series: 'same-series' })
    await agents.artDirector(first.ctx, s)
    const second = await setup('character_voices', { series: 'same-series' })
    const reference = vi.spyOn(second.m.media, 'reference')
    await agents.artDirector(second.ctx, s)
    expect(reference.mock.calls[0][0].key).toBe('sup-grumble') // stable key: the same image as last time
    expect(await reference.mock.results[0].value).toMatchObject({ cached: true, costUsd: 0 })
    // a one-off character gets a key of its own for each episode
    const third = await setup('character_voices', { series: 'same-series' })
    const ref3 = vi.spyOn(third.m.media, 'reference')
    await agents.artDirector(third.ctx, script(4, { supportingCast: [owl], beats: s.beats }))
    expect(ref3.mock.calls[0][0].key).not.toBe('sup-grumble')
  })

  it('checks every keyframe against the characters\' references, makes a failed one again once with the problem named, and keeps the second', async () => {
    // shot 1's first try fails the check, whatever order the shots finish in
    const { ctx, m } = await setup('character_voices', { media: (b) => ({ ...b, gate: async (f, r, refs) => { expect(refs?.[0].name).toBeTruthy(); return f.includes('shot-1-1') ? { pass: false, notes: 'Mango has a white paw', costUsd: 0.002 } : { pass: true, notes: 'ok', costUsd: 0.002 } } }) })
    const keyframe = vi.spyOn(m.media, 'keyframe')
    const r = await agents.artDirector(ctx, script(4))
    expect(keyframe.mock.calls.length).toBe(5) // 4 shots + one retry
    const retry = keyframe.mock.calls.find((c) => c[0].key.endsWith('shot-1-2'))
    expect(retry?.[0].prompt).toContain('Mango has a white paw')
    expect(r.summary).toMatch(/failed the check/)
    expect(r.usage!.costUsd).toBeGreaterThan(0)
  })

  it('stops with the cost so far when a keyframe fails the check twice: there is no cheaper fallback', async () => {
    vi.stubEnv('IMAGE_CONCURRENCY', '1') // one shot at a time: the run stops at shot 1, so only its two tries are paid
    const { ctx } = await setup('character_voices', { media: (b) => ({ ...b, gate: async () => ({ pass: false, notes: 'extra paw', costUsd: 0.002 }) }) })
    const err = await agents.artDirector(ctx, script(4)).catch((e) => e)
    expect(err.message).toMatch(/Shot 1.*failed the character check twice.*extra paw/)
    expect(spentOf(err).usd).toBeCloseTo(0.004, 4)
  })

  it('refuses a shot that names a character with no reference image', async () => {
    const { ctx } = await setup('character_voices')
    const s = script(4, { beats: [beat(1, 'Stranger', 'Hi'), beat(2, 'Luna', 'Hm'), beat(3, null, null), beat(4, 'Mango', 'Bye')] })
    await expect(agents.artDirector(ctx, s)).rejects.toThrow(/"Stranger" has no reference image/)
  })

  it('charges for plates and stops with a budget error when the cap is hit', async () => {
    const paid = (b: MediaServices): MediaServices => ({ ...b, plate: async (a) => ({ ...(await b.plate(a)), costUsd: 0.05 }), keyframe: async (a) => ({ ...(await b.keyframe(a)), costUsd: 0.05 }) })
    const ok = await setup('narrator', { media: paid })
    const r = await agents.artDirector(ok.ctx, script(6))
    expect(r.usage!.costUsd).toBeGreaterThanOrEqual(0.4) // 3 plates + 6 keyframes at 0.05 = 0.45
    let allowed = 4
    const capped = await setup('narrator', { media: paid, canSpend: async () => allowed-- > 0 })
    const err = await agents.artDirector(capped.ctx, script(6)).catch((e) => e)
    expect(err).toBeInstanceOf(BudgetError)
    expect(spentOf(err).usd).toBeGreaterThan(0) // what was made before the stop is still booked
  })
})

/** Holds every call of one media service until the test lets it go, so the test sees how many were started at the same time. */
function gated<K extends 'keyframe' | 'plate' | 'speech'>(kind: K) {
  const waiting: (() => void)[] = []
  let started = 0
  let free = false
  const wrap = (b: MediaServices): MediaServices => ({
    ...b,
    [kind]: async (arg: never) => { started++; if (!free) await new Promise<void>((res) => waiting.push(res)); return (b[kind] as (a: never) => Promise<unknown>)(arg) },
  } as MediaServices)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  return {
    wrap,
    started: () => started,
    /** waits (the media work in between takes real time) until `n` calls have started, then a moment longer to see that no more follow */
    async reached(n: number) { for (let i = 0; i < 600 && started < n; i++) await sleep(10); await sleep(150); return started },
    /** lets the waiting calls go, and every later call pass straight through */
    open() { free = true; while (waiting.length) waiting.shift()!() },
    /** lets the waiting calls go; later calls wait again */
    releaseWaiting() { while (waiting.length) waiting.shift()!() },
  }
}

describe('Art Director and Editor make independent pieces at the same time', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('starts the plates, and then the keyframes of all shots, together', async () => {
    const plates = gated('plate')
    const frames = gated('keyframe')
    const { ctx } = await setup('character_voices', { media: (b) => frames.wrap(plates.wrap(b)) })
    const run = agents.artDirector(ctx, script(6))
    expect(await plates.reached(3)).toBe(3) // all three plates are out before any answer
    expect(frames.started()).toBe(0) // the keyframes need the plates
    plates.open()
    expect(await frames.reached(4)).toBe(4) // the limit of 4 at the same time (6 shots)
    frames.open()
    const r = await run
    expect(frames.started()).toBe(6)
    expect(Object.keys(r.output.shots)).toHaveLength(6)
  })

  it('makes the plates and the supporting characters\' references at the same time', async () => {
    const plates = gated('plate')
    const { ctx, m } = await setup('character_voices', { media: (b) => plates.wrap(b) })
    const reference = vi.spyOn(m.media, 'reference')
    const s = script(4, { supportingCast: [owl], beats: [beat(1, 'Mango', 'Hello'), beat(2, 'Grumble', 'What do you want?'), beat(3, null, null), beat(4, 'Luna', 'Bye')] })
    const run = agents.artDirector(ctx, s)
    await plates.reached(3)
    expect(reference).toHaveBeenCalledTimes(1) // the owl's sheet does not wait for the plates
    plates.open()
    await run
  })

  it('never starts more keyframes than IMAGE_CONCURRENCY', async () => {
    vi.stubEnv('IMAGE_CONCURRENCY', '2')
    const frames = gated('keyframe')
    const { ctx } = await setup('character_voices', { media: (b) => frames.wrap(b) })
    const run = agents.artDirector(ctx, script(4))
    expect(await frames.reached(2)).toBe(2)
    frames.releaseWaiting()
    expect(await frames.reached(4)).toBe(4) // each finished keyframe makes room for the next shot
    frames.open()
    await run
  })

  it('stops starting new shots after one fails the check twice, and still counts everything that was made', async () => {
    vi.stubEnv('IMAGE_CONCURRENCY', '2')
    const { ctx, m } = await setup('character_voices', { media: (b) => ({ ...b, gate: async () => ({ pass: false, notes: 'extra paw', costUsd: 0.002 }) }) })
    const keyframe = vi.spyOn(m.media, 'keyframe')
    const err = await agents.artDirector(ctx, script(6)).catch((e) => e)
    expect(err.message).toMatch(/Shot 1.*failed the character check twice/)
    expect(keyframe.mock.calls.length).toBe(4) // shots 1 and 2, two tries each; shots 3 to 6 were never started
    expect(spentOf(err).usd).toBeCloseTo(0.008, 4)
  })

  it('speaks all the lines at the same time but keeps the voices in script order', async () => {
    const speech = gated('speech')
    const { ctx, m } = await setup('character_voices', { media: (b) => speech.wrap(b) })
    const s = script(4)
    const shots = (await agents.artDirector(ctx, s)).output
    const run = agents.animator(ctx, s, shots)
    const lines = s.beats.filter((b) => b.line).length
    expect(await speech.reached(lines)).toBe(lines) // every line is out before any answer
    speech.open()
    const r = await run
    expect(r.output.audio.voices.map((v) => v.speaker)).toEqual(s.beats.filter((b) => b.line).map((b) => b.speaker))
    void m
  })
})

describe('Editor (the Animator step) with media', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('speaks every line, makes a clip for every shot, lip-syncs the character lines, and builds a valid timeline in the series look', async () => {
    const { ctx, m, ws } = await setup('character_voices')
    const s = script(8)
    const shots = (await agents.artDirector(ctx, s)).output
    const r = await agents.animator(ctx, s, shots)
    const lines = s.beats.filter((b) => b.line).length
    const tl = m.state.timeline!
    expect(r.output.mock).toBe(false)
    expect(r.output.audio.voices).toHaveLength(lines)
    expect(tl.voices).toHaveLength(lines)
    expect(tl.captions.length).toBeGreaterThanOrEqual(lines)
    expect(tl.shots).toHaveLength(8)
    expect(fs.existsSync(path.join(ws.episodeDir, 'timeline.json'))).toBe(true)
    expect(tl.music).toMatchObject({ src: 'music-playful.wav', volume: 0.16 }) // niche: Cat videos
    expect(tl.look.gradeFilter).toBe(lookFor(null, 'pixar-3d').gradeFilter) // the series look reaches the assembler
    for (const x of tl.shots) expect(fs.existsSync(path.join(ws.assetsDir, x.clip))).toBe(true)
    expect(r.output.videoClips).toHaveLength(8)
    expect(r.output.videoClips.every((c) => c.status === 'mock')).toBe(true)
    expect(r.output.videoClips.filter((c) => c.lipsync).length).toBe(lines) // every character line was lip-synced
    expect(r.usage!.videoSeconds ?? 0).toBe(0) // mock clips are free and do not count as real seconds
    for (const v of tl.voices) expect(fs.existsSync(path.join(ws.assetsDir, v.src))).toBe(true)
  })

  it('passes the style\'s motion and its negative list on to every clip, plus the keep-the-look rule', async () => {
    const seen: { prompt: string; negativePrompt?: string }[] = []
    const { ctx } = await setup('none', { makeClipFn: async (req) => { seen.push({ prompt: req.prompt, negativePrompt: req.negativePrompt }); return generateMockClip({ imageFile: req.imageFile, seconds: req.seconds, destFile: req.destFile, width: 90, height: 160 }) } })
    const s = script(4, { beats: script(4).beats.map((b) => ({ ...b, speaker: null, line: null })) })
    const shots = (await agents.artDirector(ctx, s)).output
    await agents.animator(ctx, s, shots)
    expect(seen).toHaveLength(4)
    expect(seen[0].prompt).toContain('smooth weighty 3D motion')
    expect(seen[0].prompt).toMatch(/same appearance/)
    expect(seen[0].negativePrompt).toContain('photoreal skin')
    expect(seen[0].negativePrompt).toContain('extra characters')
  })

  it('gives a supporting character a voice that no main character uses, and does not lip-sync a narrator', async () => {
    const { ctx, m } = await setup('narrator_and_characters')
    const speech = vi.spyOn(m.media, 'speech')
    const s = script(4, { supportingCast: [owl], beats: [beat(1, 'narrator', 'Once upon a time'), beat(2, 'Grumble', 'What do you want?'), beat(3, null, null), beat(4, 'Mango', 'Bye')] })
    const shots = (await agents.artDirector(ctx, s)).output
    const r = await agents.animator(ctx, s, shots)
    const voiceOf = (name: string) => speech.mock.calls.find((c) => c[0].name === name)![0].voice
    expect(voiceOf('beat-2')).not.toBe('coral')
    expect(voiceOf('beat-2')).not.toBe('onyx')
    expect(voiceOf('beat-2')).not.toBe('fable')
    expect(voiceOf('beat-1')).toBe('fable')
    expect(r.output.videoClips.filter((c) => c.lipsync).map((c) => c.shot)).toEqual([2, 4]) // Grumble's and Mango's lines, not the narrator's
  })

  it('a no-voice episode needs no speech and no lip-sync, and music carries it', async () => {
    const { ctx, m } = await setup('none')
    const s = { ...script(4), beats: script(4).beats.map((b, i) => ({ ...b, speaker: null, line: null, onScreenText: `Text ${i}` })) }
    const shots = (await agents.artDirector(ctx, s)).output
    const r = await agents.animator(ctx, s, shots)
    expect(r.output.audio.voices).toHaveLength(0)
    expect(m.state.timeline!.voices).toHaveLength(0)
    expect(m.state.timeline!.music!.volume).toBe(0.3)
    expect(m.state.timeline!.shots.every((x) => x.text.length === 1)).toBe(true)
    expect(r.output.videoClips.some((c) => c.lipsync)).toBe(false)
  })

  it('picks the music from the vibe of the reel, and from the niche when the script has no vibe', async () => {
    const quiet = (n: number) => ({ ...script(n), beats: script(n).beats.map((b, i) => ({ ...b, speaker: null, line: null, onScreenText: `Text ${i}` })) })
    for (const [vibe, music] of [['mystery', 'music-tense.wav'], ['calm', 'music-calm.wav'], ['adventure', 'music-upbeat.wav'], [undefined, 'music-playful.wav']] as const) {
      const { ctx, m } = await setup('none')
      const s = { ...quiet(4), ...(vibe ? { vibe } : {}) }
      await agents.animator(ctx, s, (await agents.artDirector(ctx, s)).output)
      expect(m.state.timeline!.music!.src, `vibe ${vibe}`).toBe(music) // 'Cat videos' alone would be playful
    }
  })

  it('stops the episode when a clip cannot be made, and books what was already paid', async () => {
    vi.stubEnv('VIDEO_CONCURRENCY', '1') // these two tests count calls in order, so the shots are made one after another
    let made = 0
    const { ctx } = await setup('character_voices', { makeClipFn: async (req) => {
      if (++made === 3) throw new Error('video service unavailable')
      const r = await generateMockClip({ imageFile: req.imageFile, seconds: req.seconds, destFile: req.destFile, width: 90, height: 160 })
      return { ...r, mock: false, costUsd: 0.35 }
    } })
    const s = script(8)
    const shots = (await agents.artDirector(ctx, s)).output
    const err = await agents.animator(ctx, s, shots).catch((e) => e)
    expect(err.message).toMatch(/Shot 3.*could not be made/)
    expect(spentOf(err).usd).toBeCloseTo(0.7, 2) // two clips were paid for
  })

  it('stops when a character drifts, and tries again before giving up', async () => {
    vi.stubEnv('VIDEO_CONCURRENCY', '1')
    let checks = 0
    const drift = (b: MediaServices): MediaServices => ({ ...b, continuity: async ({ characters }) => { checks++; return { characters: characters.map((c) => ({ name: c.name, sameIdentity: checks === 1 ? 0.4 : 0.95, driftStartSec: checks === 1 ? 1 : null, issues: checks === 1 ? ['fur turns white'] : [] })), undeclaredCharacters: [], costUsd: 0.003 } } })
    const ok = await setup('none', { media: drift })
    const s = script(4, { beats: script(4).beats.map((b) => ({ ...b, speaker: null, line: null })) })
    const shots = (await agents.artDirector(ok.ctx, s)).output
    const r = await agents.animator(ok.ctx, s, shots)
    expect(r.output.videoClips[0].continuity).toMatchObject({ ok: true, attempts: 2 }) // the first try drifted, the second held

    const always = await setup('none', { media: (b) => ({ ...b, continuity: async ({ characters }) => ({ characters: characters.map((c) => ({ name: c.name, sameIdentity: 0.3, driftStartSec: 0.5, issues: ['face changes'] })), undeclaredCharacters: [], costUsd: 0.003 }) }) })
    const shots2 = (await agents.artDirector(always.ctx, s)).output
    const err = await agents.animator(always.ctx, s, shots2).catch((e) => e)
    expect(err).toBeInstanceOf(ContinuityError)
    expect(err.message).toMatch(/Shot 1.*face changes.*2 attempts/)
  })

  it('keeps approved frames of each main character for the next reel, and uses them as extra references', async () => {
    const first = await setup('none', { series: 'gallery-series' })
    const s = script(4, { beats: script(4).beats.map((b) => ({ ...b, speaker: null, line: null })) })
    await agents.animator(first.ctx, s, (await agents.artDirector(first.ctx, s)).output)
    expect(fs.existsSync(path.join(first.ws.libraryDir, 'gallery', 'mango'))).toBe(true)
    const second = await setup('none', { series: 'gallery-series' })
    const keyframe = vi.spyOn(second.m.media, 'keyframe')
    await agents.artDirector(second.ctx, s)
    expect(keyframe.mock.calls.some((c) => c[0].references.some((f) => f.startsWith('gallery-mango')))).toBe(true)
  })
})

describe('Editor-QA with media', () => {
  async function made(voiceMode: SeriesProfile['voiceMode'], s: Script) {
    const x = await setup(voiceMode)
    const shots = (await agents.artDirector(x.ctx, s)).output
    const tl = (await agents.animator(x.ctx, s, shots)).output
    return { ...x, tl }
  }

  it('assembles the reel, normalises loudness and passes a healthy episode', async () => {
    const { ctx, m, ws, tl } = await made('character_voices', script(6))
    const r = await agents.editorQa(ctx, tl)
    expect(r.output.passed).toBe(true)
    expect(r.output.mock).toBe(false)
    expect(m.state.master).toBe(path.join('out', 'master.mp4'))
    const master = path.join(ws.episodeDir, m.state.master!)
    expect(await videoSeconds(master)).toBeGreaterThan(5)
    const p = await probe(master)
    expect([p.width, p.height]).toEqual([270, 480])
    expect(p.hasAudio).toBe(true)
    expect(r.output.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['Characters on-model', 'Lip-sync', 'Captions']))
  })

  it('passes a narrator-only episode: a narrator talks over the pictures, so no mouth needs lip-sync', async () => {
    const s = { ...script(6), beats: script(6).beats.map((b) => ({ ...b, speaker: b.line ? 'narrator' : null })) }
    const { ctx, tl } = await made('narrator', s)
    expect(tl.audio.voices.length).toBeGreaterThan(0)
    const r = await agents.editorQa(ctx, tl)
    expect(r.output.checks.find((c) => c.name === 'Lip-sync')).toMatchObject({ ok: true, note: 'not needed (narrator only)' })
    expect(r.output.passed).toBe(true)
  })

  it('fails when a character speaks and none of the clips was lip-synced', async () => {
    const { ctx, tl } = await made('character_voices', script(6))
    for (const c of tl.videoClips) delete c.lipsync
    const r = await agents.editorQa(ctx, tl)
    expect(r.output.checks.find((c) => c.name === 'Lip-sync')!.ok).toBe(false)
    expect(r.summary).toContain('Lip-sync')
  })

  it('checks that the reel is 25 to 30 seconds: a six-shot reel passes and a three-shot one is too short', async () => {
    const long = await made('character_voices', script(6))
    const pass = await agents.editorQa(long.ctx, long.tl)
    expect(pass.output.checks.find((c) => c.name === 'Length fits a reel')).toMatchObject({ ok: true })
    const x = await setup('character_voices')
    x.ctx.profile = { ...x.ctx.profile, durationTargetSec: 12 } // three shots of 4 s: a 12 s reel
    const short3 = script(3)
    const shortShots = (await agents.artDirector(x.ctx, short3)).output
    const shortTl = (await agents.animator(x.ctx, short3, shortShots)).output
    const fail = await agents.editorQa(x.ctx, shortTl)
    expect(fail.output.checks.find((c) => c.name === 'Length fits a reel')).toMatchObject({ ok: false })
    expect(fail.output.passed).toBe(false)
  })

  it('fails when a clip was recorded as drifting', async () => {
    const { ctx, tl } = await made('character_voices', script(6))
    tl.videoClips[0].continuity = { ok: false, attempts: 2, scores: { Mango: 0.3 }, issues: ['face changes'] }
    const r = await agents.editorQa(ctx, tl)
    expect(r.output.checks.find((c) => c.name === 'Characters on-model')).toMatchObject({ ok: false, note: '1 clip(s) drifted' })
    expect(r.output.passed).toBe(false)
  })

  it('fails the check when the assembled reel is the wrong length', async () => {
    const { ctx, m, tl } = await made('character_voices', script(6))
    const { assembleTimeline } = await import('@/engine/assemble')
    m.renderFn = async (o) => assembleTimeline({ ...o, timeline: { ...(o.timeline as object), shots: (o.timeline as { shots: unknown[] }).shots.slice(0, 1) } as never })
    const r = await agents.editorQa(ctx, tl)
    expect(r.output.passed).toBe(false)
    expect(r.output.checks.find((c) => c.name === 'Length matches the timeline')!.ok).toBe(false)
  })
})

describe('whole episode with real (mock-provider) media', () => {
  const memory = () => {
    const episode: Record<string, unknown> = {}
    const spend: { usd: number; sec: number }[] = []
    const store: Store = {
      stepStart: async () => {}, stepDone: async () => {}, stepFail: async () => {},
      episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async (usd, sec = 0) => { spend.push({ usd, sec }) },
    }
    return { episode, spend, store }
  }

  it('runs through the Orchestrator and ends with a master file recorded', async () => {
    const { ctx, m } = await setup('character_voices')
    const { episode, spend, store } = memory()
    const out = await runEpisode(ctx, store, [])
    expect(out.status).toBe('done')
    expect((episode.files as { master?: string }).master).toBe(m.state.master)
    expect((episode.files as { mockRender?: boolean }).mockRender).toBeUndefined()
    expect(spend).toHaveLength(2) // the Art Director and the Animator report their media spend
  })

  it('books the money spent by a step that fails part-way, and ends the episode as failed', async () => {
    const { ctx } = await setup('character_voices', { makeClipFn: async (req) => {
      if (req.destFile.includes('shot-4-')) throw new Error('video service unavailable')
      const r = await generateMockClip({ imageFile: req.imageFile, seconds: req.seconds, destFile: req.destFile, width: 90, height: 160 })
      return { ...r, mock: false, costUsd: 0.35 }
    } })
    const { episode, spend, store } = memory()
    const out = await runEpisode(ctx, store, [])
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/Shot 4.*could not be made/)
    expect(episode.status).toBe('failed')
    expect(spend.reduce((s, x) => s + x.usd, 0)).toBeCloseTo(1.05, 2) // three clips were paid for
    expect(out.costUsd).toBeGreaterThan(1)
  })

  it('stops for review instead of overspending when the planned clips do not fit under the cap', async () => {
    const { ctx } = await setup('character_voices')
    const { episode, store } = memory()
    store.budgetOk = async (usd) => usd < 1
    const out = await runEpisode(ctx, store, [])
    expect(out.status).toBe('needs-review')
    expect(episode.status).toBe('needs-review')
    expect(String(episode.error)).toMatch(/video clips would cost about USD/)
  })
})

describe('the ShotList type', () => {
  it('has no engine/video split any more', () => {
    const shot: ShotList['shots'][number] = { n: 1, type: 'action', description: 'd', durationSec: 3, characters: ['Mango'], beat: 1, videoSeconds: 5, keyframePrompt: 'k', motionPrompt: 'm' }
    expect('render' in shot).toBe(false)
  })
})

describe('keyframes show the face the beat asks for', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  const faces = (a: string, b: string, c: string, d: string) => script(4, { beats: [
    beat(1, 'Mango', 'Hello', { expression: a as never }), beat(2, 'Luna', 'Eek', { expression: b as never }), beat(3, null, null, { expression: c as never }), beat(4, 'Mango', 'Bye', { expression: d as never }),
  ] })
  /** the references and the prompt the keyframe of one shot was asked for */
  const shotCall = (keyframe: ReturnType<typeof vi.spyOn>, n: number) => {
    const call = (keyframe.mock.calls as { 0: { key: string; prompt: string; references: string[] } }[]).find((c) => c[0].key.includes(`-shot-${n}-1`))![0]
    return { refs: call.references, prompt: call.prompt }
  }

  it('gives the character of the beat the close-up of its expression, not the neutral one, and says so in the prompt', async () => {
    const { ctx, m } = await setup('character_voices')
    const keyframe = vi.spyOn(m.media, 'keyframe')
    await agents.artDirector(ctx, faces('happy', 'sad', 'surprised', 'neutral'))
    const one = shotCall(keyframe, 1), two = shotCall(keyframe, 2)
    expect(one.refs).toContain('mango-expr-happy.png'); expect(one.refs).not.toContain('mango-expr-neutral.png')
    expect(one.prompt).toContain("Mango's face shows a clearly happy expression")
    expect(two.refs).toContain('luna-expr-sad.png'); expect(two.refs).not.toContain('luna-expr-neutral.png')
    expect(two.prompt).toContain("Luna's face shows a clearly sad expression")
    expect(one.refs.some((f) => f.endsWith('-sheet.png'))).toBe(true) // the sheet is still there: the close-up adds the face
  })

  it('uses the nearest face the pack has when the beat asks for one it does not, and still asks for the right feeling in words', async () => {
    const { ctx, m } = await setup('character_voices')
    const keyframe = vi.spyOn(m.media, 'keyframe')
    await agents.artDirector(ctx, faces('scared', 'determined', 'neutral', 'neutral'))
    const one = shotCall(keyframe, 1), two = shotCall(keyframe, 2)
    expect(one.refs).toContain('mango-expr-surprised.png') // scared -> surprised
    expect(one.prompt).toContain('clearly scared expression')
    expect(two.refs).toContain('luna-expr-neutral.png') // determined -> neutral
  })

  it('uses the exact face when the character has the extra expression', async () => {
    const { ctx, m } = await setup('character_voices')
    m.kits.Mango = await buildMockKit('Mango', m.ws.assetsDir, ['neutral', 'happy', 'surprised', 'sad', 'scared'])
    const keyframe = vi.spyOn(m.media, 'keyframe')
    await agents.artDirector(ctx, faces('scared', 'neutral', 'neutral', 'neutral'))
    expect(shotCall(keyframe, 1).refs).toContain('mango-expr-scared.png')
  })

  it('in a shot with two main characters only the character of the beat gets the expression; the other keeps the neutral one', async () => {
    const { ctx, m } = await setup('character_voices')
    const s = faces('sad', 'happy', 'happy', 'happy')
    const shots = agents.standardShots(ctx, { ...s, beats: s.beats.map((b, i) => (i === 0 ? { ...b, speaker: 'Luna' } : b)) })
    shots.shots[0].characters = ['Mango', 'Luna']
    const keyframe = vi.spyOn(m.media, 'keyframe')
    await artDirectorMedia(ctx, m, { ...s, beats: s.beats.map((b, i) => (i === 0 ? { ...b, speaker: 'Luna' } : b)) }, shots)
    const one = shotCall(keyframe, 1)
    expect(one.refs).toContain('luna-expr-sad.png')
    expect(one.refs).toContain('mango-expr-neutral.png')
    expect(one.refs).not.toContain('mango-expr-sad.png')
    expect(one.prompt).toContain("Luna's face shows a clearly sad expression")
  })

  it('when the beat is spoken by the narrator, or by nobody, the first main character in the shot leads', async () => {
    const { ctx, m } = await setup('character_voices')
    const s = faces('surprised', 'happy', 'happy', 'happy')
    const withNarrator = { ...s, beats: s.beats.map((b, i) => (i === 0 ? { ...b, speaker: 'narrator' } : b)) }
    const shots = agents.standardShots(ctx, withNarrator)
    shots.shots[0].characters = ['Luna', 'Mango']
    const keyframe = vi.spyOn(m.media, 'keyframe')
    await artDirectorMedia(ctx, m, withNarrator, shots)
    const one = shotCall(keyframe, 1)
    expect(one.refs).toContain('luna-expr-surprised.png')
    expect(one.refs).toContain('mango-expr-neutral.png')
  })

  it('treats a script from before expressions existed as neutral, and a shot with no main character asks for no face', async () => {
    const { ctx, m } = await setup('character_voices')
    const old = script(4, { beats: script(4).beats.map((b) => ({ ...b, expression: undefined as never })) })
    const keyframe = vi.spyOn(m.media, 'keyframe')
    await agents.artDirector(ctx, old)
    const one = shotCall(keyframe, 1)
    expect(one.refs).toContain('mango-expr-neutral.png')
    expect(one.prompt).toContain('clearly neutral expression')
    const quiet = await setup('character_voices')
    const k2 = vi.spyOn(quiet.m.media, 'keyframe')
    const s = faces('happy', 'happy', 'happy', 'happy')
    const shots = agents.standardShots(quiet.ctx, s)
    shots.shots[2].characters = []
    await artDirectorMedia(quiet.ctx, quiet.m, s, shots)
    expect(shotCall(k2, 3).prompt).not.toContain('face shows')
  })
})
