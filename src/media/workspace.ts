import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Where an episode's files live. `assetsDir` is served to Remotion; `libraryDir` persists per series (plates, kits) so a
 * recurring location or character is made once and reused by every later episode.
 */
export type Workspace = { episodeDir: string; assetsDir: string; clipsDir: string; outDir: string; libraryDir: string }

export const episodesRoot = () => path.resolve(process.env.EPISODES_DIR || 'render/episodes')
export const seriesRoot = () => path.resolve(process.env.SERIES_LIBRARY_DIR || 'render/series')

export function openWorkspace(episodeId: string | number, seriesId: string | number, roots?: { episodes?: string; series?: string }): Workspace {
  const episodeDir = path.join(roots?.episodes ?? episodesRoot(), String(episodeId))
  const ws = {
    episodeDir,
    assetsDir: path.join(episodeDir, 'assets'),
    clipsDir: path.join(episodeDir, 'clips'),
    outDir: path.join(episodeDir, 'out'),
    libraryDir: path.join(roots?.series ?? seriesRoot(), String(seriesId), 'library'),
  }
  for (const d of [ws.assetsDir, ws.clipsDir, ws.outDir, ws.libraryDir]) fs.mkdirSync(d, { recursive: true })
  return ws
}

/** Copies a file into the assets folder (unless it is already there) and returns its name. */
export function putAsset(ws: Workspace, src: string, name = path.basename(src)): string {
  const dest = path.join(ws.assetsDir, name)
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest)
  return name
}

/** A short, filename-safe hash, used to cache speech by what was said and how. */
export const hashOf = (...parts: string[]) => crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12)

export const safeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item'
