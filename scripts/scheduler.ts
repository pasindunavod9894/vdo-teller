// Local scheduler: checks every minute which series are due and generates their next episode.
// Leave it running next to `pnpm dev`. When deployed, a cron service calls /api/cron/tick instead.
// Run: pnpm tsx --env-file=.env scripts/scheduler.ts [--once]
import { registerHooks } from 'node:module'
// `server-only` is a Next.js build-time guard, not an installed package: outside Next it is an empty module.
registerHooks({ resolve: (spec, ctx, next) => (spec === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : next(spec, ctx)) })

async function main() {
  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const { tick } = await import('../src/pipeline/scheduler-payload')
  const payload = await getPayload({ config })
  const once = process.argv.includes('--once')
  const every = Math.max(10, Number(process.env.SCHEDULER_INTERVAL_SEC) || 60) * 1000
  console.log(`[scheduler] ${once ? 'single pass' : `checking every ${every / 1000}s`}; media=${process.env.MEDIA_PROVIDER || 'mock'} video=${process.env.VIDEO_PROVIDER || 'mock'} pipeline=${process.env.PIPELINE_MODE || 'mock'}`)
  do {
    const report = await tick(payload).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))
    console.log(new Date().toISOString(), JSON.stringify(report))
    if (once) break
    await new Promise((r) => setTimeout(r, every))
  } while (true)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
