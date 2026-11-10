import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type OpenAI from 'openai'
import { BASE_EXPRESSIONS, EXPRESSION_VOCAB, isExpression } from '@/lib/expressions'
import { allowedVibes, defaultExtraExpressions, EXTRA_EXPRESSIONS } from '@/lib/vibes'
import { bibleFromSpec, expressionsOfBible, resolveBible, sanitizeBible, withExpressions, type StyleBibleDraft } from '@/lib/styles/bible'
import { styleSpec } from '@/lib/styles/catalogue'
import { writeStyleBible } from '@/agents/style'
import { assetPlan, expressionPrompt, falExpressionsUsd, FAL_EXPRESSIONS_USD, gridShape, specKey } from '@/lib/art/plan'
import { expressionGridPrompt, splitGrid } from '@/lib/art/fal-images'
import { buildMockKit, kitFace, kitFiles } from '@/media/kit'
import { loadKit } from '@/media/kit-store'
import { placeholderPng, colourFor } from '@/media/placeholder'
import { imageSize, run, runCapture } from '@/engine/ffmpeg'

let root = ''
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'expr-pack-')) })
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

const base: string[] = [...BASE_EXPRESSIONS]
const extras = ['determined', 'scared', 'excited', 'proud', 'curious'] as const

describe('the extra expressions a niche needs by default', () => {
  it('are five known expressions that are not among the base four, the same every time', () => {
    for (const niche of ['Cat videos', 'Kids bedtime stories', 'Personal finance', 'Ancient history']) {
      const e = defaultExtraExpressions(niche)
      expect(e).toHaveLength(EXTRA_EXPRESSIONS)
      expect(new Set(e).size).toBe(EXTRA_EXPRESSIONS)
      expect(e.every((x) => isExpression(x) && !base.includes(x))).toBe(true)
      expect(defaultExtraExpressions(niche)).toEqual(e)
    }
  })

  it('are the feelings that appear most in the arcs of the vibes the niche offers, and can be asked for fewer or more', () => {
    const arcs = allowedVibes('Cat videos').flatMap((v) => v.arc)
    const e = defaultExtraExpressions('Cat videos')
    const count = (x: string) => arcs.filter((a) => a === x).length
    expect(count(e[0])).toBeGreaterThanOrEqual(count(e[4])) // most used first
    expect(defaultExtraExpressions('Cat videos', null, 2)).toEqual(e.slice(0, 2))
    expect(defaultExtraExpressions('Cat videos', null, 9)).toHaveLength(9)
  })
})

describe('the extra expressions in the style bible', () => {
  const draft = (over: Partial<StyleBibleDraft> = {}): StyleBibleDraft => ({ ...bibleFromSpec(styleSpec('pixar-3d')), expressions: [], ...over } as StyleBibleDraft)

  it('keeps known extras, drops the base four, repeats and made-up words, and keeps at most five', () => {
    const b = sanitizeBible(draft({ expressions: ['scared', 'happy', 'scared', 'proud', 'furious', 'excited', 'angry', 'curious', 'sleepy', 'smug'] as never }), 'pixar-3d')
    expect(b.expressions).toEqual(['scared', 'proud', 'excited', 'angry', 'curious'])
  })

  it('fills a short list up to five from the niche when it is given one, and leaves it alone when it is not (an older series)', () => {
    const picked = sanitizeBible(draft({ expressions: ['scared', 'proud'] as never }), 'pixar-3d', { niche: 'Cat videos' }).expressions
    expect(picked).toHaveLength(5)
    expect(picked.slice(0, 2)).toEqual(['scared', 'proud'])
    expect(new Set(picked).size).toBe(5)
    expect(sanitizeBible(draft({ expressions: ['scared'] as never }), 'pixar-3d').expressions).toEqual(['scared'])
    expect(sanitizeBible(draft(), 'pixar-3d').expressions).toEqual([])
  })

  it('survives being stored and read back, and an older bible without extras gives the base four only', () => {
    const stored = sanitizeBible(draft({ expressions: [...extras] as never }), 'pixar-3d')
    expect(resolveBible(JSON.parse(JSON.stringify(stored)), 'pixar-3d').expressions).toEqual([...extras])
    expect(expressionsOfBible(stored, 'pixar-3d')).toEqual([...base, ...extras])
    const { expressions: _gone, ...old } = stored
    expect(expressionsOfBible(old, 'pixar-3d')).toEqual(base)
    expect(expressionsOfBible(null, 'pixar-3d')).toEqual(base)
  })

  it('withExpressions fills only a bible that has none (the research cache from before they existed)', () => {
    const none = bibleFromSpec(styleSpec('pixar-3d'))
    expect(withExpressions(none, 'Cat videos').expressions).toEqual(defaultExtraExpressions('Cat videos'))
    const has = { ...none, expressions: ['scared'] }
    expect(withExpressions(has, 'Cat videos')).toBe(has)
  })
})

