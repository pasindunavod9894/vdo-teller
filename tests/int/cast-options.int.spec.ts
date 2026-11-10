import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { jpegDataUrl, mockCastOptions, proposeCastOptions } from '@/lib/art/cast-options'
import { VOICE_IDS } from '@/lib/voices'
import { placeholderPng } from '@/media/placeholder'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const draft = {
  options: [
    { concept: 'a confident cat and her nervous kitten brother', relationship: 'siblings', characters: [
      { name: 'Mango', role: 'the bold one', look: 'orange tabby cat, white socks', outfit: 'a red scarf', personality: 'bold, loud, loyal', voice: 'coral' },
      { name: 'Pip', role: 'the nervous one', look: 'tiny grey kitten, big green eyes', outfit: 'a blue cap', personality: 'shy, curious', voice: 'not-a-real-voice' }] },
    { concept: 'a solo chef cat', relationship: 'solo', characters: [{ name: 'Chef Biscuit', role: 'the star', look: 'cream cat', outfit: 'a Pixar chef hat', personality: 'clumsy', voice: 'onyx' }] },
    { concept: 'a cat family', relationship: 'family', characters: [{ name: 'Mango', role: 'mum', look: 'a', outfit: 'b', personality: 'c', voice: 'nova' }, { name: 'Mango', role: 'dad', look: 'a', outfit: 'b', personality: 'c', voice: 'echo' }] },
  ],
}

let png = ''
const tinyPng = async () => {
  if (png) return png
  const f = path.join(os.tmpdir(), `cast-test-${process.pid}.png`)
  await placeholderPng(f, { width: 96, height: 64, colour: '0x88aacc', shape: 'character' })
  png = fs.readFileSync(f).toString('base64')
  fs.rmSync(f, { force: true })
  return png
}

const fakeClient = async (opts: { parsed?: unknown; failImages?: number[]; throwText?: boolean } = {}) => {
  const b64 = await tinyPng()
  let n = 0
  return {
    responses: { parse: vi.fn(async () => { if (opts.throwText) throw new Error('boom'); return { output_parsed: opts.parsed ?? draft, usage: { input_tokens: 500, output_tokens: 900, input_tokens_details: { cached_tokens: 0 } } } }) },
    images: { generate: vi.fn(async () => { const i = n++; if (opts.failImages?.includes(i)) throw new Error('image failed'); return { data: [{ b64_json: b64 }] } }) },
  } as unknown as OpenAI
}

describe('cast options without AI', () => {
  it('gives three options from the studio templates, each with at least one main character and no pictures', () => {
    for (const niche of ['Cat videos', 'Kids bedtime stories', 'Personal finance', 'Ancient history']) {
      const r = mockCastOptions(niche)
      expect(r.source).toBe('mock')
      expect(r.options).toHaveLength(3)
      for (const o of r.options) { expect(o.characters.length).toBeGreaterThanOrEqual(1); expect(o.image).toBeNull() }
      expect(new Set(r.options.map((o) => o.id)).size).toBe(3)
    }
  })

  it('splits a duo into two characters with different looks and voices', () => {
    const duo = mockCastOptions('Cat videos').options.find((o) => o.characters.length === 2)!
    expect(duo.characters[0].look).not.toBe(duo.characters[1].look)
    expect(duo.characters[0].id).not.toBe(duo.characters[1].id)
  })
})

describe('proposing cast options', () => {
  it('returns exactly three options with a group portrait each, valid voices, unique character ids and brand names scrubbed', async () => {
    const client = await fakeClient()
    const r = await proposeCastOptions({ niche: 'Cat videos', subNiche: 'cat drama', styleId: 'pixar-3d' }, { client })
    expect(r.source).toBe('ai')
    expect(r.options).toHaveLength(3)
    for (const o of r.options) { expect(o.image).toMatch(/^data:image\/jpeg;base64,/); expect(o.characters.length).toBeGreaterThanOrEqual(1) }
    for (const c of r.options.flatMap((o) => o.characters)) expect(VOICE_IDS as string[]).toContain(c.voice)
    expect(r.options[0].characters[1].voice).not.toBe('not-a-real-voice')
    expect(new Set(r.options[2].characters.map((c) => c.id)).size).toBe(2) // two "Mango" get distinct ids
    expect(r.options[1].characters[0].outfit).not.toMatch(/pixar/i)
    expect(client.images.generate).toHaveBeenCalledTimes(3)
    expect((client.images.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ model: 'gpt-image-2', quality: 'medium' })
    expect(r.costUsd).toBeGreaterThan(0.15) // three medium images plus the text call
    expect(r.costUsd).toBeLessThan(0.2)
  })

  it('keeps an option without a picture when its image fails, and only charges for the pictures made', async () => {
    const client = await fakeClient({ failImages: [1] })
    const r = await proposeCastOptions({ niche: 'Cat videos', styleId: 'anime' }, { client })
    expect(r.options.map((o) => o.image !== null)).toEqual([true, false, true])
    expect(r.costUsd).toBeLessThan(0.12)
  })

  it('falls back to the templates when the text call fails or returns nothing, and when there is no key', async () => {
    expect((await proposeCastOptions({ niche: 'Cat videos', styleId: 'anime' }, { client: await fakeClient({ throwText: true }) })).source).toBe('mock')
    expect((await proposeCastOptions({ niche: 'Cat videos', styleId: 'anime' }, { client: await fakeClient({ parsed: { options: [] } }) })).source).toBe('mock')
    const k = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    expect((await proposeCastOptions({ niche: 'Cat videos', styleId: 'anime' })).source).toBe('mock')
    if (k) process.env.OPENAI_API_KEY = k
  })

  it('can skip the pictures', async () => {
    const client = await fakeClient()
    const r = await proposeCastOptions({ niche: 'n', styleId: 'anime' }, { client, images: false })
    expect(client.images.generate).not.toHaveBeenCalled()
    expect(r.options.every((o) => o.image === null)).toBe(true)
  })

  it('shrinks a picture to a small JPEG data URL', async () => {
    const url = await jpegDataUrl(await tinyPng(), 48)
    expect(url).toMatch(/^data:image\/jpeg;base64,/)
    expect(url.length).toBeLessThan(5000)
  })
})
