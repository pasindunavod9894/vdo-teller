/* LIVE evaluation of the story agents: runs the real Creator and Story Builder (real models, real web search) for 10 niches x 3 reel lengths,
 * applies the same rules and rubric the pipeline uses, and prints one table with the cost. Run it before any prompt change ships.
 * COSTS MONEY: about USD 0.10-0.20 per run, so about USD 3-6 for all 30. It refuses to run unless you pass --yes.
 *
 *   pnpm tsx --env-file=.env scripts/story-eval.ts                          # dry run: lists the runs and the expected cost, spends nothing
 *   pnpm tsx --env-file=.env scripts/story-eval.ts --yes                    # all 30 runs
 *   pnpm tsx --env-file=.env scripts/story-eval.ts --yes --niche cats       # only niches whose name contains "cats"
 *   pnpm tsx --env-file=.env scripts/story-eval.ts --yes --limit 3
 * Results are also saved as JSON in render/story-eval/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
// `server-only` is a Next.js build-time guard, not an installed package: outside Next it is an empty module.
registerHooks({ resolve: (spec, ctx, next) => (spec === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : next(spec, ctx)) })

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }

type Row = { niche: string; seconds: number; ok: boolean; approved: boolean; rounds: number; score: number; beats: number; words: number; violations: string[]; costUsd: number; tokens: number; title: string; vibe: string; faces: number; ideaVibes: string[]; error?: string }

const NICHES: { niche: string; sub?: string; style: string; cast: { name: string; look: string }[] }[] = [
  { niche: 'Cat videos', sub: 'cat family drama', style: 'pixar-3d', cast: [{ name: 'Mango', look: 'a confident orange tabby cat' }, { name: 'Luna', look: 'a nervous grey cat with green eyes' }] },
  { niche: 'Personal finance', sub: 'money myths', style: 'explainer', cast: [{ name: 'Penny', look: 'a wise owl with a tiny calculator' }] },
  { niche: 'Kids bedtime stories', style: 'storybook', cast: [{ name: 'Bun', look: 'a small curious rabbit' }, { name: 'Owl', look: 'a gentle old owl' }] },
  { niche: 'Horror stories', sub: 'urban legends', style: 'realistic', cast: [{ name: 'Ash', look: 'a quiet teenager in a hoodie' }] },
  { niche: 'Ancient history', style: 'documentary', cast: [{ name: 'Sage', look: 'a calm storyteller in a linen robe' }] },
  { niche: 'Motivation', style: 'kinetic', cast: [{ name: 'Coach', look: 'a bold mascot with a whistle' }] },
  { niche: 'Cooking', sub: 'quick dinners', style: 'claymation', cast: [{ name: 'Chef Pip', look: 'a tiny clay chef' }, { name: 'Sous', look: 'a grumpy clay sous-chef' }] },
  { niche: 'Football', sub: 'funny moments', style: 'comic', cast: [{ name: 'Striker', look: 'an overconfident striker' }, { name: 'Keeper', look: 'a worried goalkeeper' }] },
  { niche: 'Space facts', style: 'anime', cast: [{ name: 'Nova', look: 'a cheerful young astronaut' }] },
  { niche: 'Dog training', sub: 'puppy tips', style: 'disney-classic', cast: [{ name: 'Rex', look: 'a proud german shepherd' }, { name: 'Pip', look: 'a clumsy puppy' }] },
]

async function main() {
  const { REEL_TARGET_SEC } = await import('../src/lib/format')
  const filter = arg('niche')?.toLowerCase()
  const limit = Number(arg('limit') ?? Infinity)
  const runs = NICHES.filter((n) => !filter || n.niche.toLowerCase().includes(filter)).map((n) => ({ n, s: REEL_TARGET_SEC })).slice(0, limit)
  console.log(`${runs.length} run(s) of the Creator + Story Builder, about USD ${(runs.length * 0.1).toFixed(2)}-${(runs.length * 0.2).toFixed(2)} in total.`)
  if (!process.env.OPENAI_API_KEY) { console.log('OPENAI_API_KEY is missing in .env, so nothing can run. Add it, then run again.'); process.exit(1) }
  if (!process.argv.includes('--yes')) { for (const r of runs) console.log(`  ${r.n.niche} / ${r.s} s`); console.log('Dry run: nothing was spent. Add --yes to run for real.'); return }

  const { creator } = await import('../src/pipeline/agents')
  const { storyBuilder } = await import('../src/pipeline/story-builder')
  const { castViolations } = await import('../src/pipeline/cast')
  const { lengthViolations, spokenWords } = await import('../src/pipeline/length')
  const { storyViolations } = await import('../src/pipeline/story-rules')
  const { styleSummary } = await import('../src/lib/styles/bible')
  const { emptyMemory } = await import('../src/pipeline/memory')
  const { defaultVoiceFor } = await import('../src/lib/voices')

  const rows: Row[] = []
  for (const { n, s } of runs) {
    const profile = {
      niche: n.niche, subNiche: n.sub, style: { id: n.style, promptTemplate: styleSummary(null, n.style) }, durationTargetSec: s, aspect: '9:16' as const, voiceMode: 'character_voices' as const,
      narrator: { voice: 'fable' }, cast: n.cast.map((c, i) => ({ name: c.name, canonical: c.look, voiceProfile: { voice: defaultVoiceFor(i) } })),
    }
    const ctx = { profile, seriesId: `eval-${n.niche}`, mode: 'text' as const, delayMs: 0, memory: emptyMemory(), video: { model: 'kling-2.5-turbo' as const, allowanceSec: 0, provider: 'mock' as const } }
    process.stdout.write(`${n.niche} / ${s} s ... `)
    try {
      const ideas = await creator(ctx)
      const story = await storyBuilder(ctx, ideas.output)
      const script = story.output.script
      const violations = [...castViolations(n.cast.map((c) => c.name), script), ...lengthViolations(script), ...storyViolations(script)]
      const usage = [ideas.usage, story.usage]
      const row: Row = {
        niche: n.niche, seconds: s, ok: true, approved: story.output.critique.approved, rounds: story.output.rounds, score: story.output.critique.score, beats: script.beats.length, words: spokenWords(script),
        violations, costUsd: usage.reduce((t, u) => t + (u?.costUsd ?? 0), 0), tokens: usage.reduce((t, u) => t + (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0), 0), title: script.title,
        // the vibe the Story Builder picked, how many different faces the story shows, and the three vibes the Creator offered
        vibe: story.output.idea.vibe, faces: new Set(script.beats.map((b) => b.expression)).size, ideaVibes: ideas.output.map((i) => i.vibe),
      }
      rows.push(row)
      console.log(`${row.approved ? 'approved' : 'NOT approved'} ${row.score}/10, ${row.rounds} round(s), USD ${row.costUsd.toFixed(3)}`)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      rows.push({ niche: n.niche, seconds: s, ok: false, approved: false, rounds: 0, score: 0, beats: 0, words: 0, violations: [], costUsd: 0, tokens: 0, title: '', vibe: '', faces: 0, ideaVibes: [], error })
      console.log(`FAILED: ${error.slice(0, 100)}`)
    }
  }

  console.log('\nniche'.padEnd(26) + 'sec  ok  approved  rounds  score  beats  words  rules  vibe          faces  USD')
  for (const r of rows) console.log(`${r.niche.padEnd(25)} ${String(r.seconds).padEnd(4)} ${r.ok ? 'yes' : 'NO '} ${r.approved ? 'yes' : 'no '}      ${String(r.rounds).padEnd(7)} ${String(r.score).padEnd(6)} ${String(r.beats).padEnd(6)} ${String(r.words).padEnd(6)} ${r.violations.length ? 'BAD' : 'ok '}    ${r.vibe.padEnd(13)} ${String(r.faces).padEnd(6)} ${r.costUsd.toFixed(3)}`)
  const good = rows.filter((r) => r.ok)
  const total = rows.reduce((t, r) => t + r.costUsd, 0)
  console.log(`\n${good.length}/${rows.length} ran, ${good.filter((r) => r.approved).length} approved, ${good.filter((r) => r.violations.length).length} broke a rule, average ${(total / Math.max(1, good.length)).toFixed(3)} USD per run, ${total.toFixed(2)} USD in total.`)
  for (const r of rows.filter((x) => x.violations.length)) console.log(`  ${r.niche} / ${r.seconds}s: ${r.violations.join(' ')}`)
  const out = path.resolve('render/story-eval')
  fs.mkdirSync(out, { recursive: true })
  const file = path.join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify(rows, null, 2))
  console.log(`saved ${file}`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
