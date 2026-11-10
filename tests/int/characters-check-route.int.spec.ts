import { beforeEach, describe, expect, it, vi } from 'vitest'

const moderate = vi.hoisted(() => vi.fn(async (_texts: string[]) => ({ flagged: false, reasons: [] as string[] })))
vi.mock('@/pipeline/moderation', async (orig) => ({ ...(await orig<typeof import('@/pipeline/moderation')>()), moderateTexts: moderate }))

import { POST } from '@/app/(frontend)/api/cast/check/route'

const ok = { name: 'Pip', role: 'the friend', look: 'a small round otter with a red scarf', outfit: 'a scarf', personality: 'shy' }
const ask = (body: unknown) => POST(new Request('http://localhost/api/cast/check', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { moderate.mockClear(); moderate.mockImplementation(async () => ({ flagged: false, reasons: [] })) })

describe('POST /api/cast/check (the wizard asks before a character is added)', () => {
  it('passes an original cast, and asks the content check about everything that was written', async () => {
    const r = await ask({ characters: [ok, { ...ok, name: 'Rex' }] })
    expect(await r.json()).toEqual({ problems: [] })
    expect(moderate.mock.calls[0][0]).toEqual(expect.arrayContaining(['Pip', 'Rex', ok.look]))
  })

  it('names what is wrong without calling the content check: a brand, a repeated name, a missing look', async () => {
    expect((await (await ask({ characters: [{ ...ok, name: 'Spiderman' }] })).json()).problems[0]).toMatch(/Character 1: .*studio, brand or existing character/)
    expect((await (await ask({ characters: [ok, { ...ok, name: 'pip' }] })).json()).problems[0]).toMatch(/same name/)
    expect((await (await ask({ characters: [{ ...ok, look: 'cute' }] })).json()).problems[0]).toMatch(/Describe what the character looks like/)
    expect(moderate).not.toHaveBeenCalled()
  })

  it('refuses a description the content check flags', async () => {
    moderate.mockImplementation(async () => ({ flagged: true, reasons: ['violence'] }))
    expect((await (await ask({ characters: [ok] })).json()).problems[0]).toMatch(/flagged by the content check/)
  })

  it('rejects a request that is not a list of one to three characters', async () => {
    for (const bad of [null, {}, { characters: [] }, { characters: [ok, ok, ok, ok] }, { characters: [{ name: 1 }] }, { characters: [{ ...ok, look: 'x'.repeat(3000) }] }]) {
      expect((await ask(bad)).status).toBe(400)
    }
    expect((await POST(new Request('http://localhost/api/cast/check', { method: 'POST', body: 'not json' }))).status).toBe(400)
  })

  it('cleans what was typed before judging it', async () => {
    const r = await ask({ characters: [{ ...ok, name: ' Pip<script> ', look: 'a small <b>otter</b> with a red scarf' }] })
    expect(await r.json()).toEqual({ problems: [] })
    expect(moderate.mock.calls[0][0]).toContain('Pip script')
  })
})
