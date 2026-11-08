import { timingSafeEqual } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { findDue } from '@/pipeline/scheduler'
import { payloadSchedulerDeps, tick } from '@/pipeline/scheduler-payload'

// The scheduler entry point for a cron service (Vercel Cron, Trigger.dev, or any HTTP cron):
// `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the endpoint is off. `?dry=1` only lists what is due.
function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'The scheduler endpoint is off (CRON_SECRET is not set).' }, { status: 503 })
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await getPayload({ config })
  if (new URL(req.url).searchParams.get('dry') === '1') {
    const { due, skipped, checked } = await findDue(payloadSchedulerDeps(payload), new Date())
    return NextResponse.json({ checked, due: due.map((s) => s.id), skipped })
  }
  // Episodes take minutes to render: answer now, work after the response.
  after(async () => {
    const report = await tick(await getPayload({ config })).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))
    console.log('[scheduler] tick', JSON.stringify(report))
  })
  return NextResponse.json({ accepted: true }, { status: 202 })
}

export const GET = handle
export const POST = handle
