// Free end-to-end run of the whole pipeline: every provider is forced to its mock, so nothing is spent.
// Real FFmpeg assembly on placeholder art, placeholder voices and placeholder video clips.
// Run: pnpm tsx --env-file=.env scripts/e2e-free.ts [seriesId]
import { registerHooks } from 'node:module'
// `server-only` is a Next.js build-time guard, not an installed package: outside Next it is an empty module.
registerHooks({ resolve: (spec, ctx, next) => (spec === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : next(spec, ctx)) })
process.env.MEDIA_PROVIDER = 'mock'
process.env.VIDEO_PROVIDER = 'mock'
process.env.PIPELINE_MODE = 'mock'
delete process.env.MEDIA_PIPELINE

async function main() {
  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const { executeEpisode } = await import('../src/pipeline/payload-store')
  const { execFileSync } = await import('node:child_process')
  const path = await import('node:path')
  const { openWorkspace } = await import('../src/media/workspace')

  const payload = await getPayload({ config })
  const wanted = process.argv[2]
  let series = wanted
    ? await payload.findByID({ collection: 'series', id: wanted, depth: 0, overrideAccess: true })
    : (await payload.find({ collection: 'series', sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })).docs[0]
  if (!series) {
    // Empty database: seed a throwaway test account with one series and two characters (test data only, not a real login).
    const { randomBytes } = await import('node:crypto')
    const user = await payload.create({ collection: 'users', overrideAccess: true, data: { username: `e2e-${Date.now()}`, password: randomBytes(12).toString('hex') } as never })
    series = await payload.create({
      collection: 'series', overrideAccess: true,
      data: { owner: user.id, title: 'E2E cats', niche: 'Cat videos', style: 'pixar-3d', format: '30', voiceMode: 'character_voices', aspect: '9:16', status: 'active', videoModel: 'kling-2.5-turbo', costCapUsd: 30 } as never,
    })
    for (const [name, voice, look] of [['Mango', 'coral', 'a confident orange tabby cat'], ['Luna', 'onyx', 'a nervous grey cat with green eyes']]) {
      await payload.create({ collection: 'characters', overrideAccess: true, data: { owner: user.id, series: series.id, name, canonicalDescription: look, voiceProfile: { voice } } as never })
    }
    console.log('seeded a test series', series.id)
  }
  const owner = typeof series.owner === 'object' ? (series.owner as { id: number }).id : series.owner
  console.log(`series ${series.id} "${series.niche}" voice=${series.voiceMode}`)

  const episode = await payload.create({ collection: 'episodes', overrideAccess: true, data: { owner: owner as number, series: series.id, status: 'running', mode: 'mock', title: 'E2E free run' } })
  const t0 = Date.now()
  const out = await executeEpisode(payload, episode.id, 0)
  console.log('outcome', out, `${((Date.now() - t0) / 1000).toFixed(0)}s`)

  const { docs: steps } = await payload.find({ collection: 'pipeline-steps', where: { episode: { equals: episode.id } }, sort: 'order', limit: 50, depth: 0, overrideAccess: true })
  for (const s of steps) console.log(`${s.status.padEnd(7)} ${s.stepKey.padEnd(18)} $${(s.costUsd ?? 0).toFixed(3)} img=${s.imageCount ?? 0} ${s.summary ?? ''}`)
  const done = await payload.findByID({ collection: 'episodes', id: episode.id, depth: 0, overrideAccess: true })
  console.log('episode', done.status, done.error ?? '', 'files', JSON.stringify(done.files), 'cost', done.costUsd)
  const master = (done.files as { master?: string } | null)?.master
  if (master) {
    const file = path.join(openWorkspace(episode.id, series.id).episodeDir, master)
    console.log(file)
    console.log(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,duration', '-of', 'compact', file]).toString())
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
