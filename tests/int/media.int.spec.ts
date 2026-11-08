import { beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type OpenAI from 'openai'
import { createMockMedia, evenWords, SECONDS_PER_WORD } from '@/media/mock'
import { createOpenAIMedia, SPEECH_USD_PER_MIN, WHISPER_USD_PER_MIN } from '@/media/openai'
import { createMedia, mediaProvider } from '@/media'
import { hashOf, openWorkspace, putAsset, safeName } from '@/media/workspace'
import { probeDuration } from '@/providers/video/fal'
import { rmsPerFrame } from '@/engine/lipsync'

let root = ''
let wav = Buffer.alloc(0)
let png = Buffer.alloc(0)

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'))
  const w = path.join(root, 'tone.wav')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-ar', '24000', '-ac', '1', w])
  wav = fs.readFileSync(w)
  png = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#c97' } }).png().toBuffer()
})

const dirs = (name: string) => {
  const ws = openWorkspace(1, name, { episodes: path.join(root, 'ep'), series: path.join(root, 'se') })
  return { ws, assetsDir: ws.assetsDir, libraryDir: ws.libraryDir }
}

describe('workspace', () => {
  it('creates the episode folders and the per-series library', () => {
    const { ws } = dirs('s1')
    for (const d of [ws.assetsDir, ws.clipsDir, ws.outDir, ws.libraryDir]) expect(fs.existsSync(d)).toBe(true)
    expect(ws.libraryDir).toContain(path.join('s1', 'library'))
  })
  it('copies assets in, hashes stably and makes safe names', () => {
    const { ws } = dirs('s2')
    const src = path.join(root, 'x.png'); fs.writeFileSync(src, png)
    expect(putAsset(ws, src)).toBe('x.png')
    expect(fs.existsSync(path.join(ws.assetsDir, 'x.png'))).toBe(true)
    expect(hashOf('a', 'b')).toBe(hashOf('a', 'b'))
    expect(hashOf('a', 'b')).not.toBe(hashOf('ab', ''))
    expect(safeName('The Kitchen / Night!')).toBe('the-kitchen-night')
  })
})

describe('mock media (free)', () => {
  it('makes a vertical placeholder plate, caches it per series, and costs nothing', async () => {
    const d = dirs('m1')
    const media = createMockMedia(d)
    const a = await media.plate({ key: 'kitchen', prompt: 'x' })
    expect(a).toMatchObject({ file: 'plate-kitchen.png', costUsd: 0, cached: false })
    const meta = await sharp(path.join(d.assetsDir, a.file)).metadata()
    expect(meta.height!).toBeGreaterThan(meta.width!)
    expect((await media.plate({ key: 'kitchen', prompt: 'x' })).cached).toBe(true)
    // a new episode of the same series reuses the library copy
    const ws2 = openWorkspace(2, 'm1', { episodes: path.join(root, 'ep'), series: path.join(root, 'se') })
    expect((await createMockMedia({ assetsDir: ws2.assetsDir, libraryDir: ws2.libraryDir }).plate({ key: 'kitchen', prompt: 'x' })).cached).toBe(true)
  })

  it('makes speech whose length follows the text, with matching word timings and pulsing loudness', async () => {
    const d = dirs('m2')
    const media = createMockMedia(d)
    const text = 'Three minutes. What could possibly go wrong today?'
    const r = await media.speech({ name: 'line', text, voice: 'coral' })
    expect(r.costUsd).toBe(0)
    expect(r.words.map((w) => w.text)).toEqual(text.split(' '))
    expect(Math.abs(r.seconds - 8 * SECONDS_PER_WORD)).toBeLessThan(0.15)
    expect(await probeDuration(path.join(d.assetsDir, r.file))).toBeCloseTo(r.seconds, 1)
    // loudness varies (syllable-like), so lip-sync has something to follow
    const rms = await rmsPerFrame(path.join(d.assetsDir, r.file), 30)
    expect(Math.max(...rms) / Math.max(1, Math.min(...rms.slice(2, -2)))).toBeGreaterThan(3)
    // the same words in the same voice come from cache (same file)
    expect((await media.speech({ name: 'line', text, voice: 'coral' })).file).toBe(r.file)
    expect((await media.speech({ name: 'line', text, voice: 'onyx' })).file).not.toBe(r.file)
  })

  it('evenWords spreads words across the clip in order', () => {
    const w = evenWords('a b c d', 4)
    expect(w).toHaveLength(4)
    expect(w[0].startSec).toBe(0)
    expect(w.every((x, i) => i === 0 || x.startSec > w[i - 1].startSec)).toBe(true)
    expect(w[3].endSec).toBeLessThanOrEqual(4)
  })

  it('the quality gate passes without calling anything', async () => {
    expect(await createMockMedia(dirs('m3')).gate('nope.png', 'rules')).toMatchObject({ pass: true, costUsd: 0 })
  })
})

