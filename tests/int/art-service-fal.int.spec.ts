import { beforeEach, describe, expect, it, vi } from 'vitest'

const fal = vi.hoisted(() => ({ falImage: vi.fn(), splitGrid: vi.fn() }))
vi.mock('@/lib/art/fal-images', async (orig) => ({ ...(await orig<typeof import('@/lib/art/fal-images')>()), falImage: fal.falImage, splitGrid: fal.splitGrid, characterImageProvider: () => 'fal' }))
vi.mock('node:fs/promises', () => ({ default: { readFile: async () => Buffer.from('sheet') } }))

import { ArtError, createExpressions, createReference, packStatus } from '@/lib/art/service'
import { FAL_EXPRESSIONS_USD, FAL_SHEET_USD, falExpressionsUsd } from '@/lib/art/plan'
import { bibleFromSpec } from '@/lib/styles/bible'
import { styleSpec } from '@/lib/styles/catalogue'
import type { Payload } from 'payload'
import type { User } from '@/payload-types'

type Doc = Record<string, any>
/** A tiny in-memory stand-in for Payload: just the calls the art service makes. */
function fakePayload(seed: { series: Doc; characters: Doc[] }) {
  const db: Record<string, Doc[]> = { series: [seed.series], characters: seed.characters, media: [], 'asset-packs': [] }
  let nextId = 100
  const get = (c: string, id: any) => db[c].find((d) => String(d.id) === String(id))
  const payload = {
    findByID: async ({ collection, id }: any) => { const d = get(collection, id); if (!d) throw new Error('not found'); return structuredClone(d) },
    find: async ({ collection, where }: any) => {
      const [[field, cond]] = Object.entries(where ?? {}) as any
      return { docs: db[collection].filter((d) => String(d[field]) === String(cond.equals)).map((d) => structuredClone(d)) }
    },
    create: async ({ collection, data, file }: any) => {
      const doc = { id: nextId++, ...data, ...(file ? { filename: file.name, url: `/media/${file.name}`, bytes: file.data } : {}) }
      db[collection].push(doc)
      return structuredClone(doc)
    },
    update: async ({ collection, id, data }: any) => { const d = get(collection, id)!; Object.assign(d, data); return structuredClone(d) },
  } as unknown as Payload
  return { payload, db }
}

const user = { id: 1 } as User
const character = (id: number, name: string, extra: Doc = {}) => ({ id, name, owner: 1, series: 7, canonicalDescription: `${name}, a small fox`, referenceImages: [], locked: false, packVersion: 0, ...extra })
const series = (extra: Doc = {}) => ({ id: 7, owner: 1, style: 'flat-2d', styleBible: null, spentUsd: 0, costCapUsd: 30, ...extra })
const tile = (n: number) => Buffer.from(`tile${n}`)

beforeEach(() => {
  fal.falImage.mockReset().mockResolvedValue(Buffer.from('image'))
  fal.splitGrid.mockReset().mockResolvedValue([tile(0), tile(1), tile(2), tile(3)])
})

describe('character sheet from fal', () => {
  it('draws the sheet from text with one fal call, saves it and counts the fal price', async () => {
    const { payload, db } = fakePayload({ series: series(), characters: [character(1, 'Khepri')] })
    const r = await createReference(payload, user, 1)
    expect(fal.falImage).toHaveBeenCalledTimes(1)
    expect(fal.falImage.mock.calls[0][0].refs).toBeUndefined()
    expect(r.cost).toBe(FAL_SHEET_USD)
    expect(db.media).toHaveLength(1)
    expect(db.characters[0].referenceImages).toEqual([db.media[0].id])
    expect(db.series[0].spentUsd).toBeCloseTo(FAL_SHEET_USD, 5)
  })

  it('stops at the series cost cap before calling fal', async () => {
    const { payload } = fakePayload({ series: series({ spentUsd: 29.99, costCapUsd: 30 }), characters: [character(1, 'Khepri')] })
    await expect(createReference(payload, user, 1)).rejects.toMatchObject({ status: 402 })
    expect(fal.falImage).not.toHaveBeenCalled()
  })
})

