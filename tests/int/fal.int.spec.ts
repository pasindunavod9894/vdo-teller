import { beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { placeholderPng } from '@/media/placeholder'
import { generateLipsync, generateMockLipsync } from '@/providers/video/lipsync'
import { makeLipsync } from '@/providers/video'
import { classifyFalError, generateClip, generateMockClip, probeDuration, VideoError, type FalLike } from '@/providers/video/fal'
import { makeClip, videoProvider } from '@/providers/video'

let dir = ''
let still = ''
let mp4 = Buffer.alloc(0)

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fal-'))
  still = path.join(dir, 'still.png')
  await placeholderPng(still, { width: 540, height: 960, colour: '0xcc9977', shape: 'character' })
  const tiny = path.join(dir, 'tiny.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-pix_fmt', 'yuv420p', tiny])
  mp4 = fs.readFileSync(tiny)
})

const okFetch = (async () => new Response(new Uint8Array(mp4), { status: 200 })) as unknown as typeof fetch

function fakeClient(over: Partial<FalLike> = {}) {
  const calls: { endpoint: string; input: Record<string, unknown> }[] = []
  const client: FalLike = {
    storage: { upload: vi.fn(async () => 'https://fal.test/uploaded.png') },
    subscribe: vi.fn(async (endpoint, opts) => { calls.push({ endpoint, input: opts.input }); return { data: { video: { url: 'https://fal.test/out.mp4' } }, requestId: 'req-1' } }),
    ...over,
  }
  return { client, calls }
}

