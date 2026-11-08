import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'
import type { Payload } from 'payload'
import type { Character, Series, User } from '@/payload-types'
import { MODELS } from '@/agents/models'
import { stylePrompt } from '@/lib/styles/prompts'
import { heuristicTheme, isTheme, type Theme } from '@/themes/palettes'
import { pickTheme } from '@/lib/theme/pick'
import { assetPlan, FACE_BASE_NEEDS, IMAGE_COST, QUALITY_FOR_TIER, specKey, type Quality } from './plan'
import { normalizedBusts } from '@/media/kit'

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

/** Character art is generated once and reused in every episode, so it is never below medium (low quality drifts from the reference). */
function qualityOf(series: Series): Quality {
  const q = QUALITY_FOR_TIER[(series.qualityTier as keyof typeof QUALITY_FOR_TIER) ?? 'standard']
  return q === 'low' ? 'medium' : q
}

/** Refuse to spend past the series cost cap. */
function assertBudget(series: Series, cost: number) {
  const spent = series.spentUsd ?? 0
  const cap = series.costCapUsd ?? 5
  if (spent + cost > cap) throw new ArtError(`Cost cap reached ($${spent.toFixed(2)} of $${cap.toFixed(2)} spent).`, 402)
}

async function addSpend(payload: Payload, series: Series, cost: number) {
  await payload.update({ collection: 'series', id: series.id, data: { spentUsd: (series.spentUsd ?? 0) + cost }, overrideAccess: true })
}

export async function loadOwned(payload: Payload, user: User, characterId: string | number) {
  const character = await payload.findByID({ collection: 'characters', id: characterId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!character || (typeof character.owner === 'object' ? character.owner.id : character.owner) !== user.id) throw new ArtError('Character not found', 404)
  const seriesId = typeof character.series === 'object' ? character.series.id : character.series
  const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
  return { character, series }
}

async function saveImage(payload: Payload, b64: string, name: string, alt: string) {
  const data = Buffer.from(b64, 'base64')
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
    input: `Name: ${character.name}\nRole: ${character.role ?? ''}\nLook: ${b.look ?? ''}\nPersonality: ${b.personality ?? ''}\nStyle: ${stylePrompt(series.style)}`,
    max_output_tokens: 300,
  })
  return res.output_text.trim()
}

export async function createReference(payload: Payload, user: User, characterId: string | number) {
  const { character, series } = await loadOwned(payload, user, characterId)
  const quality = qualityOf(series)
  const cost = IMAGE_COST[quality]
  assertBudget(series, cost)

  const canonical = character.canonicalDescription || (await writeCanonical(series, character))
  const prompt = `Character reference sheet of ONE character, on a plain light-grey background: front view, side view and a three-quarter view, same character in each, full body, evenly spaced. ${canonical} Art style: ${stylePrompt(series.style)}. No text, no labels, no other characters.`
  const img = await withRetry(() => client().images.generate({ model: 'gpt-image-2', prompt, size: '1536x1024', quality, n: 1 }))
  const b64 = img.data?.[0]?.b64_json
  if (!b64) throw new ArtError('Image generation returned nothing', 502)
  const media = await saveImage(payload, b64, `ref-${character.name.toLowerCase().replace(/\W+/g, '-')}`, `${character.name} reference sheet`)
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

/** Local path of a stored image. */
async function mediaPath(payload: Payload, id: string | number) {
  const media = await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true })
  if (!media.filename) throw new ArtError('Image file missing', 404)
  return path.resolve(process.cwd(), 'media', media.filename)
}

/**
 * The steady face the mouth and blink edits start from: the closed-mouth close-up, normalised together with the expression
 * close-ups so every close-up shares one head size and position. Deterministic: the kit assembly recomputes the same thing.
 */
