import type { Payload } from 'payload'
import type { Character } from '@/payload-types'
import { sizeFor } from '../engine/aspect'
import { createMedia } from '../media'
import { buildMockKit, type CharacterKit } from '../media/kit'
import { loadKit } from '../media/kit-store'
import { openWorkspace } from '../media/workspace'
import type { MediaCtx } from './media-ctx'

/** Media is on by default; MEDIA_PIPELINE=off keeps the fast fixture-only run (no files, no assembly). */
export const mediaEnabled = () => process.env.MEDIA_PIPELINE !== 'off'

/**
 * Opens the episode's folders, chooses the media provider (free mock unless MEDIA_PROVIDER=openai) and loads every main
 * character's kit. With the real provider a character whose reference images are not all made yet stops the episode with a clear
 * message, instead of silently drawing a placeholder. The master is always vertical 9:16 at VIDEO_RESOLUTION; other aspects are exports.
 */
export async function buildMediaCtx(
  payload: Pick<Payload, 'findByID' | 'find'>,
  opts: { episodeId: string | number; seriesId: string | number; cast: Pick<Character, 'id' | 'name'>[] },
): Promise<MediaCtx | null> {
  if (!mediaEnabled()) return null
  const size = sizeFor('9:16')
  const ws = openWorkspace(opts.episodeId, opts.seriesId)
  const media = createMedia({ ...ws, ...size })
  const kits: Record<string, CharacterKit> = {}
  const cast = opts.cast.length ? opts.cast : [{ id: 0, name: 'the hero' }]
  for (const c of cast) {
    if (media.provider === 'mock') { kits[c.name] = await buildMockKit(c.name, ws.assetsDir); continue }
    const kit = c.id ? await loadKit(payload, c.id, ws) : null
    if (!kit) throw new Error(`${c.name} has no finished reference pack yet. Generate all of its images first.`)
    kits[c.name] = kit
  }
  return { media, ws, kits, fps: 30, ...size, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {} } }
}
