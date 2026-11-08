import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getProgress, PipelineError } from '@/pipeline/payload-store'

export async function GET(req: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  const episodeId = new URL(req.url).searchParams.get('episodeId')
  if (!episodeId || !/^\d+$/.test(episodeId)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    return NextResponse.json(await getProgress(payload, user, episodeId), { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: 'Could not read progress.' }, { status: 500 })
  }
}
