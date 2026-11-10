import fs from 'node:fs'
import path from 'node:path'
import { mixTimelineAudio } from './audio'
import { buildAss, hasOverlayText } from './captions-ass'
import { probe, run } from './ffmpeg'
import { durationSec, shotStarts, TimelineSchema, type Timeline, type TimelineInput } from './timeline'

/**
 * The FFmpeg assembler (replaces the Remotion renderer). It turns a Timeline of video clips into the finished reel:
 *   1. every clip is scaled and cropped to the frame, trimmed (or held on its last frame) to the exact shot length,
 *   2. the shots are joined with `xfade` transitions or hard cuts, and then graded, vignetted, given film grain and captions,
 *   3. all audio (voices, effects, music with ducking) is mixed once and added.
 *
 * Timing rule: a shot's `durationSec` is the time it is fully on screen. A transition into a shot happens in the time just
 * BEFORE it starts, so every shot starts exactly at the sum of the earlier durations. That keeps voices, effects and the
 * audio mix (which are placed against those start times) in sync with the picture.
 */

export type AssembleOptions = {
  timeline: TimelineInput
  /** folder that holds every file the timeline references */
  assetsDir: string
  outFile: string
  /** scratch folder for the caption file, the video-only render and the mixed audio */
  workDir: string
  /** a folder of font files for libass; defaults to ./fonts when it exists */
  fontsDir?: string
}

/** How long each shot's incoming transition is (seconds). Index 0 is always 0. Clamped so neighbouring transitions never overlap. */
export function transitionLengths(t: Pick<Timeline, 'shots'>): number[] {
  return t.shots.map((s, i) => {
    if (i === 0 || s.transitionIn === 'cut') return 0
    const room = 0.5 * Math.min(s.durationSec, t.shots[i - 1].durationSec)
    return Math.max(0.1, Math.min(s.transitionSec, room))
  })
}

const f3 = (n: number) => n.toFixed(3)

/** FFmpeg vignette angle (smaller = stronger) for a 0..1 strength; empty when the vignette is off. */
const vignetteFilter = (v: number) => (v > 0.01 ? `vignette=angle=${Math.min(1.2, Math.max(0.3, 1.2 - 0.9 * v)).toFixed(2)}` : '')
/** Temporal film grain for a 0..1 strength; empty when it is off. */
const grainFilter = (g: number) => (g > 0.01 ? `noise=alls=${Math.max(1, Math.round(g * 25))}:allf=t` : '')

/**
 * Pure: the filter graph for the video part. `clipSecs[i]` is the length of shot i's clip file. Returns the filter_complex text
 * and the name of its final video label. `assFile` is a path relative to the FFmpeg working directory, or null for no captions.
 */
export function buildVideoGraph(t: Timeline, clipSecs: number[], assFile: string | null, fontsDir?: string | null): { filter: string; out: string; lengths: number[] } {
  const { width: W, height: H, fps } = t
  const trans = transitionLengths(t)
  const starts = shotStarts(t)
  const parts: string[] = []
  const lengths: number[] = []

  t.shots.forEach((s, i) => {
    const len = s.durationSec + trans[i]
    lengths.push(len)
    const available = Math.max(0.04, clipSecs[i] - s.trimStartSec)
    const hold = Math.max(0, len - available) + 0.1
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p,` +
      `trim=start=${f3(s.trimStartSec)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${f3(hold)},trim=duration=${f3(len)},setpts=PTS-STARTPTS[v${i}]`,
    )
  })

  let acc = 'v0'
  for (let i = 1; i < t.shots.length; i++) {
    const out = `x${i}`
    if (trans[i] > 0) {
      parts.push(`[${acc}][v${i}]xfade=transition=${t.shots[i].transitionIn}:duration=${f3(trans[i])}:offset=${f3(starts[i] - trans[i])}[${out}]`)
    } else {
      // concat resets the timebase, which xfade refuses to mix with, so put it back
      parts.push(`[${acc}][v${i}]concat=n=2:v=1:a=0,fps=${fps},settb=1/${fps}[${out}]`)
    }
    acc = out
  }

  const finish = [
    t.look.gradeFilter.trim(), vignetteFilter(t.look.vignette), grainFilter(t.look.grain), 'format=yuv420p',
    assFile ? `ass=filename=${assFile}${fontsDir ? `:fontsdir=${fontsDir}` : ''}` : '',
  ].filter(Boolean).join(',')
  parts.push(`[${acc}]${finish}[vout]`)
  return { filter: parts.join(';'), out: 'vout', lengths }
}

const safePath = (p: string) => /^[\w./ -]+$/.test(p)

function pickFontsDir(explicit?: string): string | null {
  const dir = explicit ?? process.env.FONTS_DIR ?? path.resolve(process.cwd(), 'fonts')
  return fs.existsSync(dir) && safePath(dir) ? dir : null
}

/** A silent stereo track, so every reel has an audio stream even when it has no voice and no music. */
async function silence(file: string, seconds: number) {
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', f3(seconds), file])
}

export async function assembleTimeline(opts: AssembleOptions) {
  const t: Timeline = TimelineSchema.parse(opts.timeline) // fail early on a bad timeline
  fs.mkdirSync(opts.workDir, { recursive: true })
  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true })

  const files = t.shots.map((s) => path.join(opts.assetsDir, s.clip))
  const clipSecs: number[] = []
  for (let i = 0; i < files.length; i++) {
    if (!fs.existsSync(files[i])) throw new Error(`Shot ${t.shots[i].id}: clip ${t.shots[i].clip} is missing`)
    const p = await probe(files[i])
    if (!p.hasVideo || p.durationSec <= 0) throw new Error(`Shot ${t.shots[i].id}: ${t.shots[i].clip} has no readable video`)
    clipSecs.push(p.durationSec)
  }

  const assName = 'captions.ass'
  const withText = hasOverlayText(t)
  if (withText) fs.writeFileSync(path.join(opts.workDir, assName), buildAss(t))
  const graph = buildVideoGraph(t, clipSecs, withText ? assName : null, pickFontsDir(opts.fontsDir))

  const total = durationSec(t)
  const videoOnly = path.join(opts.workDir, 'video-only.mp4')
  await run([
    '-y', '-v', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', graph.filter, '-map', `[${graph.out}]`,
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(t.fps), '-t', f3(total), videoOnly,
  ], { cwd: opts.workDir })

  const audio = path.join(opts.workDir, 'audio.wav')
  if (t.voices.length || t.sfx.length || t.music) await mixTimelineAudio(t, opts.assetsDir, audio)
  else await silence(audio, total)

  await run(['-y', '-v', 'error', '-i', videoOnly, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', f3(total), '-movflags', '+faststart', opts.outFile])
  return { durationSec: total, durationInFrames: Math.round(total * t.fps), fps: t.fps, width: t.width, height: t.height, shots: t.shots.length }
}

/**
 * Makes another aspect ratio from the finished master (plan §8): the master is shown whole in the middle, over a blurred,
 * darkened and enlarged copy of itself, so nothing is cropped away. Audio is copied untouched.
 */
export async function reframeVideo(inFile: string, outFile: string, size: { width: number; height: number }) {
  const { width: W, height: H } = size
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const graph = `[0:v]split=2[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=30,eq=brightness=-0.08[b];` +
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
  await run(['-y', '-v', 'error', '-i', inFile, '-filter_complex', graph, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart', outFile])
}
