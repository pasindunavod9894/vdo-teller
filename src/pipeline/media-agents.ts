import fs from 'node:fs'
import path from 'node:path'
import type { Ctx, AgentResult, Usage } from './agents'
import type { QaReport, Script, ShotList, Timeline as PipelineTimeline, VideoClip } from './schemas'
import { scrubText } from './brand-safety'
import { buildTimeline, speechInfoFrom, type SpeechInfo } from './timeline-builder'
import { produceVideoShots } from './video-shots'
import { ensureSfx } from '../engine/sfx'
import { ensureMusic, moodFor } from '../engine/music'
import { rmsPerFrame } from '../engine/lipsync'
import { normalizeLoudness, videoSeconds } from '../engine/finish'
import { compositeScene } from '../media/scene-still'
import { withClipCache } from '../media/clip-cache'
import { makeClip } from '../providers/video'
import { IMAGE_COST, QUALITY_FOR_TIER } from '../lib/art/plan'
import { hashOf } from '../media/workspace'
import { chromePath, type MediaCtx } from './media-ctx'

/** Plates per episode: a handful of backgrounds reused across the shots keeps image cost low and the look consistent. */
export const PLATES_PER_EPISODE = 3
const GATE_USD = 0.01
const GATE_RULES = 'One intact character on a background. No extra limbs, no distorted or merged face, no stray text, watermarks or logos, and the character is clearly visible and fully inside the frame.'

const usageOf = (model: string, costUsd: number, videoSeconds = 0, images = 0): Usage => ({ model, inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd, ...(videoSeconds ? { videoSeconds } : {}), ...(images ? { images } : {}) })
const round = (n: number) => Math.round(n * 10000) / 10000

// ---------- Art Director: background plates, checked scene stills for the video shots ----------
export async function artDirectorMedia(ctx: Ctx, m: MediaCtx, shots: ShotList): Promise<AgentResult<ShotList>> {
  const list = shots.shots
  const look = ctx.profile.style.promptTemplate
  let cost = 0
  let images = 0
  const plateUsd = IMAGE_COST[QUALITY_FOR_TIER[ctx.profile.qualityTier]]
  const notes: string[] = []

  // 1. background plates (no characters: the engine places those)
  const groupOf = (i: number) => Math.min(PLATES_PER_EPISODE - 1, Math.floor((i * PLATES_PER_EPISODE) / Math.max(1, list.length)))
  const plateFiles: string[] = []
  for (let g = 0; g < PLATES_PER_EPISODE; g++) {
    const first = list.find((_, i) => groupOf(i) === g)
    if (!first) continue
    const prompt = scrubText(`${look}. An empty background scene for a "${ctx.profile.niche}" story, with no characters, no people, no animals, no text and no logos: ${first.description}. Portrait composition with open space in the lower middle.`)
    if (ctx.canSpend && !(await ctx.canSpend(plateUsd))) {
      if (!plateFiles.length) throw new Error('Cost cap reached.')
      plateFiles[g] = plateFiles[g - 1]
      notes.push(`plate ${g + 1} reused (cost cap)`)
      continue
    }
    const r = await m.media.plate({ key: `ep-${hashOf(prompt)}`, prompt })
    plateFiles[g] = r.file
    cost += r.costUsd
    if (!r.cached) images++
  }
  list.forEach((s, i) => { m.state.plates[s.n] = plateFiles[groupOf(i)] ?? plateFiles[0] })

  // 2. a scene still with the character in it for every video shot, vetted BEFORE any video money is spent
  let checked = 0
  const out = [...list]
  for (let i = 0; i < out.length; i++) {
    const s = out[i]
    if (s.render !== 'video') continue
    const who = s.characters[0] ?? Object.keys(m.kits)[0]
    const kit = who ? m.kits[who] : undefined
    const downgrade = (why: string) => {
      out[i] = { ...s, render: 'engine', videoSeconds: 0, motionPrompt: null }
      notes.push(`shot ${s.n}: ${why}, rendered by the engine`)
    }
    if (!kit) { downgrade('no character kit for a scene still'); continue }
    const still = await compositeScene({ assetsDir: m.ws.assetsDir, plate: m.state.plates[s.n], character: kit.stand, out: `scene-${s.n}.png`, width: m.width, height: m.height })
    if (ctx.canSpend && !(await ctx.canSpend(GATE_USD))) { downgrade('cost cap reached before the still check'); continue }
    const gate = await m.media.gate(path.join(m.ws.assetsDir, still), GATE_RULES)
    cost += gate.costUsd
    checked++
    if (!gate.pass) { downgrade(`the scene still failed the check (${gate.notes.slice(0, 80)})`); continue }
    m.state.stills[s.n] = still
  }

  const video = out.filter((s) => s.render === 'video')
  const dialogue = out.filter((s) => s.type === 'dialogue').length
  const summary = `${out.length} shots · ${dialogue} dialogue · ${plateFiles.filter(Boolean).length} plates · ${checked} scene stills checked · ${video.length ? `${video.length} real-motion (${video.reduce((n, s) => n + s.videoSeconds, 0)}s)` : 'no real-motion shots'}${notes.length ? ` · ${notes.join('; ')}` : ''}`
  return { output: { shots: out }, summary, usage: usageOf(`image:${m.media.provider}`, round(cost), 0, images) }
}

