import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'
import type { Payload } from 'payload'
import type { Character, Series, User } from '@/payload-types'
import { MODELS } from '@/agents/models'
import { expressionsOfBible, imageStyle } from '@/lib/styles/bible'
import { DEFAULT_SERIES_CAP_USD } from '@/pipeline/budget'
import { heuristicTheme, isTheme, type Theme } from '@/themes/palettes'
import { pickTheme } from '@/lib/theme/pick'
import { assetPlan, type AssetKind, falExpressionsUsd, FAL_SHEET_SIZE, FAL_SHEET_USD, gridShape, IMAGE_COST, KEYFRAME_QUALITY, REFERENCE_QUALITY, specKey } from './plan'
import { characterImageProvider, expressionGridPrompt, FalImageError, falImage, splitGrid } from './fal-images'

const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/** OpenAI's safety filter occasionally rejects harmless prompts; retry once, then explain. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn() } catch (e) {
      const blocked = e instanceof OpenAI.APIError && e.status === 400 && /safety system|moderation_blocked/i.test(`${e.code ?? ''} ${e.message}`)
      if (!blocked) throw e
      if (attempt >= 1) throw new ArtError("The image system declined this description. Try changing the character's look and try again.", 422)
    }
  }
}

export class ArtError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

type Bible = { look?: string; personality?: string }
const bibleOf = (c: Character): Bible => (c.bible && typeof c.bible === 'object' ? (c.bible as Bible) : {})

/** Refuse to spend past the series cost cap. */
function assertBudget(series: Series, cost: number) {
  const spent = series.spentUsd ?? 0
  const cap = series.costCapUsd ?? DEFAULT_SERIES_CAP_USD
  if (spent + cost > cap) throw new ArtError(`Cost cap reached ($${spent.toFixed(2)} of $${cap.toFixed(2)} spent).`, 402)
}

// Both characters of a series are built at the same time, so the spend counter is updated one at a time and from the stored value.
const spendLocks = new Map<string, Promise<unknown>>()
async function addSpend(payload: Payload, series: Series, cost: number) {
  const key = String(series.id)
  const run = (spendLocks.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const fresh = await payload.findByID({ collection: 'series', id: series.id, depth: 0, overrideAccess: true })
    await payload.update({ collection: 'series', id: series.id, data: { spentUsd: (fresh.spentUsd ?? 0) + cost }, overrideAccess: true })
  })
  spendLocks.set(key, run)
  await run
}

/** A fal error becomes a message the dashboard can show. */
function falError(e: unknown): never {
  if (e instanceof FalImageError) {
    if (e.kind === 'policy') throw new ArtError("The image system declined this description. Try changing the character's look and try again.", 422)
    if (e.kind === 'auth') throw new ArtError('The fal.ai key is missing or not accepted.', 503)
  }
  throw e
}