describe('the Style agent chooses the extra expressions', () => {
  const client = (parsed: unknown) => ({ responses: { parse: vi.fn(async () => ({ output_parsed: parsed, usage: { input_tokens: 600, output_tokens: 700, input_tokens_details: { cached_tokens: 0 } } })) } }) as unknown as OpenAI & { responses: { parse: ReturnType<typeof vi.fn> } }

  it('is told the list to choose from (without the base four), gets five, and tops up a short answer from the niche', async () => {
    const c = client({ ...bibleFromSpec(styleSpec('pixar-3d')), expressions: ['scared', 'proud', 'furious'] })
    const r = await writeStyleBible({ niche: 'Cat videos', styleId: 'pixar-3d' }, { client: c })
    const call = c.responses.parse.mock.calls[0][0] as { instructions: string }
    expect(call.instructions).toContain('Choose exactly 5 EXTRA facial expressions')
    expect(call.instructions).toContain(EXPRESSION_VOCAB.filter((e) => !base.includes(e as never)).join(', '))
    expect(call.instructions).not.toMatch(/from this list: neutral/)
    expect(r.bible.expressions).toHaveLength(5)
    expect(r.bible.expressions.slice(0, 2)).toEqual(['scared', 'proud']) // 'furious' is not an expression, so it is dropped and the niche fills in
  })

  it('still gives a series its niche\'s expressions when there is no AI key or the call fails', async () => {
    const k = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const r = await writeStyleBible({ niche: 'Cat videos', styleId: 'anime' })
      expect(r.source).toBe('mock')
      expect(r.bible.expressions).toEqual(defaultExtraExpressions('Cat videos'))
    } finally { if (k) process.env.OPENAI_API_KEY = k }
  })
})