// ---------- Animator: voices, sound effects, video clips, the engine timeline ----------
export async function animatorMedia(ctx: Ctx, m: MediaCtx, script: Script, shots: ShotList): Promise<AgentResult<PipelineTimeline>> {
  let cost = 0
  const notes: string[] = []
  const { assetsDir } = m.ws

  const sfx = { whoosh: await ensureSfx('whoosh', assetsDir), hiss: await ensureSfx('steam-hiss', assetsDir), thud: await ensureSfx('thud', assetsDir) }

  // 1. speech for every spoken line, one at a time (natural pacing), with word timings and loudness for lip-sync
  const speech: Record<number, SpeechInfo> = {}
  const voices: PipelineTimeline['audio']['voices'] = []
  for (const b of script.beats) {
    if (!b.line || !b.speaker) continue
    const profile = b.speaker === 'narrator' ? ctx.profile.narrator : ctx.profile.cast.find((c) => c.name === b.speaker)?.voiceProfile ?? null
    const voice = profile?.voice ?? 'fable'
    const instructions = [profile?.instructions, b.emotion && `Emotion: ${b.emotion}.`, b.delivery && `Delivery: ${b.delivery}.`].filter(Boolean).join(' ') || undefined
    if (ctx.canSpend && !(await ctx.canSpend(0.01))) { notes.push(`line ${b.n} skipped (cost cap)`); continue }
    const r = await m.media.speech({ name: `beat-${b.n}`, text: b.line, voice, instructions })
    cost += r.costUsd
    const rms = await rmsPerFrame(path.join(assetsDir, r.file), m.fps)
    speech[b.n] = speechInfoFrom(r.file, r.seconds, r.words, rms, m.fps)
    voices.push({ speaker: b.speaker, voice, text: b.line })
  }

  // 2. real-video clips from the checked stills; any shot that does not get a clip is rendered by the engine
  const videoShots = shots.shots.filter((s) => s.render === 'video')
  const clips: Record<number, { file: string; seconds: number }> = {}
  let videoClips: VideoClip[] = []
  let videoUsd = 0
  let videoSec = 0
  if (videoShots.length) {
    const r = await produceVideoShots({
      model: ctx.video.model, shots: videoShots.map((s) => ({ n: s.n, videoSeconds: s.videoSeconds, motionPrompt: s.motionPrompt })),
      workDir: m.ws.clipsDir, allowanceSec: ctx.video.allowanceSec, make: withClipCache(m.ws.libraryDir, makeClip),
      stillFor: (n) => (m.state.stills[n] ? path.join(assetsDir, m.state.stills[n]) : null),
    })
    videoClips = r.clips
    videoUsd = r.totalCostUsd
    videoSec = r.totalSeconds
    for (const c of r.clips) {
      if ((c.status === 'generated' || c.status === 'mock') && c.file) {
        const name = `clip-${c.shot}.mp4`
        fs.copyFileSync(c.file, path.join(assetsDir, name))
        clips[c.shot] = { file: name, seconds: c.seconds }
      }
    }
    for (const n of r.fallbackShots) notes.push(`shot ${n} fell back to the engine`)
  }

  // 3. background music in a mood that suits the niche; louder when nobody speaks, and ducked under speech by the mixer
  const mood = moodFor(ctx.profile.niche, ctx.profile.subNiche)
  const music = { src: ensureMusic(mood, assetsDir), volume: voices.length ? 0.16 : 0.3 }

  // 4. the engine timeline
  const built = buildTimeline({
    fps: m.fps, width: m.width, height: m.height, script, shots: shots.shots,
    kits: m.kits, speech, plates: m.state.plates, fallbackPlate: Object.values(m.state.plates)[0] ?? '', clips, stills: m.state.stills, sfx, music,
  })
  m.state.engine = built.timeline
  fs.writeFileSync(path.join(m.ws.episodeDir, 'timeline.json'), JSON.stringify(built.timeline, null, 2))
  notes.push(...built.notes)

  const timeline: PipelineTimeline = {
    durationSec: Math.round(built.durationSec),
    shots: built.timeline.shots.map((s, i) => ({
      n: shots.shots[i]?.n ?? i + 1, type: shots.shots[i]?.type ?? 'info', camera: s.camera.move,
      motion: s.video ? `real motion (${ctx.video.model})` : s.layers.some((l) => l.kind === 'character') ? 'character animation' : 'camera only',
      durationSec: s.durationSec, render: s.video ? 'video' : 'engine', videoSeconds: s.video ? (clips[shots.shots[i]?.n]?.seconds ?? 0) : 0,
    })),
    audio: { voices, music: `${mood} loop (generated)`, sfx: [...new Set(built.timeline.sfx.map((x) => x.src))] },
    videoClips, mock: false,
  }
  const summary = `${timeline.durationSec}s timeline · ${voices.length} voiced lines · ${Object.keys(clips).length}/${videoShots.length} video clips${notes.length ? ` · ${notes.slice(0, 3).join('; ')}` : ''}`
  return { output: timeline, summary, usage: usageOf(`speech:${m.media.provider}+video:${ctx.video.provider}`, round(cost + videoUsd), videoSec) }
}

