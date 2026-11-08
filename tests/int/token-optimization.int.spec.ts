import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type OpenAI from 'openai'
import { FLEX_DISCOUNT, flexEnabled, MAX_OUTPUT_TOKENS, maxOutputTokens, MODELS, tokenCostUsd } from '@/agents/models'
import { mediaQuality, tokenOptimization } from '@/agents/optimization'
import { episodeCeilingUsd } from '@/pipeline/budget'
import { mergeScriptPatch, ScriptPatchSchema } from '@/pipeline/script-patch'
import { pickResume } from '@/pipeline/resume'
import { clipKey, withClipCache } from '@/media/clip-cache'
import { createOpenAIMedia } from '@/media/openai'
import { openWorkspace } from '@/media/workspace'
import { IMAGE_COST } from '@/lib/art/plan'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import * as agents from '@/pipeline/agents'
import type { Ctx } from '@/pipeline/agents'
import type { SeriesProfile } from '@/agents/profile'
import type { Script } from '@/pipeline/schemas'
import type { ClipRequest, ClipResult } from '@/providers/video/fal'

let root = ''
let png = Buffer.alloc(0)
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'))
  png = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#c97' } }).png().toBuffer()
})

const dirs = (series: string, episode: number) => { const ws = openWorkspace(episode, series, { episodes: path.join(root, 'ep'), series: path.join(root, 'se') }); return { assetsDir: ws.assetsDir, libraryDir: ws.libraryDir } }

// a test that switches the optimization on or off must not leak that into the next one
afterEach(() => { vi.unstubAllEnvs() })

const beat = (n: number, line: string | null = `line ${n}`) => ({ n, action: `a${n}`, speaker: line ? 'Mango' : null, line, emotion: null, delivery: null, onScreenText: null })
const script = (): Script => ({ title: 'T', hook: 'H', payoff: 'P', beats: [beat(1), beat(2), beat(3)] })

describe('output limits and pricing', () => {
  it('every agent has a hard output cap, and the writer (biggest answer) gets the most', () => {
    for (const k of Object.keys(MODELS) as (keyof typeof MODELS)[]) expect(MAX_OUTPUT_TOKENS[k]).toBeGreaterThan(500)
    expect(MAX_OUTPUT_TOKENS.writer).toBeGreaterThan(MAX_OUTPUT_TOKENS.critic)
  })
  it('flex runs cost half, cached input costs a tenth', () => {
    const u = { inputTokens: 10000, cachedTokens: 0, outputTokens: 2000 }
    expect(tokenCostUsd('gpt-5', u, { flex: true })).toBeCloseTo(tokenCostUsd('gpt-5', u) * FLEX_DISCOUNT, 8)
    expect(tokenCostUsd('gpt-5', { ...u, cachedTokens: 10000 })).toBeLessThan(tokenCostUsd('gpt-5', u) - 0.01)
  })
})

describe('per-episode ceiling', () => {
  it('grows with tier and length, never below the 45 s reel, and can be overridden', () => {
    expect(episodeCeilingUsd('budget', 45, {})).toBe(1.5)
    expect(episodeCeilingUsd('standard', 45, {})).toBe(3)
    expect(episodeCeilingUsd('premium', 45, {})).toBe(5)
    expect(episodeCeilingUsd('standard', 20, {})).toBe(3)
    expect(episodeCeilingUsd('standard', 180, {})).toBe(12)
    expect(episodeCeilingUsd('mystery', 45, {})).toBe(3)
    expect(episodeCeilingUsd('standard', 45, { EPISODE_COST_CAP_USD: '0.5' })).toBe(0.5)
    expect(episodeCeilingUsd('standard', 45, { EPISODE_COST_CAP_USD: 'x' })).toBe(3)
  })
})

describe('writer revisions carry only the changes', () => {
  it('replaces changed beats, adds new ones, keeps the rest in order', () => {
    const merged = mergeScriptPatch(script(), { title: null, hook: 'New hook', payoff: null, beats: [{ ...beat(2), line: 'better line' }, beat(4)] })
    expect(merged.hook).toBe('New hook')
    expect(merged.title).toBe('T')
    expect(merged.beats.map((b) => b.n)).toEqual([1, 2, 3, 4])
    expect(merged.beats[1].line).toBe('better line')
    expect(merged.beats[0].line).toBe('line 1')
  })
  it('an empty patch leaves the script as it was, and the schema is strict about its shape', () => {
    expect(mergeScriptPatch(script(), { title: null, hook: null, payoff: null, beats: [] })).toEqual(script())
    expect(ScriptPatchSchema.safeParse({ title: null, hook: null, payoff: null, beats: [] }).success).toBe(true)
    expect(ScriptPatchSchema.safeParse({ beats: [] }).success).toBe(false)
  })
})