describe('the reference pack of a series', () => {
  it('is the base four for an older series and nine for a new one, each with its own prompt', () => {
    expect(assetPlan().map((s) => s.name)).toEqual(base)
    const nine = assetPlan([...base, ...extras])
    expect(nine.map((s) => s.name)).toEqual([...base, ...extras])
    expect(new Set(nine.map(specKey)).size).toBe(9)
    expect(nine[5].prompt).toBe(expressionPrompt('scared'))
    expect(nine[5].prompt).toContain('a clearly scared facial expression')
    expect(assetPlan(['scared', 'neutral', 'scared']).map((s) => s.name)).toEqual([...base, 'scared']) // the base four always, no repeats
  })

  it('draws its faces in the smallest grid that holds them, and prices that one picture', () => {
    expect(gridShape(4)).toMatchObject({ cols: 2, rows: 2 })
    expect(gridShape(5)).toMatchObject({ cols: 3, rows: 2 })
    expect(gridShape(6)).toMatchObject({ cols: 3, rows: 2 })
    expect(gridShape(7)).toMatchObject({ cols: 3, rows: 3 })
    expect(gridShape(9)).toMatchObject({ cols: 3, rows: 3 })
    for (const n of [4, 6, 9]) {
      const g = gridShape(n)
      expect(g.width % g.cols).toBe(0); expect(g.height % g.rows).toBe(0) // panels are cut out exactly
      for (const side of [g.width, g.height]) { expect(side).toBeGreaterThanOrEqual(512); expect(side).toBeLessThanOrEqual(2048) } // fal's limits
    }
    expect(falExpressionsUsd(4)).toBe(FAL_EXPRESSIONS_USD)
    expect(falExpressionsUsd(9)).toBeGreaterThan(falExpressionsUsd(6)); expect(falExpressionsUsd(6)).toBeGreaterThan(falExpressionsUsd(4))
    expect(falExpressionsUsd(9)).toBeLessThan(0.1) // nine faces for under ten cents
  })

  it('has a grid prompt that names every panel by its row and column, in reading order', () => {
    const names = [...base, ...extras]
    const p = expressionGridPrompt('a small red fox', 'flat 2D cartoon', names, { cols: 3, rows: 3 })
    expect(p).toContain('3 by 3 grid of 9 equal square panels')
    expect(p).toContain('panel 1 (row 1, column 1): a clearly neutral expression')
    expect(p).toContain('panel 5 (row 2, column 2): a clearly determined expression')
    expect(p).toContain('panel 9 (row 3, column 3): a clearly curious expression')
    expect(p).not.toContain('Leave the last')
    const six = expressionGridPrompt('fox', 'style', [...base, 'scared'], { cols: 3, rows: 2 })
    expect(six).toContain('Leave the last 1 panel plain light grey')
    // the default is the 2 x 2 grid of the base four
    expect(expressionGridPrompt('fox', 'style')).toContain('2 by 2 grid of 4 equal square panels')
  })
})

