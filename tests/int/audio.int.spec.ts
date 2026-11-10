import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildMixPlan, mixTimelineAudio } from '@/engine/audio'
import { ensureSfx, SFX_NAMES, sfxDuration } from '@/engine/sfx'
import { probeDuration } from '@/providers/video/fal'

let dir = ''

/** Mean volume in dB of a window of a file (-91 means silence). */
function meanDb(file: string, startSec: number, lenSec: number, bandHz?: number): number {
  // optionally look at one frequency band only, to measure one sound inside a mix of several
  const af = bandHz ? `bandpass=f=${bandHz}:width_type=h:w=60,volumedetect` : 'volumedetect'
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(startSec), '-t', String(lenSec), '-i', file, '-af', af, '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr)
  return m ? Number(m[1]) : -91
}

const tone = (name: string, hz: number, sec: number) => {
  const f = path.join(dir, name)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}`, '-ar', '24000', '-ac', '1', f])
  return name
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-')) })

describe('synthesized sound effects', () => {
  it.each(SFX_NAMES)('%s exists, has about the planned length, and is not silent', async (name) => {
    const file = await ensureSfx(name, dir)
    expect(file).toBe(`sfx-${name}.wav`)
    const len = await probeDuration(path.join(dir, file))
    expect(Math.abs(len - sfxDuration(name))).toBeLessThan(0.1)
    expect(meanDb(path.join(dir, file), 0, sfxDuration(name))).toBeGreaterThan(-40)
  })
  it('does not regenerate an existing file', async () => {
    await ensureSfx('pop', dir)
    const before = fs.statSync(path.join(dir, 'sfx-pop.wav')).mtimeMs
    await ensureSfx('pop', dir)
    expect(fs.statSync(path.join(dir, 'sfx-pop.wav')).mtimeMs).toBe(before)
  })
})

describe('audio mixer', () => {
  const shots = [{ id: 's', clip: 'x.mp4', durationSec: 6, trimStartSec: 0, transitionIn: 'cut' as const, transitionSec: 0.3, text: [] }]

  it('puts each sound at its start time on one track of exactly the episode length', async () => {
    const voice = tone('voice.wav', 440, 1)
    const sfx = tone('hit.wav', 880, 0.5)
    const out = path.join(dir, 'mix1.wav')
    await mixTimelineAudio({ voices: [{ src: voice, startSec: 1, volume: 1 }], sfx: [{ src: sfx, startSec: 3.5, volume: 1 }], music: null, shots }, dir, out)
    expect(Math.abs((await probeDuration(out)) - 6)).toBeLessThan(0.1)
    expect(meanDb(out, 1.1, 0.8)).toBeGreaterThan(-30) // voice is there
    expect(meanDb(out, 3.6, 0.3)).toBeGreaterThan(-30) // effect is there
    expect(meanDb(out, 0.0, 0.8)).toBeLessThan(-60) // silent before the voice
    expect(meanDb(out, 2.4, 0.8)).toBeLessThan(-60) // silent between the two
    expect(meanDb(out, 4.8, 1.0)).toBeLessThan(-60) // silent after
  })

  it('ducks the music while a voice is speaking and brings it back after', async () => {
    // the music is a 523 Hz tone, the voice a 300 Hz tone, so the music can be measured on its own inside the mix
    const voice = tone('talk.wav', 300, 2)
    const music = tone('bed.wav', 523, 3)
    const withVoice = path.join(dir, 'mix2.wav')
    await mixTimelineAudio({ voices: [{ src: voice, startSec: 2, volume: 1 }], sfx: [], music: { src: music, volume: 0.5 }, shots }, dir, withVoice)
    const alone = path.join(dir, 'mix3.wav')
    await mixTimelineAudio({ voices: [], sfx: [], music: { src: music, volume: 0.5 }, shots }, dir, alone)

    const unducked = meanDb(alone, 2.4, 1.2, 523) // the bed with nobody speaking
    const ducked = meanDb(withVoice, 2.4, 1.2, 523) // the same bed while the voice speaks
    expect(unducked).toBeGreaterThan(-40)
    expect(unducked - ducked).toBeGreaterThan(3) // clearly quieter under speech
    const after = meanDb(withVoice, 4.6, 0.8, 523) // voice has ended: the bed is back
    expect(Math.abs(after - meanDb(alone, 4.6, 0.8, 523))).toBeLessThan(2)
  })

  it('fails clearly when there is nothing to mix, and builds one input per sound', () => {
    expect(() => buildMixPlan({ voices: [], sfx: [], music: null, shots }, dir, 'x.wav')).toThrow(/Nothing to mix/)
    const p = buildMixPlan({ voices: [{ src: 'a.wav', startSec: 0, volume: 1 }], sfx: [{ src: 'b.wav', startSec: 1, volume: 1 }], music: null, shots }, dir, 'x.wav')
    expect(p.inputs).toBe(2)
    expect(p.hasMusic).toBe(false)
  })
})
