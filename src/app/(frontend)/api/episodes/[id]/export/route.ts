import { headers as nextHeaders } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { executeExport, getExports, startExport } from '@/pipeline/export-store'
import { PipelineError } from '@/pipeline/payload-store'
import type { Aspect } from '@/engine/aspect'

async function authed() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  return { payload, user }
}

const fail = (e: unknown) => (e instanceof PipelineError ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: 'Something went wrong.' }, { status: 500 }))

// Which exports of this episode exist, and which are still rendering.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { payload, user } = await authed()
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  try { return NextResponse.json({ exports: await getExports(payload, user, id) }, { headers: { 'cache-control': 'no-store' } }) } catch (e) { return fail(e) }
}

// Starts rendering the episode in another aspect ratio; the render continues after the response.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { payload, user } = await authed()
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    const { aspect } = await startExport(payload, user, id, body?.aspect)
    after(async () => { await executeExport(await getPayload({ config }), user, id, aspect as Aspect) })
    return NextResponse.json({ accepted: true, aspect }, { status: 202 })
  } catch (e) { return fail(e) }
}
