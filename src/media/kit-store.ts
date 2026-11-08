import fs from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'
import { assetPlan, specKey } from '../lib/art/plan'
import { buildKit, copyKit, type CharacterKit, type KitSources } from './kit'
import { hashOf, safeName } from './workspace'

/**
 * Loads a character's kit for an episode: assembled once from its stored images, cached in the series library, then copied
 * into the episode's assets folder. Returns null while the character's images are not all made yet.
 */
export async function loadKit(
  payload: Pick<Payload, 'findByID' | 'find'>,
  characterId: string | number,
  dirs: { assetsDir: string; libraryDir: string; mediaDir?: string },
): Promise<CharacterKit | null> {
  const mediaDir = dirs.mediaDir ?? path.resolve(process.cwd(), 'media')
  const character = await payload.findByID({ collection: 'characters', id: characterId, depth: 0, overrideAccess: true })
  const pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 0, limit: 1, overrideAccess: true })).docs[0]
  const items = new Map((pack?.items ?? []).map((i) => [`${i.kind}:${i.name}`, typeof i.image === 'object' && i.image ? (i.image as { id: number }).id : (i.image as number)]))
  if (!assetPlan().every((s) => items.has(specKey(s)))) return null

  const kitDir = path.join(dirs.libraryDir, `kit-${safeName(character.name)}-${hashOf(...assetPlan().map((s) => `${specKey(s)}=${items.get(specKey(s))}`))}`)
  const manifest = path.join(kitDir, 'kit.json')
  if (fs.existsSync(manifest)) return copyKit(JSON.parse(fs.readFileSync(manifest, 'utf8')) as CharacterKit, kitDir, dirs.assetsDir)

  const file = async (kind: string, name: string) => {
    const media = await payload.findByID({ collection: 'media', id: items.get(`${kind}:${name}`)!, depth: 0, overrideAccess: true })
    if (!media.filename) throw new Error(`Image file missing for ${kind} ${name}`)
    return path.join(mediaDir, media.filename)
  }
  const sources: KitSources = {
    stand: await file('pose', 'standing-front'), walkA: await file('pose', 'walking-side-a'), walkB: await file('pose', 'walking-side-b'),
    crouch: await file('pose', 'crouch'), air: await file('pose', 'airborne'),
    closed: await file('mouth', 'closed'), happy: await file('emotion', 'happy'), surprised: await file('emotion', 'surprised'), smug: await file('emotion', 'smug'),
    slightlyOpen: await file('mouth', 'slightly-open'), roundOh: await file('mouth', 'round-oh'), wideOpen: await file('mouth', 'wide-open'),
    blink: await file('face', 'blink'),
  }
  const kit = await buildKit(sources, kitDir, character.name)
  fs.writeFileSync(manifest, JSON.stringify(kit))
  return copyKit(kit, kitDir, dirs.assetsDir)
}