async function faceBaseBuffer(payload: Payload, pack: { items?: { kind?: string | null; name?: string | null; image?: unknown }[] | null } | undefined) {
  const find = (kind: string, name: string) => {
    const item = (pack?.items ?? []).find((i) => i.kind === kind && i.name === name)
    const img = item?.image
    const id = typeof img === 'object' && img ? (img as { id: number }).id : (img as number | undefined)
    if (id === undefined) throw new ArtError(`Missing ${kind} ${name}`, 409)
    return id
  }
  const files = {
    closed: await mediaPath(payload, find('mouth', 'closed')), happy: await mediaPath(payload, find('emotion', 'happy')),
    surprised: await mediaPath(payload, find('emotion', 'surprised')), smug: await mediaPath(payload, find('emotion', 'smug')),
  }
  const busts = await normalizedBusts(files)
  return busts.find((b) => b.name === 'closed')!.data
}

export async function packStatus(payload: Payload, user: User, characterId: string | number) {
  const { character, series } = await loadOwned(payload, user, characterId)
  const plan = assetPlan()
  const pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 1, limit: 1, overrideAccess: true })).docs[0]
  const done = new Map((pack?.items ?? []).map((i) => [`${i.kind}:${i.name}`, typeof i.image === 'object' ? i.image.url : undefined]))
  const quality = qualityOf(series)
  return {
    hasReference: Boolean(character.referenceImages?.length),
    quality,
    costPerImage: IMAGE_COST[quality],
    spentUsd: series.spentUsd ?? 0,
    capUsd: series.costCapUsd ?? 5,
    items: plan.map((s) => ({ kind: s.kind, name: s.name, done: done.has(specKey(s)), url: done.get(specKey(s)) ?? null })),
  }
}

/** Generates ONE missing asset (the client loops), so a request never runs for minutes. */
export async function createNextAsset(payload: Payload, user: User, characterId: string | number, only?: { kind: string; name: string }) {
  const { character, series } = await loadOwned(payload, user, characterId)
  const refId = character.referenceImages?.[0]
  if (!refId) throw new ArtError('Create the reference sheet first', 409)
  const plan = assetPlan()
  let pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 0, limit: 1, overrideAccess: true })).docs[0]
  const have = new Set((pack?.items ?? []).map((i) => `${i.kind}:${i.name}`))
  // stage-1 items (from the reference sheet) first, then the stage-2 edits of the steady face
  const next = plan.find((s) => (only ? s.kind === only.kind && s.name === only.name : true) && !have.has(specKey(s)) && (s.source === 'reference' || FACE_BASE_NEEDS.every((k) => have.has(k))))
  if (!next) return { done: true as const }

  const quality = qualityOf(series)
  const cost = IMAGE_COST[quality]
  assertBudget(series, cost)
  const canonical = character.canonicalDescription ?? ''
  const source = next.source === 'face-base' ? await faceBaseBuffer(payload, pack) : await readMediaFile(payload, typeof refId === 'object' ? refId.id : refId)
  const prompt = next.source === 'face-base' ? `${next.prompt} Art style: ${stylePrompt(series.style)}.` : `${next.prompt} Character: ${canonical} Art style: ${stylePrompt(series.style)}.`
  const img = await withRetry(async () => client().images.edit({
    model: 'gpt-image-1.5',
    image: await toFile(source, 'source.png', { type: 'image/png' }),
    prompt,
    background: 'transparent', input_fidelity: 'high', output_format: 'png', size: '1024x1024', quality,
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
  const quality = qualityOf(series)
  const cost = IMAGE_COST[quality]
  assertBudget(series, cost)
  const theme = isTheme(series.theme) ? series.theme : heuristicTheme(`${series.niche} ${series.subNiche ?? ''}`, series.style)
  const scene = theme.heroPrompt || `A wide establishing scene for a ${series.niche} video series`
  const prompt = `Wide cinematic banner illustration. ${scene} Art style: ${stylePrompt(series.style)}. Colour mood: ${theme.mood}. Leave calm negative space on the left third. No text, no logos, no people, no brands.`
  const img = await withRetry(() => client().images.generate({ model: 'gpt-image-2', prompt, size: '1536x1024', quality, n: 1 }))
  const b64 = img.data?.[0]?.b64_json
  if (!b64) throw new ArtError('Image generation returned nothing', 502)
  const media = await saveImage(payload, b64, `hero-${series.id}`, `${series.title} banner`)
  await payload.update({ collection: 'series', id: series.id, data: { heroImage: media.id }, overrideAccess: true })
  await addSpend(payload, series, cost)
  return { url: media.url, cost }
}
