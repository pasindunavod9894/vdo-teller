import { describe, expect, it } from 'vitest'
import { buildPrompt, renderProfile } from '@/agents/prompt-builder'
import type { AgentName, SeriesProfile, VoiceMode } from '@/agents/profile'
import { hasBrand } from '@/pipeline/brand-safety'
import { styleSummary } from '@/lib/styles/bible'
import { REEL } from '@/lib/format'

/**
 * The prompt eval set (plan §3b): 10 niches x 4 voice modes (every reel is a short story of 25 to 30 s). Before any prompt change ships this must stay green: it checks
 * that every agent's prompt is cache-friendly, short enough, brand-free and switched to the right voice mode, for every niche.
 */
const NICHES: { niche: string; sub?: string; style: string; cast: string[] }[] = [
  { niche: 'Cat videos', sub: 'cat family drama', style: 'pixar-3d', cast: ['Mango', 'Luna'] },
  { niche: 'Personal finance', sub: 'money myths', style: 'explainer', cast: ['Penny'] },
  { niche: 'Kids bedtime stories', style: 'storybook', cast: ['Bun', 'Owl'] },
  { niche: 'Horror stories', sub: 'urban legends', style: 'realistic', cast: [] },
  { niche: 'Ancient history', style: 'documentary', cast: [] },
  { niche: 'Motivation', style: 'kinetic', cast: ['Coach'] },
  { niche: 'Cooking', sub: 'quick dinners', style: 'claymation', cast: ['Chef Pip', 'Sous'] },
  { niche: 'Football', sub: 'funny moments', style: 'comic', cast: ['Striker', 'Keeper'] },
  { niche: 'Space facts', style: 'anime', cast: ['Nova'] },
  { niche: 'Dog training', sub: 'puppy tips', style: 'disney-classic', cast: ['Rex', 'Pip', 'Coco'] },
]
const MODES: VoiceMode[] = ['none', 'narrator', 'character_voices', 'narrator_and_characters']
const AGENTS: AgentName[] = ['creator', 'picker', 'writer', 'critic', 'styleNotes', 'artDirector', 'editor', 'reelQa', 'publisher']
const MODE_WORD: Record<VoiceMode, string> = { none: 'NO VOICE', narrator: 'NARRATOR ONLY', character_voices: 'CHARACTER VOICES', narrator_and_characters: 'NARRATOR + CHARACTERS' }
const WRITER_CRITIC_ART: AgentName[] = ['writer', 'critic', 'artDirector']

const tokens = (s: string) => Math.ceil(s.length / 4) // rough, but stable enough to catch a prompt that balloons
const profile = (n: (typeof NICHES)[number], mode: VoiceMode): SeriesProfile => ({
  niche: n.niche, subNiche: n.sub, style: { id: n.style, promptTemplate: styleSummary(null, n.style) }, durationTargetSec: REEL.targetSec, aspect: '9:16', voiceMode: mode,
  narrator: mode.includes('narrator') ? { voice: 'fable', instructions: 'warm storyteller' } : null,
  cast: n.cast.map((c) => ({ name: c, canonical: `${c}: a friendly character with a clear signature outfit and colours, always drawn the same way`, voiceProfile: mode.includes('character') ? { voice: 'coral', instructions: 'lively' } : null })),
})

const cases = NICHES.flatMap((n) => MODES.map((m) => [n.niche, m, profile(n, m)] as const))

describe('prompt eval set (10 niches x 4 voice modes)', () => {
  it('covers 40 series', () => expect(cases).toHaveLength(40))

  for (const [niche, mode, p] of cases) {
    it(`${niche} / ${mode}`, () => {
      const prompts = AGENTS.map((a) => ({ a, p: buildPrompt(a, p, { idea: 'EPISODE-ONLY-MARKER' }, 1) }))
      for (const { a, p: built } of prompts) {
        // short: no agent prompt may balloon (a 3-character cast stays well inside this)
        expect(tokens(built.system), `${a} system prompt size`).toBeLessThan(1400)
        // the rules may name the PLATFORMS (YouTube, Facebook) for policy; no studio, franchise or character brand may appear
        expect(hasBrand(built.system.replace(/YouTube/g, '')), `${a} brand name in prompt`).toBe(false)
        // episode data never leaks into the cacheable part
        expect(built.system).not.toContain('EPISODE-ONLY-MARKER')
        expect(built.user).toContain('EPISODE-ONLY-MARKER')
        expect(built.user.startsWith('<episode>')).toBe(true)
      }
      // voice mode reaches the agents that need it
      for (const a of WRITER_CRITIC_ART) expect(prompts.find((x) => x.a === a)!.p.system, `${a} voice rule`).toContain(MODE_WORD[mode])
      // cache-friendly: every agent of this series shares the rules + series profile as one identical prefix
      const prefix = `${prompts[0].p.system.split('\n\nYou are the')[0]}`
      expect(prefix).toContain('Series profile:')
      for (const { a, p: built } of prompts) expect(built.system.startsWith(prefix), `${a} shares the prefix`).toBe(true)
      // the cast appears exactly as written
      for (const c of p.cast) expect(prompts[1].p.system).toContain(c.canonical)
      // the reel reaches every agent: its length window, its shot count and the shape of the story
      for (const { a, p: built } of prompts) {
        expect(built.system, `${a} reel length`).toContain(`${REEL.minSec} to ${REEL.maxSec}-second reel, ${REEL.beats[0]} to ${REEL.beats[1]} shots`)
        expect(built.system, `${a} story shape`).toContain(REEL.structure)
      }
      // the vibes (every reel is a short story with one) and the expressions reach every agent through the same cached profile
      for (const { a, p: built } of prompts) {
        expect(built.system, `${a} vibes`).toContain('Vibes (every reel has exactly ONE')
        expect(built.system, `${a} expressions`).toContain('Expressions the main characters can show')
      }
      // revision is by changed lines only
      expect(prompts.find((x) => x.a === 'writer')!.p.system).toContain('revise only the lines')
    })
  }

  it('the series profile block is identical for every episode of a series', () => {
    const p = profile(NICHES[0], 'character_voices')
    expect(renderProfile(p)).toBe(renderProfile({ ...p }))
    expect(buildPrompt('writer', p, { idea: 'a' }, 1).system).toBe(buildPrompt('writer', p, { idea: 'b' }, 1).system)
  })

  it('a different series gets a different cache key, the same series always the same one', () => {
    const p = profile(NICHES[0], 'none')
    expect(buildPrompt('writer', p, 'x', 1).cacheKey).toBe(buildPrompt('critic', p, 'y', 1).cacheKey)
    expect(buildPrompt('writer', p, 'x', 1).cacheKey).not.toBe(buildPrompt('writer', p, 'x', 2).cacheKey)
  })
})
