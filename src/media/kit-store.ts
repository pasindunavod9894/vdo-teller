import fs from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'
import { assetPlan, EXPRESSIONS, specKey } from '../lib/art/plan'
import { copyKit, type CharacterKit } from './kit'
import { hashOf, safeName } from './workspace'

/**
 * Loads a character's kit for an episode: the reference sheet and expression close-ups are copied from the media folder
 * into the series library once (cached by which images they are), then into the episode's assets folder. Returns null while
 * the character's images are not all made yet.
 */
export async function loadKit(
  payload: Pick<Payload, 'findByID' | 'find'>,
  characterId: string | number,
  dirs: { assetsDir: string; libraryDir: string; mediaDir?: string },
): Promise<CharacterKit | null> {
  const mediaDir = dirs.mediaDir ?? path.resolve(process.cwd(), 'media')
  const character = await payload.findByID({ collection: 'characters', id: characterId, depth: 0, overrideAccess: true })
  const sheetRef = character.referenceImages?.[0]
  const sheetId = typeof sheetRef === 'object' && sheetRef ? (sheetRef as { id: number }).id : (sheetRef as number | undefined)
  if (sheetId === undefined) return null
  const pack = (await payload.find({ collection: 'asset-packs', where: { character: { equals: character.id } }, depth: 0, limit: 1, overrideAccess: true })).docs[0]
  const items = new Map((pack?.items ?? []).map((i) => [`${i.kind}:${i.name}`, typeof i.image === 'object' && i.image ? (i.image as { id: number }).id : (i.image as number)]))
  // the base four are what every pack has; a series with extra expressions has those too, and they are used when they are there
  if (!assetPlan(EXPRESSIONS).every((s) => items.has(specKey(s)))) return null
  const faces = [...items.keys()].filter((k) => k.startsWith('expression:')).map((k) => k.slice('expression:'.length)).sort((a, b) => (EXPRESSIONS as readonly string[]).indexOf(b) - (EXPRESSIONS as readonly string[]).indexOf(a))

  const n = safeName(character.name)
  const kitDir = path.join(dirs.libraryDir, `kit-${n}-${hashOf(String(sheetId), ...[...items.keys()].sort().map((k) => `${k}=${items.get(k)}`))}`)
  const manifest = path.join(kitDir, 'kit.json')
  if (fs.existsSync(manifest)) return copyKit(JSON.parse(fs.readFileSync(manifest, 'utf8')) as CharacterKit, kitDir, dirs.assetsDir)

  const fileOf = async (id: number) => {
    const media = await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true })
    if (!media.filename) throw new Error(`Image file missing for ${character.name}`)
    return path.join(mediaDir, media.filename)
  }
  fs.mkdirSync(kitDir, { recursive: true })
  const sheet = `${n}-sheet.png`
  fs.copyFileSync(await fileOf(sheetId), path.join(kitDir, sheet))
  const expressions: Record<string, string> = {}
  for (const name of [...EXPRESSIONS, ...faces.filter((f) => !(EXPRESSIONS as readonly string[]).includes(f))]) {
    const f = `${n}-expr-${name}.png`
    fs.copyFileSync(await fileOf(items.get(`expression:${name}`)!), path.join(kitDir, f))
    expressions[name] = f
  }
  const kit: CharacterKit = { name: character.name, sheet, expressions }
  fs.writeFileSync(manifest, JSON.stringify(kit))
  return copyKit(kit, kitDir, dirs.assetsDir)
}