describe('provider choice', () => {
  it('is the free mock unless OpenAI is explicitly requested AND a key exists', () => {
    const k = process.env.OPENAI_API_KEY, p = process.env.MEDIA_PROVIDER
    delete process.env.MEDIA_PROVIDER
    process.env.OPENAI_API_KEY = 'sk-test'
    expect(mediaProvider()).toBe('mock')
    process.env.MEDIA_PROVIDER = 'openai'
    expect(mediaProvider()).toBe('openai')
    delete process.env.OPENAI_API_KEY
    expect(mediaProvider()).toBe('mock')
    expect(createMedia(dirs('p1')).provider).toBe('mock')
    if (k) process.env.OPENAI_API_KEY = k
    if (p) process.env.MEDIA_PROVIDER = p; else delete process.env.MEDIA_PROVIDER
  })
})

function fakeOpenAI(over: Record<string, unknown> = {}) {
  const calls = { images: 0, speech: 0, transcribe: 0, gate: 0 }
  const client = {
    images: { generate: vi.fn(async () => { calls.images++; return { data: [{ b64_json: png.toString('base64') }] } }) },
    audio: {
      speech: { create: vi.fn(async () => { calls.speech++; return new Response(new Uint8Array(wav)) }) },
      transcriptions: { create: vi.fn(async () => { calls.transcribe++; return { words: [{ word: 'Three', start: 0, end: 0.5 }, { word: 'minutes', start: 0.5, end: 1.2 }] } }) },
    },
    responses: { parse: vi.fn(async () => { calls.gate++; return { output_parsed: { pass: false, notes: 'stray text on the wall' }, usage: { input_tokens: 800, output_tokens: 40, input_tokens_details: { cached_tokens: 0 } } } }) },
    ...over,
  } as unknown as OpenAI
  return { client, calls }
}

describe('OpenAI media (against a fake client: nothing is spent)', () => {
  it('generates a plate once, charges the image price, then serves it from the library for free', async () => {
    const d = dirs('o1'); const { client, calls } = fakeOpenAI()
    const media = createOpenAIMedia({ ...d, client })
    const first = await media.plate({ key: 'night kitchen', prompt: 'a kitchen at night' })
    expect(first).toMatchObject({ cached: false, costUsd: 0.05, file: 'plate-night-kitchen.png' })
    const second = await media.plate({ key: 'night kitchen', prompt: 'a kitchen at night' })
    expect(second).toMatchObject({ cached: true, costUsd: 0 })
    expect(calls.images).toBe(1)
    expect(fs.existsSync(path.join(d.assetsDir, first.file))).toBe(true)
  })

  it('asks for a vertical plate at medium quality from the right model', async () => {
    const d = dirs('o2'); const { client } = fakeOpenAI()
    await createOpenAIMedia({ ...d, client }).plate({ key: 'k', prompt: 'p' })
    expect(client.images.generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2', size: '1024x1536', quality: 'medium' }))
  })

  it('makes speech with the voice and tone, times the words, charges per minute once, and caches both', async () => {
    const d = dirs('o3'); const { client, calls } = fakeOpenAI()
    const media = createOpenAIMedia({ ...d, client })
    const spec = { name: 'line', text: 'Three minutes', voice: 'coral', instructions: 'smug' }
    const r = await media.speech(spec)
    expect(client.audio.speech.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini-tts', voice: 'coral', instructions: 'smug', response_format: 'wav' }))
    expect(r.words).toHaveLength(2)
    expect(r.seconds).toBeCloseTo(2, 1)
    expect(r.costUsd).toBeCloseTo((r.seconds / 60) * (SPEECH_USD_PER_MIN + WHISPER_USD_PER_MIN), 3)
    const again = await media.speech(spec)
    expect(again.costUsd).toBe(0)
    expect(calls.speech).toBe(1)
    expect(calls.transcribe).toBe(1)
  })

  it('retries a rate limit and then succeeds; gives up on a permanent error', async () => {
    vi.useFakeTimers()
    const d = dirs('o4'); let n = 0
    const { client } = fakeOpenAI({ images: { generate: vi.fn(async () => { n++; if (n === 1) throw Object.assign(new Error('rate limited'), { status: 429 }); return { data: [{ b64_json: png.toString('base64') }] } }) } })
    const pending = createOpenAIMedia({ ...d, client }).plate({ key: 'r', prompt: 'p' })
    await vi.advanceTimersByTimeAsync(16000)
    expect((await pending).costUsd).toBe(0.05)
    expect(n).toBe(2)
    const bad = fakeOpenAI({ images: { generate: vi.fn(async () => { throw Object.assign(new Error('invalid request'), { status: 400 }) }) } })
    vi.useRealTimers()
    await expect(createOpenAIMedia({ ...dirs('o5'), client: bad.client }).plate({ key: 'x', prompt: 'p' })).rejects.toThrow(/plate x failed/)
    expect(bad.client.images.generate).toHaveBeenCalledTimes(1)
  })

  it('the quality gate returns the verdict and a real, small cost', async () => {
    const d = dirs('o6'); const { client } = fakeOpenAI()
    const f = path.join(d.assetsDir, 's.png'); fs.writeFileSync(f, png)
    const g = await createOpenAIMedia({ ...d, client }).gate(f, 'no text')
    expect(g.pass).toBe(false)
    expect(g.notes).toContain('stray text')
    expect(g.costUsd).toBeGreaterThan(0)
    expect(g.costUsd).toBeLessThan(0.01)
  })
})