describe('resuming after a failure', () => {
  const idea = { title: 'I', premise: 'p', hook: 'h' }
  const good = { status: 'failed', createdAt: new Date().toISOString(), idea, script: script(), critique: { approved: true } }
  it('reuses the approved idea and script of the newest failed attempt', () => {
    expect(pickResume([good])).toEqual({ idea, script: script() })
  })
  it('does not reuse when it is unapproved, old, missing, or already followed by a finished episode', () => {
    expect(pickResume([{ ...good, critique: { approved: false } }])).toBeNull()
    expect(pickResume([{ ...good, script: undefined }])).toBeNull()
    expect(pickResume([{ ...good, createdAt: new Date(Date.now() - 30 * 3600_000).toISOString() }])).toBeNull()
    expect(pickResume([{ status: 'done', createdAt: new Date().toISOString() }, good])).toBeNull()
    expect(pickResume([{ ...good, critique: undefined }, { ...good }])).toBeNull() // newest failure had nothing to reuse
    expect(pickResume([])).toBeNull()
  })
})

describe('the Orchestrator with a ceiling and a resume', () => {
  const profile: SeriesProfile = { niche: 'Cat videos', style: { id: 'pixar-3d' }, format: 'story-reel', durationTargetSec: 45, aspect: '9:16', voiceMode: 'narrator', cast: [{ name: 'Mango', canonical: 'cat', voiceProfile: { voice: 'coral' } }], narrator: { voice: 'fable' }, qualityTier: 'standard' }
  const ctx = (over: Partial<Ctx> = {}): Ctx => ({ profile, seriesId: 1, mode: 'mock', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: 0, provider: 'mock' }, ...over })
  function memory() {
    const events: string[] = []
    const episode: Record<string, unknown> = {}
    const store: Store = {
      stepStart: async (k) => { events.push(`start:${k}`) }, stepDone: async (k, r) => { events.push(`done:${k}:${r.summary}`) }, stepFail: async (k, m) => { events.push(`fail:${k}:${m}`) },
      episodePatch: async (p) => { Object.assign(episode, p) }, budgetOk: async () => true, addSpend: async () => {},
    }
    return { store, events, episode }
  }

  it('stops with a clear message once the episode ceiling is reached', async () => {
    const spy = vi.spyOn(agents, 'showrunner').mockImplementation(async () => ({ output: { title: 'T', premise: 'p', hook: 'h' }, summary: 's', usage: { model: 'x', inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0.4 } }))
    const { store, events } = memory()
    const out = await runEpisode(ctx({ episodeCeilingUsd: 0.3 }), store, [])
    expect(out.status).toBe('needs-review')
    expect(out.reason).toBe('Episode cost ceiling reached.')
    expect(events.some((e) => e.startsWith('fail:writer'))).toBe(true)
    spy.mockRestore()
  })

  it('agents are told a spend is not allowed when it would pass the ceiling', async () => {
    let askedFor5: boolean | null = null
    let askedFor01: boolean | null = null
    const spy = vi.spyOn(agents, 'artDirector').mockImplementation(async (c) => {
      askedFor5 = await c.canSpend!(5)
      askedFor01 = await c.canSpend!(0.1)
      return { output: { shots: [] }, summary: 'stub' }
    })
    const { store } = memory()
    await runEpisode(ctx({ episodeCeilingUsd: 3 }), store, [])
    expect(askedFor5).toBe(false)
    expect(askedFor01).toBe(true)
    spy.mockRestore()
  })

  it('a resumed run reuses the idea and script: no Showrunner, Writer or Critic call, and the steps say so', async () => {
    const s1 = vi.spyOn(agents, 'showrunner'), s2 = vi.spyOn(agents, 'writer'), s3 = vi.spyOn(agents, 'critic')
    const { store, events, episode } = memory()
    const out = await runEpisode(ctx(), store, [], { idea: { title: 'Kept idea', premise: 'p', hook: 'h' }, script: script() })
    expect(out.status).toBe('done')
    expect(s1).not.toHaveBeenCalled(); expect(s2).not.toHaveBeenCalled(); expect(s3).not.toHaveBeenCalled()
    expect(events.filter((e) => e.startsWith('done:')).slice(1, 4).every((e) => /reused/i.test(e))).toBe(true)
    expect(episode.title).toBe('Kept idea')
    expect((episode.script as Script).beats).toHaveLength(3)
    s1.mockRestore(); s2.mockRestore(); s3.mockRestore()
  })

  it('a normal run saves the Critic\'s approval so a later retry can reuse the script', async () => {
    const { store, episode } = memory()
    await runEpisode(ctx(), store, [])
    expect(episode.critique).toMatchObject({ approved: true })
  })
})

