import fs from 'node:fs'
import { Readable } from 'node:stream'
import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { openWorkspace } from '@/media/workspace'
import { parseRange, resolveMaster } from '@/media/playback'

// Plays an episode's finished video. Only its owner can watch it, and the browser can seek (Range requests).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })

  const episode = await payload.findByID({ collection: 'episodes', id, depth: 0, overrideAccess: true }).catch(() => null)
  const ownerId = typeof episode?.owner === 'object' && episode.owner ? (episode.owner as { id: number }).id : episode?.owner
  if (!episode || ownerId !== user.id) return NextResponse.json({ error: 'Episode not found' }, { status: 404 })

  const seriesId = typeof episode.series === 'object' && episode.series ? (episode.series as { id: number }).id : episode.series
  const master = (episode.files as { master?: string } | null)?.master
  const file = resolveMaster(openWorkspace(episode.id, seriesId as number).episodeDir, master)
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: 'This episode has no video yet' }, { status: 404 })

  const size = fs.statSync(file).size
  const range = parseRange(req.headers.get('range'), size)
  const base = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=0, must-revalidate' }
  if (range === 'invalid') return new NextResponse(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } })
  const { start, end } = range ?? { start: 0, end: size - 1 }
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream
  return new NextResponse(body, {
    status: range ? 206 : 200,
    headers: { ...base, 'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) },
  })
}
