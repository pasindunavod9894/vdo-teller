import { headers as nextHeaders } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { executeEpisode, PipelineError, retryEpisode } from '@/pipeline/payload-store'

// A video that failed: run it again from the step where it stopped, on the same video. What it already made (the idea, the script,
// the keyframes) is reused, so only the missing work is paid for. It needs the same room as a new video (no other run, caps not reached).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  try {
    const r = await retryEpisode(payload, user, id)
    // Runs after the response is sent (like the first attempt).
    after(async () => { await executeEpisode(await getPayload({ config }), r.episodeId, 900, { retry: true }) })
    return NextResponse.json({ episodeId: r.episodeId, plan: r.plan })
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[episodes/retry]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
