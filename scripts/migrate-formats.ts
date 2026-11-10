// Every video is now a single length (a short story of 25 to 30 seconds), so a series no longer has a format of its own. This sets the stored
// value of every series made before that change (10, 15, story-reel, quick-reel, long-form) to '30'. Dry run by default: it only lists what it would change.
// Run: pnpm tsx --env-file=.env scripts/migrate-formats.ts [--yes]
import { registerHooks } from 'node:module'
// `server-only` is a Next.js build-time guard, not an installed package: outside Next it is an empty module.
registerHooks({ resolve: (spec, ctx, next) => (spec === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : next(spec, ctx)) })

async function main() {
  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const yes = process.argv.includes('--yes')
  const payload = await getPayload({ config })
  let changed = 0, checked = 0
  for (let page = 1; ; page++) {
    const r = await payload.find({ collection: 'series', limit: 100, page, depth: 0, overrideAccess: true })
    for (const s of r.docs) {
      checked++
      if (s.format === '30') continue
      console.log(`series ${s.id} "${s.title}": ${s.format} -> 30`)
      if (yes) await payload.update({ collection: 'series', id: s.id, data: { format: '30' }, overrideAccess: true })
      changed++
    }
    if (!r.hasNextPage) break
  }
  console.log(`${checked} series checked, ${changed} ${yes ? 'changed' : 'would change (add --yes to write)'}.`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