// ---------- Editor-QA: render, loudness, checks ----------
export async function editorQaMedia(ctx: Ctx, m: MediaCtx, timeline: PipelineTimeline): Promise<AgentResult<QaReport>> {
  const engine = m.state.engine
  if (!engine) throw new Error('There is no timeline to render')
  const out = path.join(m.ws.outDir, 'master.mp4')
  // loaded only when a real render is needed: the Remotion bundler is heavy and must not load with the agents
  const render = m.renderFn ?? (await import('../engine/render')).renderTimelineChunked
  await render({
    timeline: engine, assetsDir: m.ws.assetsDir, outFile: out, workDir: path.join(m.ws.outDir, 'work'), browserExecutable: chromePath(), concurrency: 2,
  })
  const loud = await normalizeLoudness(out)
  const secs = await videoSeconds(out)
  const expected = engine.shots.reduce((n, s) => n + s.durationSec, 0)
  const spoken = timeline.audio.voices.length
  // only a character's own line needs a speaking face; a narrator talks over the pictures
  const characterLines = timeline.audio.voices.filter((v) => v.speaker !== 'narrator').length
  const checks = [
    { name: 'Render', ok: fs.existsSync(out) && fs.statSync(out).size > 1000, note: `${secs.toFixed(1)}s master` },
    { name: 'Length matches the timeline', ok: Math.abs(secs - expected) < 0.3, note: `${secs.toFixed(2)}s vs ${expected.toFixed(2)}s` },
    { name: 'Loudness', ok: Math.abs(loud.after.integrated + 14) <= 1.5 && loud.after.truePeak <= -0.9, note: `${loud.after.integrated.toFixed(1)} LUFS · peak ${loud.after.truePeak.toFixed(1)} dB` },
    { name: 'Voices', ok: engine.voices.length === spoken, note: `${engine.voices.length} of ${spoken} lines placed` },
    { name: 'Captions', ok: engine.captions.length === engine.voices.length, note: `${engine.captions.length} captions` },
    { name: 'Lip-sync', ok: !characterLines || engine.shots.some((s) => s.layers.some((l) => l.kind === 'character' && Boolean(l.talk))), note: characterLines ? 'speaking faces present' : 'not needed (narrator only)' },
  ]
  m.state.master = path.relative(m.ws.episodeDir, out)
  const passed = checks.every((c) => c.ok)
  return { output: { passed, checks, mock: false }, summary: passed ? `Rendered ${secs.toFixed(1)}s · ${loud.after.integrated.toFixed(1)} LUFS` : `Checks failed: ${checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}` }
}