describe('expressions from fal', () => {
  it('makes all four from ONE fal edit of the sheet, saves them as the pack, and locks the character', async () => {
    const { payload, db } = fakePayload({ series: series(), characters: [character(1, 'Khepri', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' })
    const r = await createExpressions(payload, user, 1)
    expect(fal.falImage).toHaveBeenCalledTimes(1)
    expect(fal.falImage.mock.calls[0][0].refs).toHaveLength(1)
    expect(r).toMatchObject({ done: true, made: 4, cost: FAL_EXPRESSIONS_USD })
    expect(db['asset-packs']).toHaveLength(1)
    expect(db['asset-packs'][0].items.map((i: Doc) => i.name)).toEqual(['neutral', 'happy', 'surprised', 'sad'])
    // each expression holds its own panel of the grid, in order
    const bytesOf = (id: number) => db.media.find((m) => m.id === id)!.bytes.toString()
    expect(db['asset-packs'][0].items.map((i: Doc) => bytesOf(i.image))).toEqual(['tile0', 'tile1', 'tile2', 'tile3'])
    expect(db.characters[0].locked).toBe(true)
    expect(db.characters[0].packVersion).toBe(1)
    expect(db.series[0].spentUsd).toBeCloseTo(FAL_EXPRESSIONS_USD, 5)
  })

  it('only adds the missing expressions to a half-finished pack', async () => {
    const { payload, db } = fakePayload({ series: series(), characters: [character(1, 'Nura', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' }, { id: 51, filename: 'n.png' }, { id: 52, filename: 'h.png' })
    db['asset-packs'].push({ id: 9, character: 1, items: [{ kind: 'expression', name: 'neutral', image: 51 }, { kind: 'expression', name: 'happy', image: 52 }] })
    const r = await createExpressions(payload, user, 1)
    expect(r.made).toBe(2)
    expect(db['asset-packs'][0].items.map((i: Doc) => i.name)).toEqual(['neutral', 'happy', 'surprised', 'sad'])
    expect(db['asset-packs'][0].items[0].image).toBe(51)
  })

  it('does nothing (and spends nothing) when the pack is already complete', async () => {
    const { payload, db } = fakePayload({ series: series(), characters: [character(1, 'Khepri', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' })
    db['asset-packs'].push({ id: 9, character: 1, items: ['neutral', 'happy', 'surprised', 'sad'].map((name, i) => ({ kind: 'expression', name, image: 60 + i })) })
    const r = await createExpressions(payload, user, 1)
    expect(r).toMatchObject({ done: true, made: 0, cost: 0 })
    expect(fal.falImage).not.toHaveBeenCalled()
    expect(db.series[0].spentUsd).toBe(0)
    expect(db.characters[0].locked).toBe(true)
  })

  it('needs the sheet first, and will not touch a locked character', async () => {
    const a = fakePayload({ series: series(), characters: [character(1, 'Khepri')] })
    await expect(createExpressions(a.payload, user, 1)).rejects.toMatchObject({ status: 409 })
    const b = fakePayload({ series: series(), characters: [character(1, 'Khepri', { referenceImages: [50], locked: true })] })
    b.db.media.push({ id: 50, filename: 'sheet.png' })
    await expect(createExpressions(b.payload, user, 1)).rejects.toBeInstanceOf(ArtError)
    expect(fal.falImage).not.toHaveBeenCalled()
  })
})

describe('building the whole cast at the same time', () => {
  it('counts every character in the series spend even when they finish together', async () => {
    const { payload, db } = fakePayload({ series: series(), characters: [character(1, 'Khepri', { referenceImages: [50] }), character(2, 'Nura', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' })
    await Promise.all([createExpressions(payload, user, 1), createExpressions(payload, user, 2)])
    expect(db.series[0].spentUsd).toBeCloseTo(FAL_EXPRESSIONS_USD * 2, 5)
    expect(db.characters.every((c) => c.locked)).toBe(true)
  })
})

describe('pack status', () => {
  it('reports the fal provider and what is still to pay', async () => {
    const { payload, db } = fakePayload({ series: series(), characters: [character(1, 'Khepri'), character(2, 'Nura', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' })
    const fresh = await packStatus(payload, user, 1)
    expect(fresh).toMatchObject({ provider: 'fal', hasReference: false })
    expect(fresh.remainingUsd).toBeCloseTo(FAL_SHEET_USD + FAL_EXPRESSIONS_USD, 5)
    expect(fresh.rebuildUsd).toBeCloseTo(FAL_SHEET_USD + FAL_EXPRESSIONS_USD, 5)
    const withSheet = await packStatus(payload, user, 2)
    expect(withSheet.remainingUsd).toBeCloseTo(FAL_EXPRESSIONS_USD, 5)
  })
})

describe('a series with extra expressions (nine faces)', () => {
  const extras = ['determined', 'scared', 'excited', 'proud', 'curious']
  const nineSeries = () => series({ style: 'cartoon-2d', styleBible: { ...bibleFromSpec(styleSpec('cartoon-2d')), expressions: extras } })
  const tiles9 = Array.from({ length: 9 }, (_, i) => Buffer.from(`tile${i}`))

  it('draws all nine faces from ONE grid call, cuts it 3 x 3, saves them in order, and charges the price of that one picture', async () => {
    fal.splitGrid.mockResolvedValue(tiles9)
    const { payload, db } = fakePayload({ series: nineSeries(), characters: [character(1, 'Khepri', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' })
    const r = await createExpressions(payload, user, 1)
    expect(fal.falImage).toHaveBeenCalledTimes(1)
    const call = fal.falImage.mock.calls[0][0]
    expect(call.size).toEqual({ width: 2046, height: 2046 })
    expect(call.prompt).toContain('3 by 3 grid of 9 equal square panels')
    expect(call.prompt).toContain('panel 5 (row 2, column 2): a clearly determined expression')
    expect(fal.splitGrid.mock.calls[0].slice(1)).toEqual([3, 3])
    expect(r).toMatchObject({ done: true, made: 9, cost: falExpressionsUsd(9) })
    const names = db['asset-packs'][0].items.map((i: Doc) => i.name)
    expect(names).toEqual(['neutral', 'happy', 'surprised', 'sad', ...extras])
    const bytesOf = (id: number) => db.media.find((m) => m.id === id)!.bytes.toString()
    expect(db['asset-packs'][0].items.map((i: Doc) => bytesOf(i.image))).toEqual(tiles9.map((t) => t.toString()))
    expect(db.series[0].spentUsd).toBeCloseTo(falExpressionsUsd(9), 5)
    expect(db.characters[0].locked).toBe(true)
  })

  it('tops up a pack that has only the base four: five faces are made and kept, the four it has stay as they are', async () => {
    fal.splitGrid.mockResolvedValue(tiles9)
    const { payload, db } = fakePayload({ series: nineSeries(), characters: [character(1, 'Khepri', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' }, ...[51, 52, 53, 54].map((id) => ({ id, filename: `f${id}.png` })))
    db['asset-packs'].push({ id: 9, character: 1, items: ['neutral', 'happy', 'surprised', 'sad'].map((name, i) => ({ kind: 'expression', name, image: 51 + i })) })
    const r = await createExpressions(payload, user, 1)
    expect(r.made).toBe(5)
    const items = db['asset-packs'][0].items
    expect(items.map((i: Doc) => i.name)).toEqual(['neutral', 'happy', 'surprised', 'sad', ...extras])
    expect(items.slice(0, 4).map((i: Doc) => i.image)).toEqual([51, 52, 53, 54])
    const bytesOf = (id: number) => db.media.find((m) => m.id === id)!.bytes.toString()
    expect(items.slice(4).map((i: Doc) => bytesOf(i.image))).toEqual(['tile4', 'tile5', 'tile6', 'tile7', 'tile8'])
  })

  it('shows nine faces in the pack status, with the cost still to pay, and keeps four for a series without extras', async () => {
    const { payload, db } = fakePayload({ series: nineSeries(), characters: [character(1, 'Khepri'), character(2, 'Nura', { referenceImages: [50] })] })
    db.media.push({ id: 50, filename: 'sheet.png' })
    const fresh = await packStatus(payload, user, 1)
    expect(fresh.items.map((i) => i.name)).toEqual(['neutral', 'happy', 'surprised', 'sad', ...extras])
    expect(fresh.remainingUsd).toBeCloseTo(FAL_SHEET_USD + falExpressionsUsd(9), 5)
    expect((await packStatus(payload, user, 2)).remainingUsd).toBeCloseTo(falExpressionsUsd(9), 5)
    const older = fakePayload({ series: series(), characters: [character(1, 'Khepri')] })
    expect((await packStatus(older.payload, user, 1)).items).toHaveLength(4)
  })
})
