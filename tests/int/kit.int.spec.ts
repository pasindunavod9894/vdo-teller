import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assetPlan, EXPRESSIONS, specKey } from '@/lib/art/plan'
import { buildMockKit, copyKit, kitFiles, kitReferences } from '@/media/kit'
import { loadKit } from '@/media/kit-store'
import { imageSize } from '@/engine/ffmpeg'
import { colourFor, placeholderPng } from '@/media/placeholder'

let root = ''
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-')) })

describe('reference pack plan', () => {
  it('is four expressions, each an edit of the reference sheet that keeps the character the same', () => {
    const plan = assetPlan()
    expect(plan.map((s) => s.name)).toEqual([...EXPRESSIONS])
    expect(plan.every((s) => s.kind === 'expression')).toBe(true)
    expect(new Set(plan.map(specKey)).size).toBe(4)
    for (const s of plan) expect(s.prompt).toMatch(/same character as in the reference/i)
  })
})

describe('placeholder kit (free)', () => {
  it('has a reference sheet and every expression, as real PNG files', async () => {
    const dir = path.join(root, 'mock')
    const k = await buildMockKit('Mango', dir)
    expect(Object.keys(k.expressions).sort()).toEqual([...EXPRESSIONS].sort())
    expect(kitFiles(k)).toHaveLength(5)
    for (const f of kitFiles(k)) expect(fs.existsSync(path.join(dir, f))).toBe(true)
    expect(await imageSize(path.join(dir, k.sheet))).toEqual({ width: 768, height: 512 })
  })

  it('gives each character its own look, deterministically', async () => {
    const a = await buildMockKit('Mango', path.join(root, 'a')), b = await buildMockKit('Luna', path.join(root, 'b')), a2 = await buildMockKit('Mango', path.join(root, 'a2'))
    expect(fs.readFileSync(path.join(root, 'a', a.sheet)).equals(fs.readFileSync(path.join(root, 'b', b.sheet)))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'a', a.sheet)).equals(fs.readFileSync(path.join(root, 'a2', a2.sheet)))).toBe(true)
    expect(colourFor('Mango')).toBe(colourFor('Mango'))
    expect(colourFor('Mango')).not.toBe(colourFor('Luna'))
  })

  it('copies a kit into an episode workspace', async () => {
    const from = path.join(root, 'from'), to = path.join(root, 'to')
    const k = await buildMockKit('Copy', from)
    copyKit(k, from, to)
    for (const f of kitFiles(k)) expect(fs.existsSync(path.join(to, f))).toBe(true)
  })

  it('offers the sheet first, then the neutral face, and never more than asked for', async () => {
    const k = await buildMockKit('Refs', path.join(root, 'refs'))
    expect(kitReferences(k, 2)).toEqual([k.sheet, k.expressions.neutral])
    expect(kitReferences(k, 5)).toHaveLength(5)
    expect(new Set(kitReferences(k, 5)).size).toBe(5)
  })
})

describe('loading a real kit from the database records', () => {
  // a tiny stand-in for Payload: one character with a reference sheet, an asset pack, and the media files on disk
  const setup = async (complete: boolean) => {
    const mediaDir = path.join(root, `media-${complete}`)
    fs.mkdirSync(mediaDir, { recursive: true })
    const files: Record<number, string> = {}
    for (let id = 1; id <= 5; id++) { files[id] = `img-${id}.png`; await placeholderPng(path.join(mediaDir, files[id]), { width: 64, height: 64, colour: colourFor(String(id)), shape: 'face', variant: id }) }
    const items = EXPRESSIONS.slice(0, complete ? 4 : 2).map((e, i) => ({ kind: 'expression', name: e, image: i + 2 }))
    const payload = {
      findByID: async ({ collection, id }: { collection: string; id: number }) => (collection === 'characters' ? { id: 7, name: 'Mango', referenceImages: [1] } : { id, filename: files[id] }),
      find: async () => ({ docs: [{ items }] }),
    }
    const ws = { assetsDir: path.join(root, `assets-${complete}`), libraryDir: path.join(root, `lib-${complete}`), mediaDir }
    fs.mkdirSync(ws.assetsDir, { recursive: true }); fs.mkdirSync(ws.libraryDir, { recursive: true })
    return { payload: payload as never, ws }
  }

  it('returns null while the pack is incomplete, so an episode never draws a placeholder for a real character', async () => {
    const { payload, ws } = await setup(false)
    expect(await loadKit(payload, 7, ws)).toBeNull()
  })

  it('assembles the kit once into the series library and copies it into the episode, and reuses it next time', async () => {
    const { payload, ws } = await setup(true)
    const kit = (await loadKit(payload, 7, ws))!
    expect(kit.name).toBe('Mango')
    expect(Object.keys(kit.expressions).sort()).toEqual([...EXPRESSIONS].sort())
    for (const f of kitFiles(kit)) expect(fs.existsSync(path.join(ws.assetsDir, f))).toBe(true)
    const manifests = fs.readdirSync(ws.libraryDir).filter((d) => d.startsWith('kit-mango'))
    expect(manifests).toHaveLength(1)
    const again = await loadKit(payload, 7, ws)
    expect(again).toEqual(kit)
    expect(fs.readdirSync(ws.libraryDir).filter((d) => d.startsWith('kit-mango'))).toHaveLength(1)
  })
})