export async function loadOwned(payload: Payload, user: User, characterId: string | number) {
  const character = await payload.findByID({ collection: 'characters', id: characterId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!character || (typeof character.owner === 'object' ? character.owner.id : character.owner) !== user.id) throw new ArtError('Character not found', 404)
  const seriesId = typeof character.series === 'object' ? character.series.id : character.series
  const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
  return { character, series }
}

async function saveImage(payload: Payload, b64: string | Buffer, name: string, alt: string) {
  const data = typeof b64 === 'string' ? Buffer.from(b64, 'base64') : b64
  return payload.create({
    collection: 'media', data: { alt }, overrideAccess: true,
    file: { data, mimetype: 'image/png', name: `${name}-${Date.now()}.png`, size: data.length },
  })
}

/** ~150-token description used in every prompt (plan §3b). Cheap model, tiny output. */
async function writeCanonical(series: Series, character: Character) {
  const b = bibleOf(character)
  const res = await client().responses.create({
    model: MODELS.showrunner,
    reasoning: { effort: 'minimal' },
    instructions: 'Write ONE compact visual description (max 60 words) of a character for an image prompt: species/age, face or fur, colours, markings, build, outfit, one signature prop. No story, no names of brands or existing characters.',
    input: `Name: ${character.name}\nRole: ${character.role ?? ''}\nLook: ${b.look ?? ''}\nPersonality: ${b.personality ?? ''}\nStyle: ${imageStyle(series.styleBible, series.style)}`,
    max_output_tokens: 300,
  })
  return res.output_text.trim()
}

/** A finished pack is locked: every reel of the series uses exactly these images. Only `unlockCharacter` opens it again. */
function assertUnlocked(character: Character) {
  if (character.locked) throw new ArtError('This character is locked, so every reel keeps looking the same. Use "Edit character" to change it.', 409)
}

export async function createReference(payload: Payload, user: User, characterId: string | number) {
  const { character, series } = await loadOwned(payload, user, characterId)
  assertUnlocked(character)
  const provider = characterImageProvider()
  const quality = REFERENCE_QUALITY
  const cost = provider === 'fal' ? FAL_SHEET_USD : IMAGE_COST[quality]
  assertBudget(series, cost)

  const canonical = character.canonicalDescription || (await writeCanonical(series, character))
  const prompt = `Character reference sheet of ONE character, on a plain light-grey background: front view, side view and a three-quarter view, same character in each, full body, evenly spaced. ${canonical} Art style: ${imageStyle(series.styleBible, series.style)}. No text, no labels, no other characters.`
  let image: string | Buffer
  if (provider === 'fal') {
    image = await falImage({ prompt, size: FAL_SHEET_SIZE }).catch(falError)
  } else {
    const img = await withRetry(() => client().images.generate({ model: 'gpt-image-2', prompt, size: '1536x1024', quality, n: 1 }))
    const b64 = img.data?.[0]?.b64_json
    if (!b64) throw new ArtError('Image generation returned nothing', 502)
    image = b64
  }
  const media = await saveImage(payload, image, `ref-${character.name.toLowerCase().replace(/\W+/g, '-')}`, `${character.name} reference sheet`)
  await payload.update({
    collection: 'characters', id: character.id, overrideAccess: true,
    data: { canonicalDescription: canonical, referenceImages: [media.id] },
  })
  await addSpend(payload, series, cost)
  return { canonicalDescription: canonical, mediaId: media.id, url: media.url, cost }
}

async function readMediaFile(payload: Payload, mediaId: string | number) {
  const media = await payload.findByID({ collection: 'media', id: mediaId, depth: 0, overrideAccess: true })
  if (!media.filename) throw new ArtError('Reference image missing', 404)
  return fs.readFile(path.resolve(process.cwd(), 'media', media.filename))
}

export async function packStatus(payload: Payload, user: User, characterId: string | number) {
  const { character, series } = await loadOwned(payload, user, characterId)
  const plan = assetPlan(expressionsOfBible(series.styleBible, series.style))
  const pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 1, limit: 1, overrideAccess: true })).docs[0]
  const done = new Map((pack?.items ?? []).map((i) => [`${i.kind}:${i.name}`, typeof i.image === 'object' ? i.image.url : undefined]))
  const provider = characterImageProvider()
  const quality = REFERENCE_QUALITY
  const costPerImage = provider === 'fal' ? FAL_SHEET_USD : IMAGE_COST[quality]
  const missing = plan.filter((s) => !done.has(specKey(s))).length
  const expressionsFull = provider === 'fal' ? falExpressionsUsd(plan.length) : IMAGE_COST[quality] * plan.length
  return {
    hasReference: Boolean(character.referenceImages?.length),
    locked: Boolean(character.locked),
    packVersion: character.packVersion ?? 0,
    provider,
    quality: provider === 'fal' ? 'fal.ai FLUX.2' : quality,
    costPerImage,
    /** what it still costs to finish this character's pack */
    remainingUsd: (character.referenceImages?.length ? 0 : costPerImage) + (missing ? (provider === 'fal' ? falExpressionsUsd(plan.length) : IMAGE_COST[quality] * missing) : 0),
    /** what it costs to make the whole pack from scratch (used when the character is edited) */
    rebuildUsd: costPerImage + expressionsFull,
    spentUsd: series.spentUsd ?? 0,
    capUsd: series.costCapUsd ?? DEFAULT_SERIES_CAP_USD,
    items: plan.map((s) => ({ kind: s.kind, name: s.name, done: done.has(specKey(s)), url: done.get(specKey(s)) ?? null })),
  }
}

/**
 * Generates ONE missing expression (the client loops), so a request never runs for minutes. Every expression is a gpt-image-2
 * edit of the reference sheet. When the last one is made the pack is complete and the character is locked.
 */
