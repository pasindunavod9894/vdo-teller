import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import * as agents from '@/pipeline/agents'
import type { Ctx } from '@/pipeline/agents'
import type { SeriesProfile } from '@/agents/profile'
import type { StepKey } from '@/pipeline/steps'

const profile = (voiceMode: SeriesProfile['voiceMode']): SeriesProfile => ({
  niche: 'Cat videos', style: { id: 'pixar-3d' }, durationTargetSec: 28, aspect: '9:16', voiceMode,
  cast: [
    { name: 'Mango', canonical: 'orange tabby', voiceProfile: { voice: 'coral' } },
    { name: 'Luna', canonical: 'grey cat', voiceProfile: { voice: 'onyx' } },
  ],
  narrator: { voice: 'fable' },
})
const ctx = (voiceMode: SeriesProfile['voiceMode'], allowanceSec = 10): Ctx => ({
  profile: profile(voiceMode), seriesId: 1, mode: 'mock', delayMs: 0, video: { model: 'kling-2.5-turbo', allowanceSec, provider: 'mock' },
})

/** `budgetOk: false` refuses everything; `maxExtraUsd` refuses only requests above that amount (e.g. real video). */
function memoryStore(opts: { budgetOk?: boolean; maxExtraUsd?: number } = {}) {
  const events: string[] = []
  const episode: Record<string, unknown> = {}
  const store: Store = {
    stepStart: async (k: StepKey) => { events.push(`start:${k}`) },
    stepDone: async (k: StepKey) => { events.push(`done:${k}`) },
    stepFail: async (k: StepKey, m: string) => { events.push(`fail:${k}:${m}`) },
    episodePatch: async (p) => { Object.assign(episode, p) },
    budgetOk: async (extra: number) => (opts.maxExtraUsd !== undefined ? extra <= opts.maxExtraUsd : (opts.budgetOk ?? true)),
    addSpend: async () => {},
  }
  return { store, events, episode }
}

// a failing assertion must never leave a spy behind to break the tests after it
afterEach(() => { vi.restoreAllMocks() })

