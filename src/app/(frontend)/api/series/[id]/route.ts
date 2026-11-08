import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { isSeriesAction, seriesPatch } from '@/lib/series-state'

// Owner-only state changes for a series: folder linked/unlinked, removed (soft) and restored.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!isSeriesAction(body?.action)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const series = await payload.findByID({ collection: 'series', id, depth: 0, overrideAccess: true }).catch(() => null)
  const ownerId = typeof series?.owner === 'object' && series.owner ? (series.owner as { id: number }).id : series?.owner
  if (!series || ownerId !== user.id) return NextResponse.json({ error: 'Series not found' }, { status: 404 })
  // a removed series can only be restored, never changed in other ways
  if (series.status === 'removed' && body.action !== 'restore') return NextResponse.json({ error: 'Series not found' }, { status: 404 })

  const updated = await payload.update({ collection: 'series', id, data: seriesPatch(body.action), overrideAccess: true })
  return NextResponse.json({ id: updated.id, folderLinked: Boolean(updated.folderLinked), status: updated.status })
}
