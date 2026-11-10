import path from 'node:path'
import { run } from './ffmpeg'
import type { Timeline } from './timeline'
import { durationSec } from './timeline'

/**
 * Mixes ALL of an episode's audio (voices, sound effects, optional music) into one track, once, with FFmpeg.
 * Doing it globally instead of per render chunk is what keeps long, chunk-rendered videos in sync: chunks carry no audio.
 * Music is ducked under speech with a side-chain compressor.
 */
export type MixPlan = { args: string[]; inputs: number; hasMusic: boolean }

/** Pure: builds the FFmpeg command for a timeline. Exported so the filter graph can be tested without running FFmpeg. */
export function buildMixPlan(t: Pick<Timeline, 'voices' | 'sfx' | 'music' | 'shots'>, assetsDir: string, outFile: string): MixPlan {
  const total = durationSec(t)
  const args: string[] = ['-y', '-v', 'error']
  const chains: string[] = []
  const bus = { voice: [] as string[], sfx: [] as string[] }
  let i = 0

  const add = (src: string, startSec: number, volume: number, to: 'voice' | 'sfx') => {
    args.push('-i', path.join(assetsDir, src))
    const ms = Math.max(0, Math.round(startSec * 1000))
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${volume}[a${i}]`)
    bus[to].push(`[a${i}]`)
    i++
  }
  for (const v of t.voices) add(v.src, v.startSec, v.volume, 'voice')
  for (const s of t.sfx) add(s.src, s.startSec, s.volume, 'sfx')

  const mixOf = (labels: string[], out: string) => (labels.length === 1
    ? chains.push(`${labels[0]}anull[${out}]`)
    : chains.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[${out}]`))

  const finals: string[] = []
  if (bus.voice.length) { mixOf(bus.voice, 'vbus'); finals.push('[vbus]') }
  if (bus.sfx.length) { mixOf(bus.sfx, 'sbus'); finals.push('[sbus]') }

  const hasMusic = !!t.music
  if (t.music) {
    args.push('-stream_loop', '-1', '-i', path.join(assetsDir, t.music.src))
    const m = i++
    const fadeStart = Math.max(0, total - 1.2).toFixed(2)
    const base = `[${m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},volume=${t.music.volume},afade=t=out:st=${fadeStart}:d=1.2`
    if (bus.voice.length) {
      // duck the music whenever a voice is speaking
      chains.push(`${base}[mraw]`)
      // pad the voice bus with silence to the full length: the side-chain stops when its key input ends, which would
      // otherwise cut the music off right after the last spoken line
      chains.push(`[vbus]apad=whole_dur=${total.toFixed(3)},asplit=2[vkey][vmix]`)
      chains.push(`[mraw][vkey]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=300[mduck]`)
      finals.splice(finals.indexOf('[vbus]'), 1, '[vmix]')
      finals.push('[mduck]')
    } else {
      chains.push(`${base}[mduck]`)
      finals.push('[mduck]')
    }
  }
  if (!finals.length) throw new Error('Nothing to mix: the timeline has no audio')

  chains.push(`${finals.join('')}amix=inputs=${finals.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(3)},apad=whole_dur=${total.toFixed(3)}[out]`)
  args.push('-filter_complex', chains.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', outFile)
  return { args, inputs: i, hasMusic }
}

export async function mixTimelineAudio(t: Pick<Timeline, 'voices' | 'sfx' | 'music' | 'shots'>, assetsDir: string, outFile: string): Promise<MixPlan> {
  const plan = buildMixPlan(t, assetsDir, outFile)
  try { await run(plan.args) } catch (e) { throw new Error(`audio mix failed: ${(e as Error).message}`) }
  return plan
}
