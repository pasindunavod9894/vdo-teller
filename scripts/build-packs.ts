// Finishes the reference pack (sheet + 4 expressions) of every main character in one series, the same way the cast panel does.
// Paid (CHARACTER_IMAGE_PROVIDER: fal.ai FLUX.2 about $0.07 per character, or gpt-image-2 about $0.17 per image). Dry run by default: it only lists what is missing and the cost.
// Run: pnpm tsx --env-file=.env scripts/build-packs.ts --series <id> [--yes]
import { registerHooks } from 'node:module'
// `server-only` is a Next.js build-time guard, not an installed package: outside Next it is an empty module.
registerHooks({ resolve: (spec, ctx, next) => (spec === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : next(spec, ctx)) })

async function main() {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
  const seriesId = arg('--series')
  if (!seriesId) throw new Error('Pass --series <id>')
  const yes = process.argv.includes('--yes')
  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const { packStatus, createReference, createExpressions } = await import('../src/lib/art/service')
  const payload = await getPayload({ config })

  const series = await payload.findByID({ collection: 'series', id: seriesId, depth: 0, overrideAccess: true })
  const ownerId = typeof series.owner === 'object' ? series.owner.id : series.owner
  const user = await payload.findByID({ collection: 'users', id: ownerId, depth: 0, overrideAccess: true })
  const chars = (await payload.find({ collection: 'characters', where: { series: { equals: series.id } }, depth: 0, limit: 20, overrideAccess: true })).docs

  let total = 0
  for (const c of chars) {
    const st = await packStatus(payload, user, c.id)
    const missing = st.items.filter((i) => !i.done).map((i) => i.name)
    total += st.remainingUsd
    console.log(`${c.name}: sheet ${st.hasReference ? 'yes' : 'missing'}, expressions missing: ${missing.join(', ') || 'none'}, locked: ${st.locked}`)
    if (!yes) continue
    if (!st.hasReference) { await createReference(payload, user, c.id); console.log('  made reference sheet') }
    const r = await createExpressions(payload, user, c.id)
    console.log(`  made ${r.made} expressions, pack complete, character locked`)
  }
  console.log(yes ? `Done. About $${total.toFixed(2)} spent.` : `Would spend about $${total.toFixed(2)} (add --yes to make the images).`)
  process.exit(0)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