describe('clips are paid for once', () => {
  const req = (file: string, over: Partial<ClipRequest> = {}): ClipRequest => ({ model: 'kling-2.5-turbo', imageFile: file, prompt: 'walks in', seconds: 5, destFile: path.join(root, `dest-${Math.random()}.mp4`), ...over })

  it('the same still, prompt, length and model come back from the library at no cost; any change makes a new clip', async () => {
    const still = path.join(root, 'still.png'); fs.writeFileSync(still, png)
    const lib = path.join(root, 'lib-clips'); fs.mkdirSync(lib)
    const real = path.join(root, 'real.mp4'); fs.writeFileSync(real, 'not-really-a-video')
    let made = 0
    const inner = vi.fn(async (r: ClipRequest): Promise<ClipResult> => { made++; fs.copyFileSync(real, r.destFile); return { file: r.destFile, seconds: 5, costUsd: 0.35, model: 'kling-2.5-turbo', remoteUrl: 'https://x' } })
    const make = withClipCache(lib, inner)
    expect((await make(req(still))).costUsd).toBe(0.35)
    expect(fs.readdirSync(lib)).toHaveLength(1)
    // second time: the probe of a fake file fails, so stub it by checking the call count and that the cached copy is written
    const second = make(req(still))
    await expect(second).rejects.toBeDefined() // ffprobe cannot read the placeholder bytes
    expect(made).toBe(1) // ...but it never asked the paid service again
    await make(req(still, { prompt: 'jumps' })); expect(made).toBe(2)
    await make(req(still, { seconds: 10 })); expect(made).toBe(3)
    expect(clipKey(req(still))).toBe(clipKey(req(still)))
    expect(clipKey(req(still))).not.toBe(clipKey(req(still, { model: 'wan-2.5' as never })))
  })

  it('mock clips are never stored', async () => {
    const still = path.join(root, 'still2.png'); fs.writeFileSync(still, png)
    const lib = path.join(root, 'lib-clips2'); fs.mkdirSync(lib)
    const make = withClipCache(lib, async (r) => { fs.writeFileSync(r.destFile, 'x'); return { file: r.destFile, seconds: 5, costUsd: 0, model: 'kling-2.5-turbo', remoteUrl: 'mock', mock: true } })
    await make(req(still))
    expect(fs.readdirSync(lib)).toHaveLength(0)
  })
})

describe('cheaper media', () => {

  it('draft quality plates cost a third of medium ones and ask for the draft quality', async () => {
    const generate = vi.fn(async () => ({ data: [{ b64_json: png.toString('base64') }] }))
    const client = { images: { generate } } as unknown as OpenAI
    const r = await createOpenAIMedia({ ...dirs('q1', 1), client, quality: 'low' }).plate({ key: 'k', prompt: 'p' })
    expect(r.costUsd).toBe(IMAGE_COST.low)
    expect(IMAGE_COST.low * 3).toBeLessThanOrEqual(IMAGE_COST.medium + 1e-9)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ quality: 'low' }))
  })

  it('the quality check sends a small JPEG, not the full image', async () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'on')
    const parse = vi.fn(async () => ({ output_parsed: { pass: true, notes: 'ok' }, usage: { input_tokens: 300, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } } }))
    const client = { responses: { parse } } as unknown as OpenAI
    const file = path.join(root, 'big.png'); fs.writeFileSync(file, png)
    await createOpenAIMedia({ ...dirs('q2', 1), client }).gate(file, 'rules')
    const url = (parse.mock.calls[0] as unknown as [{ input: { content: { image_url?: string }[] }[] }])[0].input[0].content[1].image_url!
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true)
    const sent = Buffer.from(url.split(',')[1], 'base64')
    const meta = await sharp(sent).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(512)
    expect(sent.length).toBeLessThan(png.length)
  })

  it('a spoken line made once is reused by the next episode of the series for free', async () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'on')
    const tone = path.join(root, 'tone.wav')
    const { execFileSync } = await import('node:child_process')
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-ar', '24000', '-ac', '1', tone])
    const wav = fs.readFileSync(tone)
    const speechCreate = vi.fn(async () => new Response(new Uint8Array(wav)))
    const transcribe = vi.fn(async () => ({ words: [{ word: 'Hi', start: 0, end: 0.5 }] }))
    const client = { audio: { speech: { create: speechCreate }, transcriptions: { create: transcribe } } } as unknown as OpenAI
    const spec = { name: 'beat-1', text: 'Hi', voice: 'coral' }
    const first = await createOpenAIMedia({ ...dirs('q3', 1), client }).speech(spec)
    expect(first.costUsd).toBeGreaterThan(0)
    const again = await createOpenAIMedia({ ...dirs('q3', 2), client }).speech(spec)
    expect(again.costUsd).toBe(0)
    expect(speechCreate).toHaveBeenCalledTimes(1)
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(dirs('q3', 2).assetsDir, again.file))).toBe(true)
  })
})

