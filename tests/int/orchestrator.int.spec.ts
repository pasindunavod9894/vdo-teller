import { describe, expect, it, vi } from 'vitest'
import { runEpisode, type Store } from '@/pipeline/orchestrator'
import * as agents from '@/pipeline/agents'
import type { Ctx } from '@/pipeline/agents'
import type { SeriesProfile } from '@/agents/profile'
import type { StepKey } from '@/pipeline/steps'

const profile = (voiceMode: SeriesProfile['voiceMode']): SeriesProfile => ({
  niche: 'Cat videos', style: { id: 'pixar-3d' }, format: 'story-reel', durationTargetSec: 45, aspect: '9:16', voiceMode,
  cast: [
    { name: 'Mango', canonical: 'orange tabby', voiceProfile: { voice: 'coral' } },
    { name: 'Luna', canonical: 'grey cat', voiceProfile: { voice: 'onyx' } },
  ],
  narrator: { voice: 'fable' }, qualityTier: 'standard',
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

describe('orchestrator (mock mode)', () => {
  it('runs every step in the fixed order and finishes the episode', async () => {
    const { store, events, episode } = memoryStore()
    const out = await runEpisode(ctx('character_voices'), store, [])
    expect(out.status).toBe('done')
    const started = events.filter((e) => e.startsWith('start:')).map((e) => e.slice(6))
    expect(started[0]).toBe('orchestrator-plan')
    expect(started[1]).toBe('showrunner')
    expect(started.at(-1)).toBe('orchestrator-final')
    for (const k of ['art-director', 'animator', 'editor-qa', 'publisher']) expect(started).toContain(k)
    expect(started.indexOf('art-director')).toBeGreaterThan(started.lastIndexOf('critic'))
    expect(episode.status).toBe('done')
    expect(episode.title).toBeTruthy()
  })

  it('revises the script once when the Critic asks, then stops (early stop, cap of 3)', async () => {
    const { store, events } = memoryStore()
    await runEpisode(ctx('narrator'), store, [])
    expect(events.filter((e) => e === 'start:writer')).toHaveLength(2)
    expect(events.filter((e) => e === 'start:critic')).toHaveLength(2)
  })

  it('never exceeds 3 revision rounds even if the Critic never approves', async () => {
    const spy = vi.spyOn(agents, 'critic').mockImplementation(async () => ({
      output: { score: 4, approved: false, notes: ['1. Again.'], originalityRisk: false, policyRisk: false }, summary: 'no',
    }))
    const { store, events } = memoryStore()
    const out = await runEpisode(ctx('narrator'), store, [])
    expect(events.filter((e) => e === 'start:writer')).toHaveLength(3)
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
    expect(events).not.toContain('start:art-director')
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
    expect(events).toContain('fail:editor-qa:Quality checks failed: Loudness (-20.1 LUFS)')
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

  describe('real video (hybrid by tier)', () => {
    type ShotRow = { n: number; type: string; render: string; videoSeconds: number; motionPrompt: string | null }
    const run = async (allowanceSec: number, over: { budgetOk?: boolean; maxExtraUsd?: number } = {}) => {
      const m = memoryStore(over)
      const out = await runEpisode(ctx('character_voices', allowanceSec), m.store, [])
      const shots = (m.episode.shots as { shots: ShotRow[] }).shots
      return { ...m, out, shots, clips: (m.episode.videoClips ?? []) as { shot: number; seconds: number; status: string; costUsd: number; estimatedUsd: number }[] }
    }

    it('tags video shots up to the allowance and never more', async () => {
      for (const a of [0, 5, 10, 15, 25]) {
        const { shots } = await run(a)
        expect(shots.reduce((n, s) => n + s.videoSeconds, 0)).toBeLessThanOrEqual(a)
      }
      expect((await run(0)).shots.every((s) => s.render === 'engine')).toBe(true)
      expect((await run(10)).shots.some((s) => s.render === 'video')).toBe(true)
    })

    it('never sends dialogue shots to the video model, and gives every video shot a motion prompt', async () => {
      const { shots } = await run(100)
      expect(shots.filter((s) => s.type === 'dialogue').every((s) => s.render === 'engine' && s.motionPrompt === null)).toBe(true)
      expect(shots.filter((s) => s.render === 'video').every((s) => s.videoSeconds >= 5 && (s.motionPrompt ?? '').length > 10)).toBe(true)
    })

    it('holds each video shot for its whole paid clip, so no purchased seconds are wasted', async () => {
      const { shots } = await run(25)
      const video = (shots as unknown as { render: string; videoSeconds: number; durationSec: number }[]).filter((s) => s.render === 'video')
      expect(video.length).toBeGreaterThan(0)
      expect(video.every((s) => s.durationSec >= s.videoSeconds)).toBe(true)
    })

    it('records the planned clips with an estimated cost, and nothing is spent yet (clips need stills)', async () => {
      const { clips, shots } = await run(10)
      expect(clips.length).toBe(shots.filter((s) => s.render === 'video').length)
      expect(clips.every((c) => c.status === 'planned' && c.costUsd === 0 && c.estimatedUsd > 0)).toBe(true)
    })

    it('downgrades planned video to engine shots, and finishes anyway, when the budget cannot cover it', async () => {
      const { out, shots, clips, episode } = await run(10, { maxExtraUsd: 0.1 }) // normal steps are fine; $0.70 of video is not
      expect(shots.every((s) => s.render === 'engine' && s.videoSeconds === 0)).toBe(true)
      expect(clips).toEqual([])
      expect(out.status).toBe('done')
      expect(episode.status).toBe('done')
    })
  })

  it('marks the episode failed (not stuck running) when an agent throws', async () => {
    const spy = vi.spyOn(agents, 'writer').mockRejectedValue(new Error('boom'))
    const { store, events, episode } = memoryStore()
    const out = await runEpisode(ctx('narrator'), store, [])
    expect(out.status).toBe('failed')
    expect(episode.status).toBe('failed')
    expect(events).toContain('fail:writer:boom')
    spy.mockRestore()
  })
})