describe('cutting a grid into faces', () => {
  const colours = ['red', 'green', 'blue', 'yellow', 'cyan', 'magenta', 'white', 'orange', 'purple']
  /** A picture of `cols` x `rows` cells, each a flat colour, so a cut panel can be checked by its colour. */
  async function grid(cols: number, rows: number, cell = 300) {
    const file = path.join(root, `grid-${cols}x${rows}-${cell}.png`)
    const n = cols * rows
    const layout = Array.from({ length: n }, (_, i) => `${(i % cols) * cell}_${Math.floor(i / cols) * cell}`).join('|')
    await run(['-y', '-v', 'error', ...colours.slice(0, n).flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=${cell}x${cell}`]),
      '-filter_complex', `${colours.slice(0, n).map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${n}:layout=${layout}`, '-frames:v', '1', file])
    return file
  }
  const dominant = async (buf: Buffer, i: number) => {
    const f = path.join(root, `tile-${i}-${buf.length}.png`)
    fs.writeFileSync(f, buf)
    const { stdout } = await runCapture(['-v', 'error', '-i', f, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return [...stdout]
  }

  it('cuts a 3 x 3 grid into nine panels in reading order, each holding only its own colour', async () => {
    const tiles = await splitGrid(fs.readFileSync(await grid(3, 3)), 3, 3)
    expect(tiles).toHaveLength(9)
    const want: Record<string, number[]> = { red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255], magenta: [255, 0, 255], white: [255, 255, 255], orange: [255, 165, 0], purple: [128, 0, 128] }
    for (const [i, c] of colours.entries()) {
      const got = await dominant(tiles[i], i)
      got.forEach((v, k) => expect(Math.abs(v - want[c][k]), `${c} channel ${k}`).toBeLessThan(40))
    }
  })

  it('cuts a 3 x 2 grid into six, and keeps the 2 x 2 default of the base four', async () => {
    const six = await splitGrid(fs.readFileSync(await grid(3, 2)), 3, 2)
    expect(six).toHaveLength(6)
    const f = path.join(root, 'six-0.png'); fs.writeFileSync(f, six[0])
    expect((await imageSize(f)).width).toBe(Math.round(900 * (1 - 0.06) / 3))
    expect(await splitGrid(fs.readFileSync(await grid(2, 2, 640)))).toHaveLength(4)
  })
})

describe('the kit of a character with extra expressions', () => {
  it('builds a placeholder kit with every face asked for, and the base four by default', async () => {
    const plain = await buildMockKit('Plain', path.join(root, 'k1'))
    expect(Object.keys(plain.expressions)).toEqual(base)
    const rich = await buildMockKit('Rich', path.join(root, 'k2'), [...base, ...extras])
    expect(Object.keys(rich.expressions)).toEqual([...base, ...extras])
    for (const f of kitFiles(rich)) expect(fs.existsSync(path.join(root, 'k2', f))).toBe(true)
  })

  it('gives the close-up of an expression, the nearest one the character has, or the sheet when it has none', async () => {
    const plain = await buildMockKit('Plain2', path.join(root, 'k3'))
    expect(kitFace(plain, 'sad')).toBe(plain.expressions.sad)
    expect(kitFace(plain, 'scared')).toBe(plain.expressions.surprised) // not in this pack: the nearest face
    expect(kitFace(plain, 'determined')).toBe(plain.expressions.neutral)
    const rich = await buildMockKit('Rich2', path.join(root, 'k4'), [...base, ...extras])
    expect(kitFace(rich, 'scared')).toBe(rich.expressions.scared)
    expect(kitFace(rich, 'excited')).toBe(rich.expressions.excited)
    expect(kitFace(rich, 'tearful')).toBe(rich.expressions.sad)
    expect(kitFace({ name: 'x', sheet: 'x-sheet.png', expressions: {} }, 'happy')).toBe('x-sheet.png')
  })

  describe('loaded from the database records', () => {
    const setup = async (tag: string, faces: string[]) => {
      const mediaDir = path.join(root, `media-${tag}`)
      fs.mkdirSync(mediaDir, { recursive: true })
      const files: Record<number, string> = {}
      for (let id = 1; id <= faces.length + 1; id++) { files[id] = `img-${id}.png`; await placeholderPng(path.join(mediaDir, files[id]), { width: 64, height: 64, colour: colourFor(String(id)), shape: 'face', variant: id }) }
      const items = faces.map((name, i) => ({ kind: 'expression', name, image: i + 2 }))
      const payload = {
        findByID: async ({ collection, id }: { collection: string; id: number }) => (collection === 'characters' ? { id: 7, name: 'Mango', referenceImages: [1] } : { id, filename: files[id] }),
        find: async () => ({ docs: [{ items }] }),
      }
      const ws = { assetsDir: path.join(root, `assets-${tag}`), libraryDir: path.join(root, `lib-${tag}`), mediaDir }
      fs.mkdirSync(ws.assetsDir, { recursive: true }); fs.mkdirSync(ws.libraryDir, { recursive: true })
      return { payload: payload as never, ws }
    }

    it('uses every face the pack has: nine for a new series, four for an older one', async () => {
      const nine = await setup('nine', [...base, ...extras])
      const kit9 = (await loadKit(nine.payload, 7, nine.ws))!
      expect(Object.keys(kit9.expressions)).toEqual([...base, ...extras])
      for (const f of kitFiles(kit9)) expect(fs.existsSync(path.join(nine.ws.assetsDir, f))).toBe(true)
      const four = await setup('four', base)
      expect(Object.keys((await loadKit(four.payload, 7, four.ws))!.expressions)).toEqual(base)
    })

    it('needs the base four: a pack missing one is not usable yet', async () => {
      const partial = await setup('partial', ['neutral', 'happy', 'scared', 'proud'])
      expect(await loadKit(partial.payload, 7, partial.ws)).toBeNull()
    })

    it('is stored under a different name once extras are added, so a bigger pack never reuses the old kit', async () => {
      const a = await setup('same-a', base)
      const b = await setup('same-b', [...base, ...extras])
      await loadKit(a.payload, 7, a.ws); await loadKit(b.payload, 7, b.ws)
      const dirName = (ws: { libraryDir: string }) => fs.readdirSync(ws.libraryDir).find((d) => d.startsWith('kit-mango'))
      expect(dirName(a.ws)).not.toBe(dirName(b.ws))
    })
  })
})