export async function createNextAsset(payload: Payload, user: User, characterId: string | number, only?: { kind: string; name: string }) {
  if (characterImageProvider() === 'fal' && !only) { await createExpressions(payload, user, characterId); return { done: true as const } }
  const { character, series } = await loadOwned(payload, user, characterId)
  const refId = character.referenceImages?.[0]
  if (!refId) throw new ArtError('Create the reference sheet first', 409)
  const plan = assetPlan(expressionsOfBible(series.styleBible, series.style))
  let pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 0, limit: 1, overrideAccess: true })).docs[0]
  const have = new Set((pack?.items ?? []).map((i) => `${i.kind}:${i.name}`))
  const next = plan.find((s) => (only ? s.kind === only.kind && s.name === only.name : true) && !have.has(specKey(s)))
  if (!next) {
    // nothing left to make: the pack is complete, so lock the character (once)
    if (plan.every((s) => have.has(specKey(s))) && !character.locked) {
      await payload.update({ collection: 'characters', id: character.id, data: { locked: true, packVersion: (character.packVersion ?? 0) + 1 }, overrideAccess: true })
    }
    return { done: true as const }
  }
  assertUnlocked(character)

  const quality = REFERENCE_QUALITY
  const cost = IMAGE_COST[quality]
  assertBudget(series, cost)
  const canonical = character.canonicalDescription ?? ''
  const source = await readMediaFile(payload, typeof refId === 'object' ? refId.id : refId)
  const prompt = `${next.prompt} Character: ${canonical} Art style: ${imageStyle(series.styleBible, series.style)}.`
  const img = await withRetry(async () => client().images.edit({
    model: 'gpt-image-2',
    image: await toFile(source, 'source.png', { type: 'image/png' }),
    prompt, output_format: 'png', size: '1024x1024', quality,
  }))
  const b64 = img.data?.[0]?.b64_json
  if (!b64) throw new ArtError('Image generation returned nothing', 502)
  const media = await saveImage(payload, b64, `${character.name.toLowerCase().replace(/\W+/g, '-')}-${next.kind}-${next.name}`, `${character.name} ${next.kind} ${next.name}`)
  const items = [...(pack?.items ?? []).map((i) => ({ kind: i.kind, name: i.name, image: typeof i.image === 'object' ? i.image.id : i.image })), { kind: next.kind, name: next.name, image: media.id }]
  if (pack) pack = await payload.update({ collection: 'asset-packs', id: pack.id, data: { items }, overrideAccess: true })
  else pack = await payload.create({ collection: 'asset-packs', data: { owner: user.id, character: character.id, items }, overrideAccess: true })
  await addSpend(payload, series, cost)
  return { done: false as const, kind: next.kind, name: next.name, url: media.url, cost }
}

/**
 * Makes every missing expression in one request, then locks the character. With fal.ai that is ONE edit of the sheet that draws
 * a 2x2 grid of faces (cut into four with FFmpeg); with OpenAI each missing expression is an edit, all made at the same time.
 * Same result either way: the images are saved exactly as before, so videos use them unchanged.
 */
export async function createExpressions(payload: Payload, user: User, characterId: string | number) {
  const { character, series } = await loadOwned(payload, user, characterId)
  const refId = character.referenceImages?.[0]
  if (!refId) throw new ArtError('Create the reference sheet first', 409)
  const plan = assetPlan(expressionsOfBible(series.styleBible, series.style))
  let pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 0, limit: 1, overrideAccess: true })).docs[0]
  const have = new Set((pack?.items ?? []).map((i) => `${i.kind}:${i.name}`))
  const missing = plan.filter((s) => !have.has(specKey(s)))
  if (!missing.length) {
    if (!character.locked) await payload.update({ collection: 'characters', id: character.id, data: { locked: true, packVersion: (character.packVersion ?? 0) + 1 }, overrideAccess: true })
    return { done: true as const, made: 0, cost: 0 }
  }
  assertUnlocked(character)

  const provider = characterImageProvider()
  const cost = provider === 'fal' ? falExpressionsUsd(plan.length) : IMAGE_COST[REFERENCE_QUALITY] * missing.length
  assertBudget(series, cost)
  const canonical = character.canonicalDescription ?? ''
  const style = imageStyle(series.styleBible, series.style)
  const source = await readMediaFile(payload, typeof refId === 'object' ? refId.id : refId)

  let made: { name: string; kind: AssetKind; image: Buffer | string }[]
  if (provider === 'fal') {
    // every face of the series' pack in ONE picture (2 x 2 for four, 3 x 3 for nine), cut into panels; only the missing ones are kept
    const shape = gridShape(plan.length)
    const grid = await falImage({ prompt: expressionGridPrompt(canonical, style, plan.map((p) => p.name), shape), size: { width: shape.width, height: shape.height }, refs: [source] }).catch(falError)
    const tiles = await splitGrid(grid, shape.cols, shape.rows)
    made = missing.map((s) => ({ kind: s.kind, name: s.name, image: tiles[plan.findIndex((p) => p.name === s.name)] }))
  } else {
    made = await Promise.all(missing.map(async (s) => {
      const img = await withRetry(async () => client().images.edit({
        model: 'gpt-image-2', image: await toFile(source, 'source.png', { type: 'image/png' }),
        prompt: `${s.prompt} Character: ${canonical} Art style: ${style}.`, output_format: 'png', size: '1024x1024', quality: REFERENCE_QUALITY,
      }))
      const b64 = img.data?.[0]?.b64_json
      if (!b64) throw new ArtError('Image generation returned nothing', 502)
      return { kind: s.kind, name: s.name, image: b64 }
    }))
  }
  const slug = character.name.toLowerCase().replace(/\W+/g, '-')
  const saved = await Promise.all(made.map(async (m) => ({ kind: m.kind, name: m.name, image: (await saveImage(payload, m.image, `${slug}-${m.kind}-${m.name}`, `${character.name} ${m.kind} ${m.name}`)).id })))
  const items = [...(pack?.items ?? []).map((i) => ({ kind: i.kind, name: i.name, image: typeof i.image === 'object' ? i.image.id : i.image })), ...saved]
  if (pack) pack = await payload.update({ collection: 'asset-packs', id: pack.id, data: { items }, overrideAccess: true })
  else pack = await payload.create({ collection: 'asset-packs', data: { owner: user.id, character: character.id, items }, overrideAccess: true })
  await addSpend(payload, series, cost)
  await payload.update({ collection: 'characters', id: character.id, data: { locked: true, packVersion: (character.packVersion ?? 0) + 1 }, overrideAccess: true })
  return { done: true as const, made: saved.length, cost }
}

