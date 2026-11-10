// Builds ONE reel end to end in a chosen style with the free mock providers (placeholder art, tone voices, FFmpeg stand-in clips):
// nothing is spent and no database is needed. Real FFmpeg assembly, so the style's grade, captions and transitions are visible.
// Run: pnpm tsx scripts/style-reel.ts [styleId ...]      e.g.  pnpm tsx scripts/style-reel.ts documentary comic
// The files land in render/style-reels/<style>/ (master.mp4 plus a contact sheet).
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
// `server-only` is a Next.js build-time guard, not an installed package: outside Next it is an empty module.
registerHooks({ resolve: (spec, ctx, next) => (spec === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : next(spec, ctx)) })
process.env.MEDIA_PROVIDER = 'mock'
process.env.VIDEO_PROVIDER = 'mock'
process.env.PIPELINE_MODE = 'mock'

async function main() {
  const { STYLE_IDS } = await import('../src/lib/styles/catalogue')
  const { imageStyle, lookFor, motionStyle, negativeList, transitionsFor, styleSummary } = await import('../src/lib/styles/bible')
  const { createMockMedia } = await import('../src/media/mock')
  const { buildMockKit } = await import('../src/media/kit')
  const { openWorkspace } = await import('../src/media/workspace')
  const { runEpisode } = await import('../src/pipeline/orchestrator')
  const { probe } = await import('../src/engine/ffmpeg')
  const { makeContactSheet } = await import('../src/pipeline/continuity')
  const { sizeFor } = await import('../src/engine/aspect')

  const { REEL, REEL_TARGET_SEC } = await import('../src/lib/format')
  const seconds = REEL_TARGET_SEC
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const styles = wanted.length ? wanted : ['pixar-3d', 'documentary']
  for (const id of styles) if (!(STYLE_IDS as string[]).includes(id)) throw new Error(`Unknown style "${id}". Known: ${STYLE_IDS.join(', ')}`)
  const size = sizeFor('9:16')

  for (const style of styles) {
    const root = path.resolve('render/style-reels', style)
    fs.rmSync(root, { recursive: true, force: true })
    const ws = openWorkspace(1, style, { episodes: path.join(root, 'episodes'), series: path.join(root, 'series') })
    const media = createMockMedia({ ...ws, ...size })
    const kits = { Mango: await buildMockKit('Mango', ws.assetsDir), Luna: await buildMockKit('Luna', ws.assetsDir) }
    const profile = {
      niche: 'Cat videos', durationTargetSec: seconds, aspect: '9:16' as const, voiceMode: 'character_voices' as const, narrator: { voice: 'fable' },
      style: { id: style, promptTemplate: styleSummary(null, style), imagePrompt: imageStyle(null, style), motion: motionStyle(null, style), negative: negativeList(null, style), look: lookFor(null, style), transitions: transitionsFor(null, style) },
      cast: [{ name: 'Mango', canonical: 'an orange tabby cat', voiceProfile: { voice: 'coral' } }, { name: 'Luna', canonical: 'a grey cat', voiceProfile: { voice: 'onyx' } }],
    }
    const state: { master?: string } = {}
    const mediaCtx = { media, ws, kits, fps: 30, ...size, state: { plates: {}, keyframes: {}, supporting: {}, shotCast: {} } as { master?: string } & Record<string, unknown> }
    const store = {
      stepStart: async () => {}, stepDone: async () => {}, stepFail: async (_k: string, m: string) => { console.error('step failed:', m) },
      episodePatch: async () => {}, budgetOk: async () => true, addSpend: async () => {},
    }
    const t0 = Date.now()
    const out = await runEpisode({ profile, seriesId: style, mode: 'mock', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec: 500, provider: 'mock' }, media: mediaCtx as never }, store as never, [])
    const master = (mediaCtx.state as { master?: string }).master ?? state.master
    console.log(`${style}: ${out.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s (a ${REEL.label} reel: ${REEL.shots} shots)`)
    if (!master) { console.log('  no master was made:', out.reason); continue }
    const file = path.join(ws.episodeDir, master)
    const p = await probe(file)
    const sheet = await makeContactSheet(file, path.join(root, 'contact-sheet.jpg'), p.durationSec, 6, 360)
    console.log(`  ${file}\n  ${p.width}x${p.height}, ${p.durationSec.toFixed(1)}s of ${seconds}s, ${p.fps.toFixed(0)} fps, audio ${p.hasAudio}\n  grade: ${lookFor(null, style).gradeFilter}\n  transitions: ${transitionsFor(null, style).join(', ')}\n  contact sheet: ${sheet}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