describe('generateClip (fal.ai image-to-video)', () => {
  it('uploads the still, calls the verified Kling endpoint, downloads the clip and reports the real cost', async () => {
    const { client, calls } = fakeClient()
    const dest = path.join(dir, 'a.mp4')
    const r = await generateClip({ imageFile: still, prompt: 'The cat jumps back as steam erupts.', seconds: 5, destFile: dest, client, fetchImpl: okFetch })
    expect(calls).toHaveLength(1)
    expect(calls[0].endpoint).toBe('fal-ai/kling-video/v2.5-turbo/pro/image-to-video')
    expect(calls[0].input).toMatchObject({ image_url: 'https://fal.test/uploaded.png', duration: '5', prompt: 'The cat jumps back as steam erupts.' })
    expect(r.costUsd).toBe(0.35)
    expect(r.seconds).toBe(5)
    expect(r.requestId).toBe('req-1')
    expect(await probeDuration(dest)).toBeGreaterThan(0.5)
  })

  it('snaps an odd length to a supported one and prices it that way', async () => {
    const { client, calls } = fakeClient()
    const r = await generateClip({ imageFile: still, prompt: 'walks', seconds: 7, destFile: path.join(dir, 'b.mp4'), client, fetchImpl: okFetch })
    expect(calls[0].input.duration).toBe('10')
    expect(r.costUsd).toBe(0.7)
  })

  it('strips brand names from the prompt and caps its length before anything is sent', async () => {
    const { client, calls } = fakeClient()
    await generateClip({ imageFile: still, prompt: `A Disney style cat runs ${'x'.repeat(900)}`, seconds: 5, destFile: path.join(dir, 'c.mp4'), client, fetchImpl: okFetch })
    const sent = calls[0].input.prompt as string
    expect(sent.toLowerCase()).not.toContain('disney')
    expect(sent.length).toBeLessThanOrEqual(500)
  })

  it('retries a transient failure (HTTP 503) and then succeeds, without double-counting cost', async () => {
    let n = 0
    const { client } = fakeClient({
      subscribe: vi.fn(async () => { n++; if (n === 1) throw Object.assign(new Error('Service unavailable'), { status: 503 }); return { data: { video: { url: 'https://fal.test/out.mp4' } } } }),
    })
    const r = await generateClip({ imageFile: still, prompt: 'walks', seconds: 5, destFile: path.join(dir, 'd.mp4'), client, fetchImpl: okFetch })
    expect(n).toBe(2)
    expect(r.costUsd).toBe(0.35)
  }, 20000)

  it('does NOT retry a content-policy block and reports it as such', async () => {
    const sub = vi.fn(async () => { throw Object.assign(new Error('content_policy_violation'), { status: 422 }) })
    const { client } = fakeClient({ subscribe: sub })
    await expect(generateClip({ imageFile: still, prompt: 'x', seconds: 5, destFile: path.join(dir, 'e.mp4'), client, fetchImpl: okFetch })).rejects.toMatchObject({ kind: 'policy' })
    expect(sub).toHaveBeenCalledTimes(1)
  })

  it('does not retry bad credentials', async () => {
    const sub = vi.fn(async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }) })
    const { client } = fakeClient({ subscribe: sub })
    await expect(generateClip({ imageFile: still, prompt: 'x', seconds: 5, destFile: path.join(dir, 'f.mp4'), client, fetchImpl: okFetch })).rejects.toMatchObject({ kind: 'auth' })
    expect(sub).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry limit on a persistent transient failure', async () => {
    const sub = vi.fn(async () => { throw Object.assign(new Error('boom'), { status: 500 }) })
    const { client } = fakeClient({ subscribe: sub })
    await expect(generateClip({ imageFile: still, prompt: 'x', seconds: 5, destFile: path.join(dir, 'g.mp4'), client, fetchImpl: okFetch, retries: 1 })).rejects.toMatchObject({ kind: 'transient' })
    expect(sub).toHaveBeenCalledTimes(2)
  }, 20000)

  it('rejects a response without a video url, an empty prompt and a missing still, without calling fal', async () => {
    const bad = fakeClient({ subscribe: vi.fn(async () => ({ data: { nope: true } })) })
    await expect(generateClip({ imageFile: still, prompt: 'x', seconds: 5, destFile: path.join(dir, 'h.mp4'), client: bad.client, fetchImpl: okFetch })).rejects.toMatchObject({ kind: 'invalid' })
    const { client } = fakeClient()
    await expect(generateClip({ imageFile: still, prompt: '   ', seconds: 5, destFile: path.join(dir, 'i.mp4'), client, fetchImpl: okFetch })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(generateClip({ imageFile: path.join(dir, 'missing.png'), prompt: 'x', seconds: 5, destFile: path.join(dir, 'j.mp4'), client, fetchImpl: okFetch })).rejects.toMatchObject({ kind: 'invalid' })
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('fails with an auth error when there is no FAL_KEY and no client', async () => {
    const saved = process.env.FAL_KEY
    delete process.env.FAL_KEY
    await expect(generateClip({ imageFile: still, prompt: 'x', seconds: 5, destFile: path.join(dir, 'k.mp4') })).rejects.toBeInstanceOf(VideoError)
    if (saved) process.env.FAL_KEY = saved
  })
})

describe('error classification', () => {
  it.each([
    [{ status: 401 }, 'auth'], [{ status: 403 }, 'auth'], [{ status: 429 }, 'transient'], [{ status: 502 }, 'transient'],
    [{ status: 422, message: 'content_policy_violation' }, 'policy'], [{ status: 400 }, 'invalid'], [{ message: 'fetch failed' }, 'transient'],
  ])('%j -> %s', (e, kind) => expect(classifyFalError(e)).toBe(kind))
})

describe('free mock provider', () => {
  it('makes a playable clip of the requested length from a still, at zero cost', async () => {
    const r = await generateMockClip({ imageFile: still, seconds: 5, destFile: path.join(dir, 'mock.mp4'), width: 270, height: 480 })
    expect(r.costUsd).toBe(0)
    expect(r.mock).toBe(true)
    expect(await probeDuration(r.file)).toBeGreaterThan(4.5)
  }, 30000)

  it('is the default provider unless fal is explicitly requested AND a key exists', () => {
    const k = process.env.FAL_KEY, p = process.env.VIDEO_PROVIDER
    delete process.env.FAL_KEY; delete process.env.VIDEO_PROVIDER
    expect(videoProvider()).toBe('mock')
    process.env.VIDEO_PROVIDER = 'fal'
    expect(videoProvider()).toBe('mock') // asked for fal but no key: stay free
    process.env.FAL_KEY = 'test-key'
    expect(videoProvider()).toBe('fal')
    process.env.VIDEO_PROVIDER = 'mock'
    expect(videoProvider()).toBe('mock')
    if (k) process.env.FAL_KEY = k; else delete process.env.FAL_KEY
    if (p) process.env.VIDEO_PROVIDER = p; else delete process.env.VIDEO_PROVIDER
  })

  it('makeClip uses the mock when no fal key is configured', async () => {
    const k = process.env.FAL_KEY
    delete process.env.FAL_KEY
    const r = await makeClip({ imageFile: still, prompt: 'x', seconds: 5, destFile: path.join(dir, 'route.mp4') })
    expect(r.mock).toBe(true)
    if (k) process.env.FAL_KEY = k
  }, 30000)
})

describe('end frame (used by the continuity retry)', () => {
  it('pins the clip to a tail image on the model that supports it, and leaves it out on the one that does not', async () => {
    const pro = fakeClient()
    await generateClip({ model: 'kling-2.5-turbo', imageFile: still, tailImageFile: still, prompt: 'The cat waves.', seconds: 5, destFile: path.join(dir, 'tail-pro.mp4'), client: pro.client, fetchImpl: okFetch })
    expect(pro.calls[0].input.tail_image_url).toBe('https://fal.test/uploaded.png')
    const std = fakeClient()
    await generateClip({ model: 'kling-2.5-turbo-standard', imageFile: still, tailImageFile: still, prompt: 'The cat waves.', seconds: 5, destFile: path.join(dir, 'tail-std.mp4'), client: std.client, fetchImpl: okFetch })
    expect(std.calls[0].endpoint).toBe('fal-ai/kling-video/v2.5-turbo/standard/image-to-video')
    expect(std.calls[0].input.tail_image_url).toBeUndefined()
    expect(std.calls[0].input.image_url).toBe('https://fal.test/uploaded.png')
  })
})

describe('lip-sync (fal.ai)', () => {
  const wav = () => { const f = path.join(dir, 'line.wav'); execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', f]); return f }
  const clip = () => { const f = path.join(dir, 'clip-for-lip.mp4'); fs.writeFileSync(f, mp4); return f }

  it('uploads the clip and the line, calls the lip-sync endpoint, downloads the result and prices it by the clip length', async () => {
    const { client, calls } = fakeClient()
    const dest = path.join(dir, 'lip.mp4')
    const r = await generateLipsync({ videoFile: clip(), audioFile: wav(), destFile: dest, client, fetchImpl: okFetch })
    expect(calls[0].endpoint).toBe('fal-ai/sync-lipsync/v2')
    expect(calls[0].input).toMatchObject({ video_url: 'https://fal.test/uploaded.png', audio_url: 'https://fal.test/uploaded.png', sync_mode: 'cut_off' })
    expect(fs.existsSync(dest)).toBe(true)
    expect(r.costUsd).toBeCloseTo(0.05, 2) // the 1 s test clip at $0.05 per second
  })

  it('maps a failing request to an error the pipeline can read', async () => {
    const { client } = fakeClient({ subscribe: vi.fn(async () => { throw Object.assign(new Error('bad'), { status: 400 }) }) })
    await expect(generateLipsync({ videoFile: clip(), audioFile: wav(), destFile: path.join(dir, 'x.mp4'), client, fetchImpl: okFetch })).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('is free in mock mode: the clip comes back unchanged', async () => {
    const dest = path.join(dir, 'lip-mock.mp4')
    const r = await generateMockLipsync({ videoFile: clip(), audioFile: wav(), destFile: dest })
    expect(r.costUsd).toBe(0)
    expect(fs.readFileSync(dest).equals(mp4)).toBe(true)
    delete process.env.VIDEO_PROVIDER
    expect((await makeLipsync({ videoFile: clip(), audioFile: wav(), destFile: path.join(dir, 'lip-mock2.mp4') })).mock).toBe(true)
  })
})
