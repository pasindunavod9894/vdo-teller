import { headers as nextHeaders } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { z } from 'zod'
import { executeEpisode, PipelineError, reviewEpisode } from '@/pipeline/payload-store'

const Body = z.object({ action: z.enum(['approve', 'new-idea']) })

// A video that is waiting for review ("Review before video"): approve it, and the clips are made now; or ask for a different idea,
// which drops this one and starts a new video. Neither uses an extra one of the day's videos.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    const r = await reviewEpisode(payload, user, id, parsed.data.action)
    // Runs after the response is sent (like the first part of the video).
    after(async () => { await executeEpisode(await getPayload({ config }), r.episodeId, 900, { approved: r.action === 'approve' }) })
    return NextResponse.json({ episodeId: r.episodeId, action: r.action })
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[episodes/approve]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
