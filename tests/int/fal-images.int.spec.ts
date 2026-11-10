import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { characterImageProvider, expressionGridPrompt, FalImageError, falImage, splitGrid } from '@/lib/art/fal-images'
import { EXPRESSIONS } from '@/lib/art/plan'
import { imageSize, run, runCapture } from '@/engine/ffmpeg'
import type { FalLike } from '@/providers/video/fal'

const png = Buffer.from('89504e470d0a1a0a', 'hex')
const okFetch = (async () => new Response(png)) as unknown as typeof fetch

function fakeFal(result: unknown, opts: { failFirst?: number } = {}) {
  let failed = 0
  const calls: { endpoint: string; input: Record<string, unknown> }[] = []
  const client: FalLike = {
    storage: { upload: vi.fn(async () => `https://fal.test/u${calls.length}.png`) },
    subscribe: async (endpoint, o) => {
      calls.push({ endpoint, input: o.input })
      if (failed < (opts.failFirst ?? 0)) { failed++; throw Object.assign(new Error('busy'), { status: 503 }) }
      return { data: result }
    },
  }
  return { client, calls }
}

describe('character image provider', () => {
  it('follows CHARACTER_IMAGE_PROVIDER, otherwise fal when a fal key exists, otherwise OpenAI', () => {
    expect(characterImageProvider({ CHARACTER_IMAGE_PROVIDER: 'openai', FAL_KEY: 'k' })).toBe('openai')
    expect(characterImageProvider({ CHARACTER_IMAGE_PROVIDER: 'FAL' })).toBe('fal')
    expect(characterImageProvider({ FAL_KEY: 'k' })).toBe('fal')
    expect(characterImageProvider({})).toBe('openai')
    expect(characterImageProvider({ CHARACTER_IMAGE_PROVIDER: 'nonsense', FAL_KEY: 'k' })).toBe('fal')
  })
})

describe('falImage', () => {
  it('draws from text on flux-2 when there are no references', async () => {
    const { client, calls } = fakeFal({ images: [{ url: 'https://fal.test/out.png' }] })
    const out = await falImage({ prompt: 'a fox', size: { width: 1536, height: 1024 }, client, fetchImpl: okFetch })
    expect(out.equals(png)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].endpoint).toBe('fal-ai/flux-2')
    expect(calls[0].input).toMatchObject({ prompt: 'a fox', image_size: { width: 1536, height: 1024 }, num_images: 1, output_format: 'png' })
    expect(calls[0].input.image_urls).toBeUndefined()
  })

  it('edits the references on flux-2/edit, at most 4 of them', async () => {
    const { client, calls } = fakeFal({ images: [{ url: 'https://fal.test/out.png' }] })
    await falImage({ prompt: 'p', size: { width: 1280, height: 1280 }, refs: Array(6).fill(png), client, fetchImpl: okFetch })
    expect(calls[0].endpoint).toBe('fal-ai/flux-2/edit')
    expect((calls[0].input.image_urls as string[]).length).toBe(4)
  })

  it('retries a busy service and succeeds', async () => {
    const { client, calls } = fakeFal({ images: [{ url: 'https://fal.test/out.png' }] }, { failFirst: 2 })
    await falImage({ prompt: 'p', size: { width: 512, height: 512 }, client, fetchImpl: okFetch })
    expect(calls).toHaveLength(3)
  })

  it('does not retry a policy error, and a flagged (black) image is one', async () => {
    const { client, calls } = fakeFal({ images: [{ url: 'https://fal.test/out.png' }], has_nsfw_concepts: [true] })
    await expect(falImage({ prompt: 'p', size: { width: 512, height: 512 }, client, fetchImpl: okFetch })).rejects.toMatchObject({ kind: 'policy' })
    expect(calls).toHaveLength(1)
  })

  it('fails clearly when fal returns no image or the key is missing', async () => {
    const { client } = fakeFal({ images: [] })
    await expect(falImage({ prompt: 'p', size: { width: 512, height: 512 }, client, fetchImpl: okFetch })).rejects.toBeInstanceOf(FalImageError)
    const saved = process.env.FAL_KEY
    delete process.env.FAL_KEY
    try {
      await expect(falImage({ prompt: 'p', size: { width: 512, height: 512 } })).rejects.toMatchObject({ kind: 'auth' })
    } finally {
      if (saved !== undefined) process.env.FAL_KEY = saved
    }
  })
})

describe('expression grid', () => {
  it('asks for the four expressions in panel reading order, with the character and style', () => {
    const p = expressionGridPrompt('a small red fox in a scarf', 'flat 2D cartoon')
    const at = EXPRESSIONS.map((e) => p.indexOf(`clearly ${e} expression`))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(p).toContain('a small red fox in a scarf')
    expect(p).toContain('flat 2D cartoon')
  })

  it('is cut into four panels, top-left, top-right, bottom-left, bottom-right', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-test-'))
    const grid = path.join(dir, 'grid.png')
    const colours = ['red', 'green', 'blue', 'yellow']
    await run(['-y', '-v', 'error', ...colours.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=640x640`]),
      '-filter_complex', '[0][1][2][3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', '-frames:v', '1', grid])
    const tiles = await splitGrid(fs.readFileSync(grid))
    expect(tiles).toHaveLength(4)
    const dominant: number[][] = []
    for (const [i, t] of tiles.entries()) {
      const f = path.join(dir, `t${i}.png`)
      fs.writeFileSync(f, t)
      const size = await imageSize(f)
      expect(size.width).toBe(Math.round(1280 * 0.47))
      expect(size.height).toBe(Math.round(1280 * 0.47))
      const { stdout } = await runCapture(['-v', 'error', '-i', f, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
      dominant.push([...stdout])
    }
    // each panel holds only its own colour (red, green, blue, yellow), so nothing bled in from a neighbour
    expect(dominant[0][0]).toBeGreaterThan(200); expect(dominant[0][1]).toBeLessThan(60)
    expect(dominant[1][1]).toBeGreaterThan(100); expect(dominant[1][0]).toBeLessThan(60)
    expect(dominant[2][2]).toBeGreaterThan(200); expect(dominant[2][0]).toBeLessThan(60)
    expect(dominant[3][0]).toBeGreaterThan(200); expect(dominant[3][1]).toBeGreaterThan(200); expect(dominant[3][2]).toBeLessThan(60)
  })
})
