// Makes an episode that is already on disk in another aspect ratio (free: no API calls), straight from its finished master:
// the master is shown whole over a blurred copy of itself. The master is always 9:16.
// Run: pnpm tsx --env-file=.env scripts/export-episode.ts <episodeId> <9:16|16:9|1:1|4:5>
import path from 'node:path'
import { renderExport } from '../src/pipeline/exports'
import { isAspect } from '../src/engine/aspect'
import { episodesRoot } from '../src/media/workspace'

async function main() {
  const [id, aspect] = process.argv.slice(2)
  if (!id || !isAspect(aspect)) throw new Error('Usage: export-episode.ts <episodeId> <aspect>')
  const t0 = Date.now()
  const file = await renderExport({ episodeDir: path.join(episodesRoot(), id), aspect, master: path.join('out', 'master.mp4') })
  console.log(`${file} in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
