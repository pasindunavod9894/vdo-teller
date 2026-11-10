import fs from 'node:fs'
import path from 'node:path'
import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { openWorkspace } from '@/media/workspace'
import { loadMediaState } from '@/pipeline/media-ctx'
import { resolveMaster } from '@/media/playback'

// A shot's keyframe image (the still its video clip starts from), for the review before video. Only the episode's owner can see it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const shot = Number(new URL(req.url).searchParams.get('shot'))
  if (!Number.isInteger(shot) || shot < 1 || shot > 30) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })

  const episode = await payload.findByID({ collection: 'episodes', id, depth: 0, overrideAccess: true }).catch(() => null)
  const ownerId = typeof episode?.owner === 'object' && episode.owner ? (episode.owner as { id: number }).id : episode?.owner
  if (!episode || ownerId !== user.id) return NextResponse.json({ error: 'Episode not found' }, { status: 404 })

  const seriesId = typeof episode.series === 'object' && episode.series ? (episode.series as { id: number }).id : episode.series
  const ws = openWorkspace(episode.id, seriesId as number)
  const name = loadMediaState(ws.episodeDir)?.keyframes[shot]
  // the file name comes from our own saved state, but is still resolved inside the episode's assets folder only
  const file = name ? resolveMaster(ws.assetsDir, path.basename(name)) : null
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: 'No keyframe for this shot' }, { status: 404 })
  return new NextResponse(fs.readFileSync(file), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=60' } })
}