/**
 * "Edit character": opens a locked character for changes. Its reference sheet and expressions are cleared so they are made
 * again from the new description; the pack is locked again (as a new version) when it is complete. Reels already made keep their look.
 */
export async function unlockCharacter(payload: Payload, user: User, characterId: string | number, patch: { look?: string; personality?: string; name?: string } = {}) {
  const { character } = await loadOwned(payload, user, characterId)
  const bible = { ...bibleOf(character), ...(patch.look ? { look: patch.look } : {}), ...(patch.personality ? { personality: patch.personality } : {}) }
  const pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 0, limit: 1, overrideAccess: true })).docs[0]
  if (pack) await payload.update({ collection: 'asset-packs', id: pack.id, data: { items: [] }, overrideAccess: true })
  await payload.update({
    collection: 'characters', id: character.id, overrideAccess: true,
    data: { locked: false, referenceImages: [], canonicalDescription: patch.look ? '' : character.canonicalDescription, bible: bible as never, ...(patch.name ? { name: patch.name } : {}) },
  })
  return { unlocked: true as const, packVersion: character.packVersion ?? 0 }
}

async function loadOwnedSeries(payload: Payload, user: User, seriesId: string | number) {
  const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!series || (typeof series.owner === 'object' ? series.owner.id : series.owner) !== user.id) throw new ArtError('Series not found', 404)
  return series
}

/** Picks (or re-picks) the dashboard theme. One cheap text call; saved on the series. */
export async function ensureTheme(payload: Payload, user: User, seriesId: string | number, force = false) {
  const series = await loadOwnedSeries(payload, user, seriesId)
  if (!force && isTheme(series.theme)) return series.theme as Theme
  const theme = await pickTheme({ title: series.title, niche: series.niche, subNiche: series.subNiche, style: series.style })
  await payload.update({ collection: 'series', id: series.id, data: { theme: theme as unknown as Record<string, unknown> }, overrideAccess: true })
  return theme
}

/** Wide banner for the dashboard hero, in the series style. Counts against the series cost cap. */
export async function createHero(payload: Payload, user: User, seriesId: string | number) {
  const series = await loadOwnedSeries(payload, user, seriesId)
  const quality = KEYFRAME_QUALITY
  const cost = IMAGE_COST[quality]
  assertBudget(series, cost)
  const theme = isTheme(series.theme) ? series.theme : heuristicTheme(`${series.niche} ${series.subNiche ?? ''}`, series.style)
  const scene = theme.heroPrompt || `A wide establishing scene for a ${series.niche} video series`
  const prompt = `Wide cinematic banner illustration. ${scene} Art style: ${imageStyle(series.styleBible, series.style)}. Colour mood: ${theme.mood}. Leave calm negative space on the left third. No text, no logos, no people, no brands.`
  const img = await withRetry(() => client().images.generate({ model: 'gpt-image-2', prompt, size: '1536x1024', quality, n: 1 }))
  const b64 = img.data?.[0]?.b64_json
  if (!b64) throw new ArtError('Image generation returned nothing', 502)
  const media = await saveImage(payload, b64, `hero-${series.id}`, `${series.title} banner`)
  await payload.update({ collection: 'series', id: series.id, data: { heroImage: media.id }, overrideAccess: true })
  await addSpend(payload, series, cost)
  return { url: media.url, cost }
}
