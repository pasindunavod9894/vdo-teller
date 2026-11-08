import type { Payload } from 'payload'
import type { Character } from '@/payload-types'
import { createMedia } from '../media'
import { buildMockKit, type CharacterKit } from '../media/kit'
import { loadKit } from '../media/kit-store'
import { openWorkspace } from '../media/workspace'
import type { MediaCtx } from './media-ctx'

/** Render size by tier (Budget 720p, others 1080p) and aspect. Only the master is rendered here; other aspects come with exports. */
export function renderSize(tier: string, aspect: string): { width: number; height: number } {
  const long = tier === 'budget' ? 1280 : 1920
  const short = Math.round((long * 9) / 16)
  switch (aspect) {
    case '16:9': return { width: long, height: short }
    case '1:1': return { width: short, height: short }
    case '4:5': return { width: short, height: Math.round((short * 5) / 4) }
    default: return { width: short, height: long }
  }
}

/** Media is on by default; MEDIA_PIPELINE=off keeps the fast fixture-only run (no files, no render). */
export const mediaEnabled = () => process.env.MEDIA_PIPELINE !== 'off'

/**
 * Opens the episode's folders, chooses the media provider (free mock unless MEDIA_PROVIDER=openai) and loads every
 * character's kit. With the real provider a character whose images are not all made yet stops the episode with a clear
 * message, instead of silently drawing a placeholder.
 */
export async function buildMediaCtx(
  payload: Pick<Payload, 'findByID' | 'find'>,
  opts: { episodeId: string | number; seriesId: string | number; cast: Pick<Character, 'id' | 'name'>[]; tier: string; aspect: string },
): Promise<MediaCtx | null> {
  if (!mediaEnabled()) return null
  const ws = openWorkspace(opts.episodeId, opts.seriesId)
  const media = createMedia(ws)
  const kits: Record<string, CharacterKit> = {}
  const cast = opts.cast.length ? opts.cast : [{ id: 0, name: 'the hero' }]
  for (const c of cast) {
    if (media.provider === 'mock') { kits[c.name] = await buildMockKit(c.name, ws.assetsDir); continue }
    const kit = c.id ? await loadKit(payload, c.id, ws) : null
    if (!kit) throw new Error(`${c.name} has no finished asset pack yet. Generate all of its images first.`)
    kits[c.name] = kit
  }
  return { media, ws, kits, fps: 30, ...renderSize(opts.tier, opts.aspect), state: { plates: {}, stills: {} } }
}