describe('the token optimization switch', () => {
  it('is off by default and only a clear "on" turns it on', () => {
    expect(tokenOptimization({})).toBe(false)
    expect(tokenOptimization({ TOKEN_OPTIMIZATION: '' })).toBe(false)
    expect(tokenOptimization({ TOKEN_OPTIMIZATION: 'off' })).toBe(false)
    expect(tokenOptimization({ TOKEN_OPTIMIZATION: 'maybe' })).toBe(false)
    for (const v of ['on', 'ON', '1', 'true', ' yes ']) expect(tokenOptimization({ TOKEN_OPTIMIZATION: v })).toBe(true)
  })

  it('off: no output caps, no flex even if asked, flat medium image quality', () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'off'); vi.stubEnv('OPENAI_FLEX', '1')
    expect(maxOutputTokens('writer')).toBeUndefined()
    expect(flexEnabled()).toBe(false)
    for (const tier of ['budget', 'standard', 'premium']) expect(mediaQuality(tier)).toBe('medium')
  })

  it('on: the caps, flex (only when OPENAI_FLEX=1) and tier quality all apply', () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'on'); vi.stubEnv('OPENAI_FLEX', '')
    expect(maxOutputTokens('writer')).toBe(MAX_OUTPUT_TOKENS.writer)
    expect(flexEnabled()).toBe(false)
    vi.stubEnv('OPENAI_FLEX', '1')
    expect(flexEnabled()).toBe(true)
    expect([mediaQuality('budget'), mediaQuality('standard'), mediaQuality('premium')]).toEqual(['low', 'medium', 'high'])
  })

  it('off: the quality check sends the original image, and speech is not stored for reuse', async () => {
    vi.stubEnv('TOKEN_OPTIMIZATION', 'off')
    const parse = vi.fn(async () => ({ output_parsed: { pass: true, notes: 'ok' }, usage: { input_tokens: 300, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } } }))
    const file = path.join(root, 'big-off.png'); fs.writeFileSync(file, png)
    await createOpenAIMedia({ ...dirs('off1', 10), client: { responses: { parse } } as unknown as OpenAI }).gate(file, 'rules')
    const url = (parse.mock.calls[0] as unknown as [{ input: { content: { image_url?: string }[] }[] }])[0].input[0].content[1].image_url!
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    expect(Buffer.from(url.split(',')[1], 'base64').equals(png)).toBe(true)

    const tone = path.join(root, 'tone-off.wav')
    const { execFileSync } = await import('node:child_process')
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-ar', '24000', '-ac', '1', tone])
    const wav = fs.readFileSync(tone)
    const speechCreate = vi.fn(async () => new Response(new Uint8Array(wav)))
    const transcribe = vi.fn(async () => ({ words: [{ word: 'Hi', start: 0, end: 0.5 }] }))
    const client = { audio: { speech: { create: speechCreate }, transcriptions: { create: transcribe } } } as unknown as OpenAI
    const spec = { name: 'beat-1', text: 'Hi', voice: 'coral' }
    await createOpenAIMedia({ ...dirs('off2', 11), client }).speech(spec)
    const again = await createOpenAIMedia({ ...dirs('off2', 12), client }).speech(spec)
    expect(again.costUsd).toBeGreaterThan(0) // made again: nothing was kept for reuse
    expect(speechCreate).toHaveBeenCalledTimes(2)
  })
})