describe('orchestrator (mock mode)', () => {
  it('runs every step in the fixed order and finishes the episode', async () => {
    const { store, events, episode } = memoryStore()
    const out = await runEpisode(ctx('character_voices'), store, [])
    expect(out.status).toBe('done')
    const started = events.filter((e) => e.startsWith('start:')).map((e) => e.slice(6))
    expect(started).toEqual(['orchestrator-plan', 'creator', 'story-builder', 'style', 'art-director', 'editor-clips', 'editor-assemble', 'publisher', 'orchestrator-final'])
    expect(episode.status).toBe('done')
    expect(episode.title).toBeTruthy()
  })

  it('revises the script once when the Critic asks, then stops (early stop, cap of 3)', async () => {
    const w = vi.spyOn(agents, 'writer'), c = vi.spyOn(agents, 'critic')
    const { store, episode } = memoryStore()
    await runEpisode(ctx('narrator'), store, [])
    expect(w).toHaveBeenCalledTimes(2)
    expect(c).toHaveBeenCalledTimes(2)
    expect(episode.critique).toMatchObject({ approved: true, rubric: expect.any(Object) })
  })

  it('never exceeds 3 revision rounds even if the Critic never approves', async () => {
    const spy = vi.spyOn(agents, 'critic').mockImplementation(async () => ({
      output: { score: 4, approved: false, notes: ['1. Again.'], originalityRisk: false, policyRisk: false }, summary: 'no',
    }))
    const w = vi.spyOn(agents, 'writer')
    const { store } = memoryStore()
    const out = await runEpisode(ctx('narrator'), store, [])
    expect(w).toHaveBeenCalledTimes(3)
    expect(out.status).toBe('done')
    spy.mockRestore()
  })

  it('stops for human review on a policy risk', async () => {
    const spy = vi.spyOn(agents, 'critic').mockImplementation(async () => ({
      output: { score: 9, approved: true, notes: [], originalityRisk: false, policyRisk: true }, summary: 'risk',
    }))
    const { store, events, episode } = memoryStore()
    const out = await runEpisode(ctx('narrator'), store, [])
    expect(out.status).toBe('needs-review')
    expect(episode.status).toBe('needs-review')
    expect(events).not.toContain('start:style')
    expect(events).not.toContain('start:art-director')
    expect(events).toContain('fail:story-builder:The script has a policy or originality risk and needs a human review.')
    spy.mockRestore()
  })

  it('a failed quality check says which check failed, not just "failed"', async () => {
    const spy = vi.spyOn(agents, 'editorQa').mockImplementation(async () => ({
      output: { passed: false, mock: false, checks: [{ name: 'Render', ok: true, note: '33s' }, { name: 'Loudness', ok: false, note: '-20.1 LUFS' }] }, summary: 'x',
    }))
    const { store, events, episode } = memoryStore()
    const out = await runEpisode(ctx('narrator'), store, [])
    expect(out.status).toBe('needs-review')
    expect(episode.error).toBe('Quality checks failed: Loudness (-20.1 LUFS)')
    expect(events).toContain('fail:editor-assemble:Quality checks failed: Loudness (-20.1 LUFS)')
    spy.mockRestore()
  })

  it('no-voice mode writes on-screen text and no spoken lines; voiced modes write dialogue', async () => {
    const none = memoryStore(); await runEpisode(ctx('none'), none.store, [])
    const beatsNone = (none.episode.script as { beats: { line: string | null; onScreenText: string | null }[] }).beats
    expect(beatsNone.every((b) => b.line === null)).toBe(true)
    expect(beatsNone.some((b) => b.onScreenText)).toBe(true)
    expect((none.episode.audio as { voices: unknown[] }).voices).toHaveLength(0)

    const talk = memoryStore(); await runEpisode(ctx('character_voices'), talk.store, [])
    const beatsTalk = (talk.episode.script as { beats: { line: string | null; speaker: string | null }[] }).beats
    expect(beatsTalk.some((b) => b.line && b.speaker === 'Mango')).toBe(true)
    expect((talk.episode.audio as { voices: { voice: string }[] }).voices.some((v) => v.voice === 'coral')).toBe(true)
  })

  it('stops with needs-review when the budget is used up', async () => {
    const { store, events, episode } = memoryStore({ budgetOk: false })
    const out = await runEpisode({ ...ctx('narrator'), mode: 'text' }, store, [])
    expect(out.status).toBe('needs-review')
    expect(episode.error).toBe('Cost cap reached.')
    expect(events.some((e) => e.startsWith('fail:'))).toBe(true)
  })

  describe('every shot is a video clip', () => {
    type ShotRow = { n: number; type: string; videoSeconds: number; durationSec: number; keyframePrompt: string; motionPrompt: string; characters: string[]; render?: string }
    const run = async (over: { budgetOk?: boolean; maxExtraUsd?: number } = {}, c: Ctx = ctx('character_voices', 100)) => {
      const m = memoryStore(over)
      const out = await runEpisode(c, m.store, [])
      const shots = ((m.episode.shots as { shots: ShotRow[] } | undefined)?.shots ?? [])
      return { ...m, out, shots, clips: (m.episode.videoClips ?? []) as { shot: number; seconds: number; status: string; costUsd: number; estimatedUsd: number }[] }
    }

    it('plans a clip of 5 or 10 seconds for every shot, with a keyframe prompt and a motion prompt, and no engine shots', async () => {
      const { shots, out } = await run()
      expect(out.status).toBe('done')
      expect(shots).toHaveLength(7) // a reel has 7 shots
      for (const s of shots) {
        expect([5, 10]).toContain(s.videoSeconds)
        expect(s.keyframePrompt.length).toBeGreaterThan(10)
        expect(s.motionPrompt.length).toBeGreaterThan(10)
        expect(s.render).toBeUndefined()
      }
    })

    it('puts a main character in every shot', async () => {
      const { shots } = await run()
      for (const s of shots) expect(['Mango', 'Luna']).toContain(s.characters[0])
    })

    it('records one planned clip per shot with an estimated cost, and nothing is spent yet (clips need keyframes)', async () => {
      const { clips, shots } = await run()
      expect(clips).toHaveLength(shots.length)
      expect(clips.every((c) => c.status === 'planned' && c.costUsd === 0 && c.estimatedUsd > 0)).toBe(true)
    })

    it('stops for review, without making anything, when the planned clips do not fit under the cost cap', async () => {
      const { out, episode, events } = await run({ maxExtraUsd: 0.1 }) // normal steps are fine; the video is not
      expect(out.status).toBe('needs-review')
      expect(episode.status).toBe('needs-review')
      expect(String(episode.error)).toMatch(/video clips would cost about USD/)
      expect(events).not.toContain('start:editor-clips')
    })

    it('stops for review when the clips would pass the episode ceiling', async () => {
      const { out, episode } = await run({}, { ...ctx('character_voices', 100), episodeCeilingUsd: 1 })
      expect(out.status).toBe('needs-review')
      expect(String(episode.error)).toMatch(/more than the cost cap allows/)
    })
  })

  describe('the cast rule', () => {
    const badScript = (speaker: string) => ({
      title: 'T', hook: 'h', payoff: 'p', supportingCast: [],
      beats: Array.from({ length: 7 }, (_, i) => ({ n: i + 1, action: 'a', speaker: i === 1 ? speaker : 'Mango', line: i === 1 ? 'Who is this?' : null, emotion: null, delivery: null, expression: (['neutral', 'happy', 'surprised', 'sad'] as const)[i % 4], onScreenText: null })),
    })

    it('sends a script that names someone outside the cast back to the Writer with the problem, before the Critic sees it', async () => {
      const real = agents.writer
      let calls = 0
      const spy = vi.spyOn(agents, 'writer').mockImplementation(async (c, idea, notes, prev) => {
        calls++
        if (calls === 1) return { output: badScript('Stranger'), summary: 'bad' }
        expect(notes.join(' ')).toMatch(/Cast rule: Beat 2: "Stranger" is not in the cast/)
        return real(c, idea, [], prev)
      })
      const critic = vi.spyOn(agents, 'critic')
      const { store, episode } = memoryStore()
      const out = await runEpisode(ctx('character_voices'), store, [])
      expect(out.status).toBe('done')
      expect(calls).toBe(2)
      expect(critic.mock.calls.every((c) => (c[1].beats.every((b) => b.speaker !== 'Stranger')))).toBe(true) // the bad script never reached the Critic
      expect(episode.status).toBe('done')
      spy.mockRestore(); critic.mockRestore()
    })

    it('fails clearly when the Writer keeps breaking the rule', async () => {
      const spy = vi.spyOn(agents, 'writer').mockImplementation(async () => ({ output: badScript('Stranger'), summary: 'bad' }))
      const { store, episode } = memoryStore()
      const out = await runEpisode(ctx('character_voices'), store, [])
      expect(out.status).toBe('failed')
      expect(String(episode.error)).toMatch(/still breaks the cast or length rule after 3 tries/)
      spy.mockRestore()
    })

    it('lets a declared supporting character speak and appear', async () => {
      const spy = vi.spyOn(agents, 'writer').mockImplementation(async () => ({
        output: { ...badScript('Grumble'), supportingCast: [{ name: 'Grumble', role: 'shopkeeper', canonicalLook: 'a grey owl', personality: 'grumpy', voice: null, recurring: false }] }, summary: 'ok',
      }))
      const { store, episode } = memoryStore()
      const out = await runEpisode(ctx('character_voices'), store, [])
      expect(out.status).toBe('done')
      const shots = (episode.shots as { shots: { characters: string[] }[] }).shots
      expect(shots.some((s) => s.characters.includes('Grumble'))).toBe(true)
      spy.mockRestore()
    })
  })

  describe('the length rule', () => {
    it('a reel is planned with 7 shots, one per beat, and its shots add up to the 28 s target', async () => {
      const m = memoryStore()
      const out = await runEpisode(ctx('character_voices'), m.store, [])
      expect(out.status).toBe('done')
      const planned = (m.episode.shots as { shots: { durationSec: number }[] }).shots
      expect(planned).toHaveLength(7)
      expect(planned.reduce((n, s) => n + s.durationSec, 0)).toBeCloseTo(28, 1)
      expect(Math.max(...planned.map((s) => s.durationSec))).toBeLessThanOrEqual(5) // one 5 s clip per shot
      expect((m.episode.script as { beats: unknown[] }).beats).toHaveLength(7)
    })

    it('sends a script that is too long for the reel back to the Writer with the problem, before the Critic sees it', async () => {
      const real = agents.writer
      let calls = 0
      const long = { title: 'T', hook: 'h', payoff: 'p', supportingCast: [], beats: Array.from({ length: 7 }, (_, i) => ({ n: i + 1, action: 'a', speaker: i === 0 ? 'Mango' : null, line: i === 0 ? Array.from({ length: 50 }, () => 'blah').join(' ') : null, emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null })) }
      const spy = vi.spyOn(agents, 'writer').mockImplementation(async (c, idea, notes, prev) => {
        calls++
        if (calls === 1) return { output: long, summary: 'too long' }
        expect(notes.join(' ')).toMatch(/Length rule: The spoken lines have 50 words in total; a 25–30 seconds reel can carry at most 46/)
        return real(c, idea, [], prev)
      })
      const critic = vi.spyOn(agents, 'critic')
      const m = memoryStore()
      const out = await runEpisode(ctx('character_voices'), m.store, [])
      expect(out.status).toBe('done')
      expect(calls).toBe(2)
      expect(critic.mock.calls.every((c) => c[1].beats.every((b) => (b.line?.split(' ').length ?? 0) < 30))).toBe(true)
      spy.mockRestore(); critic.mockRestore()
    })

    it('sends a script with the wrong number of beats back too', async () => {
      const spy = vi.spyOn(agents, 'writer').mockImplementation(async () => ({ output: { title: 'T', hook: 'h', payoff: 'p', supportingCast: [], beats: [{ n: 1, action: 'a', speaker: null, line: null, emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null }] }, summary: 'short' }))
      const m = memoryStore()
      const out = await runEpisode(ctx('character_voices'), m.store, [])
      expect(out.status).toBe('failed')
      expect(String(m.episode.error)).toMatch(/Length rule: The script has 1 beats; a 25–30 seconds reel needs 6 to 7/)
      spy.mockRestore()
    })
  })

  it('marks the episode failed (not stuck running) when an agent throws', async () => {
    const spy = vi.spyOn(agents, 'writer').mockRejectedValue(new Error('boom'))
    const { store, events, episode } = memoryStore()
    const out = await runEpisode(ctx('narrator'), store, [])
    expect(out.status).toBe('failed')
    expect(episode.status).toBe('failed')
    expect(events).toContain('fail:story-builder:boom')
    spy.mockRestore()
  })
})
