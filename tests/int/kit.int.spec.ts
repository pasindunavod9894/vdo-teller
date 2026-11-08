import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { buildKit, buildMockKit, buildMockSources, copyKit, kitFiles } from '@/media/kit'

let root = ''
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-')) })

const raw = async (f: string) => { const r = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: r.data, w: r.info.width, h: r.info.height } }

/** Mean colour difference (0-255) between two same-size images over a band of rows, counting only pixels visible in both. */
async function bandDiff(a: string, b: string, y0: number, y1: number) {
  const A = await raw(a), B = await raw(b)
  expect(A.w).toBe(B.w); expect(A.h).toBe(B.h)
  let sum = 0, n = 0
  for (let y = Math.round(A.h * y0); y < Math.round(A.h * y1); y++) for (let x = 0; x < A.w; x++) {
    const i = (y * A.w + x) * 4
    if (A.data[i + 3] > 40 && B.data[i + 3] > 40) { sum += Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]); n++ }
  }
  return n ? sum / n / 3 : 0
}

describe('placeholder kit (free)', () => {
  it('has every role the engine needs, as real files', async () => {
    const dir = path.join(root, 'mock')
    const k = await buildMockKit('Mango', dir)
    expect(k.face).toHaveLength(4)
    expect(k.walk).toHaveLength(2)
    expect(Object.keys(k.emotions).sort()).toEqual(['happy', 'smug', 'surprised'])
    for (const f of kitFiles(k)) expect(fs.existsSync(path.join(dir, f))).toBe(true)
  })
  it('gives each character its own look, deterministically', async () => {
    const a = await buildMockKit('Mango', path.join(root, 'a')), b = await buildMockKit('Luna', path.join(root, 'b')), a2 = await buildMockKit('Mango', path.join(root, 'a2'))
    expect(fs.readFileSync(path.join(root, 'a', a.stand)).equals(fs.readFileSync(path.join(root, 'b', b.stand)))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'a', a.stand)).equals(fs.readFileSync(path.join(root, 'a2', a2.stand)))).toBe(true)
  })
  it('copies a kit into an episode workspace', async () => {
    const from = path.join(root, 'from'), to = path.join(root, 'to')
    const k = await buildMockKit('Copy', from)
    copyKit(k, from, to)
    for (const f of kitFiles(k)) expect(fs.existsSync(path.join(to, f))).toBe(true)
  })
})

describe('buildKit (the assembly that runs on real generated art)', () => {
  it('assembles a complete kit from the source images', async () => {
    const src = await buildMockSources('Mango', path.join(root, 'src'))
    const out = path.join(root, 'kit')
    const k = await buildKit(src, out, 'Mango')
    for (const f of kitFiles(k)) expect(fs.existsSync(path.join(out, f))).toBe(true)
    expect(k.face).toHaveLength(4)
  }, 60000)

  it('keeps the eyes and head identical across the four mouth frames: only the mouth changes', async () => {
    const out = path.join(root, 'kit'); const k = JSON.parse(JSON.stringify(await buildKit(await buildMockSources('Mango', path.join(root, 'src')), out, 'Mango')))
    const upper = (f: string) => bandDiff(path.join(out, k.face[0]), path.join(out, f), 0.0, 0.45)
    for (const f of k.face.slice(1)) expect(await upper(f)).toBeLessThan(3) // eyes, ears, hat unchanged
    // ...while the mouth really does differ between closed and wide open
    expect(await bandDiff(path.join(out, k.face[0]), path.join(out, k.face[3]), 0.5, 0.72)).toBeGreaterThan(8)
  }, 60000)

  it('puts the walking and jumping bodies on one foot baseline', async () => {
    const out = path.join(root, 'kit'); const k = await buildKit(await buildMockSources('Mango', path.join(root, 'src')), out, 'Mango')
    const bottoms: number[] = []
    for (const f of [k.stand, ...k.walk]) {
      const { data, w, h } = await raw(path.join(out, f))
      let bottom = 0
      for (let y = h - 1; y >= 0 && !bottom; y--) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 16) { bottom = y; break }
      bottoms.push(bottom)
    }
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(2)
  }, 60000)

  it('makes a blink overlay that is transparent everywhere except around the eyes', async () => {
    const out = path.join(root, 'kit'); const k = await buildKit(await buildMockSources('Mango', path.join(root, 'src')), out, 'Mango')
    const { data, w, h } = await raw(path.join(out, k.blink))
    let top = 0, lower = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 40) { y < h * 0.62 ? top++ : lower++ }
    expect(top).toBeGreaterThan(200)
    expect(lower).toBe(0)
  }, 60000)
})

describe('loadKit (from stored images, with a fake database)', () => {
  it('assembles the kit once, caches it in the series library, and returns null while images are missing', async () => {
    const { loadKit } = await import('@/media/kit-store')
    const { assetPlan, specKey } = await import('@/lib/art/plan')
    const mediaDir = path.join(root, 'mediadir'); fs.mkdirSync(mediaDir, { recursive: true })
    const src = await buildMockSources('Mango', path.join(root, 'ksrc'))
    const byKey: Record<string, string> = {
      'pose:standing-front': src.stand, 'pose:walking-side-a': src.walkA, 'pose:walking-side-b': src.walkB, 'pose:crouch': src.crouch, 'pose:airborne': src.air,
      'mouth:closed': src.closed, 'emotion:happy': src.happy, 'emotion:surprised': src.surprised, 'emotion:smug': src.smug,
      'mouth:slightly-open': src.slightlyOpen, 'mouth:round-oh': src.roundOh, 'mouth:wide-open': src.wideOpen, 'face:blink': src.blink,
    }
    const keys = assetPlan().map(specKey)
    expect(keys.sort()).toEqual(Object.keys(byKey).sort()) // the plan and this test agree on the 13 images
    const mediaDocs: Record<number, { filename: string }> = {}
    const items = keys.map((k, i) => { const id = i + 1; const f = `m${id}.png`; fs.copyFileSync(byKey[k], path.join(mediaDir, f)); mediaDocs[id] = { filename: f }; const [kind, name] = k.split(':'); return { kind, name, image: id } })
    const fake = (packItems: typeof items) => ({
      findByID: async ({ collection, id }: { collection: string; id: number | string }) => (collection === 'characters' ? { id, name: 'Mango' } : mediaDocs[id as number]),
      find: async () => ({ docs: [{ items: packItems }] }),
    }) as never
    const ws = { assetsDir: path.join(root, 'k-assets'), libraryDir: path.join(root, 'k-lib'), mediaDir }
    fs.mkdirSync(ws.assetsDir, { recursive: true }); fs.mkdirSync(ws.libraryDir, { recursive: true })

    expect(await loadKit(fake(items.slice(0, 5)), 1, ws)).toBeNull() // not all images exist yet
    const kit = await loadKit(fake(items), 1, ws)
    expect(kit).not.toBeNull()
    for (const f of kitFiles(kit!)) expect(fs.existsSync(path.join(ws.assetsDir, f))).toBe(true)
    const cached = fs.readdirSync(ws.libraryDir).filter((d) => d.startsWith('kit-'))
    expect(cached).toHaveLength(1)
    // a second episode reuses the cached kit (no rebuild: the manifest is read)
    const ws2 = { ...ws, assetsDir: path.join(root, 'k-assets-2') }
    fs.mkdirSync(ws2.assetsDir, { recursive: true })
    expect((await loadKit(fake(items), 1, ws2))!.face).toEqual(kit!.face)
    expect(fs.readdirSync(ws.libraryDir).filter((d) => d.startsWith('kit-'))).toHaveLength(1)
  }, 120000)
})
