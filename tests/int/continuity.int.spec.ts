import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkClipContinuity, GALLERY_MAX, galleryReferences, judgeContinuity, makeContactSheet, saveApprovedFrame, SHEET_FRAMES, type CastRef } from '@/pipeline/continuity'
import { imageSize, run } from '@/engine/ffmpeg'
import { createMockMedia } from '@/media/mock'
import type { ContinuityResult, MediaServices } from '@/media/types'

let dir = ''
let clip = ''
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-'))
  clip = path.join(dir, 'clip.mp4')
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=5', '-pix_fmt', 'yuv420p', clip])
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const cast: CastRef[] = [{ name: 'Mango', reference: '/m.png', main: true }, { name: 'Owl', reference: '/o.png', main: false }]
const result = (over: Partial<ContinuityResult> = {}): ContinuityResult => ({
  characters: [{ name: 'Mango', sameIdentity: 0.95, driftStartSec: null, issues: [] }, { name: 'Owl', sameIdentity: 0.9, driftStartSec: null, issues: [] }], undeclaredCharacters: [], costUsd: 0.003, ...over,
})

describe('contact sheet', () => {
  it('puts evenly spaced frames of the clip side by side in one JPEG', async () => {
    const out = await makeContactSheet(clip, path.join(dir, 'sheet.jpg'), 5, SHEET_FRAMES, 256)
    const size = await imageSize(out)
    expect(size.height).toBe(256)
    expect(size.width).toBe(Math.round((256 * 360) / 640 / 2) * 2 * SHEET_FRAMES) // five 144-wide frames
  })
})

describe('judging a clip', () => {
  it('passes when every character stays on-model and nobody extra appears', () => {
    expect(judgeContinuity(result(), cast, 3)).toMatchObject({ ok: true, issues: [], worst: null })
  })

  it('fails a main character below 0.8 but accepts a supporting one at 0.7', () => {
    const low = result({ characters: [{ name: 'Mango', sameIdentity: 0.75, driftStartSec: null, issues: ['ears differ'] }, { name: 'Owl', sameIdentity: 0.7, driftStartSec: null, issues: [] }] })
    const v = judgeContinuity(low, cast, 3)
    expect(v.ok).toBe(false)
    expect(v.worst).toMatchObject({ name: 'Mango', score: 0.75 })
    expect(v.issues).toHaveLength(1)
    expect(v.issues[0]).toContain('ears differ')
  })

  it('fails a character that changes inside the used part, but not one that changes after it', () => {
    const early = result({ characters: [{ name: 'Mango', sameIdentity: 0.9, driftStartSec: 2, issues: ['fur turns white'] }, { name: 'Owl', sameIdentity: 0.9, driftStartSec: null, issues: [] }] })
    expect(judgeContinuity(early, cast, 3)).toMatchObject({ ok: false, worst: { name: 'Mango', driftStartSec: 2 } })
    const late = result({ characters: [{ name: 'Mango', sameIdentity: 0.5, driftStartSec: 3.2, issues: [] }, { name: 'Owl', sameIdentity: 0.9, driftStartSec: null, issues: [] }] })
    expect(judgeContinuity(late, cast, 3).ok).toBe(true) // the rest of the clip is cut off in assembly
  })

  it('fails when a character that is not in the cast appears', () => {
    const v = judgeContinuity(result({ undeclaredCharacters: ['a stray dog'] }), cast, 3)
    expect(v.ok).toBe(false)
    expect(v.undeclared).toEqual(['a stray dog'])
    expect(v.issues.join(' ')).toContain('a stray dog')
  })

  it('checks a clip end to end through the media service (sheet, check, verdict)', async () => {
    const seen: { sheet: string; names: string[]; seconds: number }[] = []
    const base = createMockMedia({ assetsDir: dir, libraryDir: dir })
    const media: MediaServices = { ...base, continuity: async (s) => { seen.push({ sheet: s.sheetFile, names: s.characters.map((c) => c.name), seconds: s.clipSeconds }); return result() } }
    const r = await checkClipContinuity(media, { clip, workDir: dir, label: 'shot 1 a1', cast, usedSeconds: 3, clipSeconds: 5 })
    expect(r.verdict.ok).toBe(true)
    expect(r.costUsd).toBe(0.003)
    expect(seen[0].names).toEqual(['Mango', 'Owl'])
    expect(fs.existsSync(seen[0].sheet)).toBe(true)
    expect(seen[0].seconds).toBe(3) // only the used part is sampled
  })
})

describe('approved-frames gallery', () => {
  it('keeps the newest frames of a character and caps the gallery', async () => {
    const lib = path.join(dir, 'library')
    for (let i = 0; i < GALLERY_MAX + 2; i++) { await saveApprovedFrame(lib, 'Mango', clip, 1); await new Promise((r) => setTimeout(r, 3)) }
    expect(fs.readdirSync(path.join(lib, 'gallery', 'mango'))).toHaveLength(GALLERY_MAX)
  })

  it('copies the newest frames into the episode so a keyframe edit can use them as references', async () => {
    const lib = path.join(dir, 'library2'), assets = path.join(dir, 'assets2')
    fs.mkdirSync(assets)
    expect(galleryReferences(lib, 'Mango', assets, 2)).toEqual([]) // nothing yet
    await saveApprovedFrame(lib, 'Mango', clip, 1); await new Promise((r) => setTimeout(r, 3))
    await saveApprovedFrame(lib, 'Mango', clip, 2)
    const refs = galleryReferences(lib, 'Mango', assets, 2)
    expect(refs).toEqual(['gallery-mango-0.jpg', 'gallery-mango-1.jpg'])
    for (const f of refs) expect(fs.existsSync(path.join(assets, f))).toBe(true)
    expect(galleryReferences(lib, 'Luna', assets, 2)).toEqual([]) // a different character has its own gallery
  })
})
