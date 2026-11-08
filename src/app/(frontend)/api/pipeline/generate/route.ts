import { headers as nextHeaders } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { z } from 'zod'
import { executeEpisode, PipelineError, startEpisode } from '@/pipeline/payload-store'

const Body = z.object({ seriesId: z.union([z.string(), z.number()]) })

export async function POST(req: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    const { episodeId, mode } = await startEpisode(payload, user, parsed.data.seriesId)
    // Runs after the response is sent. In production this moves to a durable job runner (Trigger.dev).
    after(async () => { await executeEpisode(await getPayload({ config }), episodeId) })
    return NextResponse.json({ episodeId, mode })
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[pipeline/generate]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not start the episode.' }, { status: 500 })
  }
}
