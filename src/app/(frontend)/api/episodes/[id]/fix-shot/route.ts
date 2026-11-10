import { headers as nextHeaders } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { z } from 'zod'
import { executeFix, PipelineError, startFix } from '@/pipeline/payload-store'

// `confirm` must be true: remaking a clip costs money, so the dashboard shows the price first and only sends it after the user agrees.
const Body = z.object({ shot: z.number().int().min(1).max(30), confirm: z.literal(true) })

// "Fix shot": remakes ONE clip of a finished video that the check flagged. The work continues after the response; the episode shows it as being fixed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Confirm the cost to remake this shot.' }, { status: 400 })
  try {
    const { estimateUsd } = await startFix(payload, user, id, parsed.data.shot)
    after(async () => { await executeFix(await getPayload({ config }), id, parsed.data.shot) })
    return NextResponse.json({ accepted: true, shot: parsed.data.shot, estimateUsd }, { status: 202 })
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[episodes/fix-shot]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
