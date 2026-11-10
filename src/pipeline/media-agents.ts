import fs from 'node:fs'
import path from 'node:path'
import type { Ctx, AgentResult, Usage } from './agents'
import type { EpisodeStyle, QaReport, ReelQaFlag, Script, ShotList, Timeline as PipelineTimeline } from './schemas'
import { scrubText } from './brand-safety'
import { buildTimeline, speechInfoFrom, voiceNeedSec, type SpeechInfo } from './timeline-builder'
import { produceVideoShots, type ShotJob } from './video-shots'
import { imageConcurrency, runPool } from './pool'
import { BudgetError, withSpend } from './errors'
import { NARRATOR, voiceForSupporting } from './cast'
import { checkClipContinuity, galleryReferences, makeSheetAt, saveApprovedFrame, type CastRef, type ClipCheck } from './continuity'
import { assembleTimeline } from '../engine/assemble'
import { shotStarts } from '../engine/timeline'
import { probe } from '../engine/ffmpeg'
import { ensureSfx } from '../engine/sfx'
import { ensureMusic, moodFor } from '../engine/music'
import { normalizeLoudness, videoSeconds } from '../engine/finish'
import { withClipCache } from '../media/clip-cache'
import { kitFace, kitReferences } from '../media/kit'
import { makeClip, makeLipsync } from '../providers/video'
import { clipSeconds } from '../lib/video'
import { IMAGE_COST, KEYFRAME_QUALITY, REFERENCE_QUALITY } from '../lib/art/plan'
import { tokenOptimization } from '../agents/optimization'
import { hashOf, safeName } from '../media/workspace'
import { MODELS } from '../agents/models'
import { saveMediaState, type MediaCtx } from './media-ctx'
import { REEL_MAX_SEC, REEL_MIN_SEC } from '../lib/format'
import { VIBES } from '../lib/vibes'

/** Plates per episode: a handful of backgrounds reused across the shots keeps image cost low and the location consistent. */
export const PLATES_PER_EPISODE = 3
const GATE_USD = 0.01
const KEYFRAME_RULES = 'Each listed character looks exactly like its reference image: same face, colours, markings, proportions and outfit. No extra characters, no extra limbs, no distorted or merged faces, no stray text, watermarks or logos, and every character is clearly visible and fully inside the frame.'

const usageOf = (model: string, costUsd: number, videoSeconds = 0, images = 0): Usage => ({ model, inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd, ...(videoSeconds ? { videoSeconds } : {}), ...(images ? { images } : {}) })
const round = (n: number) => Math.round(n * 10000) / 10000
const abs = (m: MediaCtx, file: string) => path.join(m.ws.assetsDir, file)

// ---------- Art Director: location plates, supporting-character references, checked keyframes ----------
export async function artDirectorMedia(ctx: Ctx, m: MediaCtx, script: Script, shots: ShotList, epStyle?: EpisodeStyle): Promise<AgentResult<ShotList>> {
  const list = shots.shots
  const baseLook = ctx.profile.style.imagePrompt ?? ctx.profile.style.promptTemplate ?? ''
  // this reel's mood, time of day, weather and accent colour (from the Style agent) sit inside the series look
  const look = epStyle ? `${baseLook} This reel: ${epStyle.mood}, ${epStyle.timeOfDay}, ${epStyle.weather}, with ${epStyle.accentColour} as the accent colour. ${epStyle.note}` : baseLook
  const episodeKey = path.basename(m.ws.episodeDir)
  let cost = 0
  let images = 0
  let checked = 0
  const notes: string[] = []
  const ask = async (usd: number) => { if (ctx.canSpend && !(await ctx.canSpend(usd))) throw new BudgetError() }

  try {
    // 1. location plates (no characters: a few backgrounds reused across the shots) and 2. a reference image for each supporting
    // character the script declared (a recurring one is reused from the series library). None of these needs another, so they are
    // all made at the same time.
    const limit = imageConcurrency()
    const groupOf = (i: number) => Math.min(PLATES_PER_EPISODE - 1, Math.floor((i * PLATES_PER_EPISODE) / Math.max(1, list.length)))
    const plateFiles: string[] = []
    const setup: (() => Promise<void>)[] = []
    for (let g = 0; g < PLATES_PER_EPISODE; g++) {
      const first = list.find((_, i) => groupOf(i) === g)
      if (!first) continue
      setup.push(async () => {
        const prompt = scrubText(`${look}. An empty background scene for a "${ctx.profile.niche}" story, with no characters, no people, no animals, no text and no logos: ${first.description}. Portrait composition with open space in the lower middle.`)
        await ask(IMAGE_COST[KEYFRAME_QUALITY])
        const r = await m.media.plate({ key: `ep-${hashOf(prompt)}`, prompt })
        plateFiles[g] = r.file
        cost += r.costUsd
        if (!r.cached && r.costUsd > 0) images++
      })
    }
    for (const sc of script.supportingCast) {
      setup.push(async () => {
        const key = sc.recurring ? `sup-${safeName(sc.name)}` : `sup-${safeName(sc.name)}-${episodeKey}`
        const prompt = scrubText(`${look}. Character reference sheet of ONE character on a plain light-grey background: front view, three-quarter view and side view of the same character, full body. ${sc.canonicalLook} No text, no labels, no other characters.`)
        await ask(IMAGE_COST[REFERENCE_QUALITY])
        const r = await m.media.reference({ key, prompt })
        m.state.supporting[sc.name] = { file: r.file, recurring: sc.recurring }
        cost += r.costUsd
        if (!r.cached && r.costUsd > 0) images++
      })
    }
    const setupFailed = await runPool(setup, limit, (job) => job())
    if (setupFailed.length) throw setupFailed[0].error
    list.forEach((s, i) => { m.state.plates[s.n] = plateFiles[groupOf(i)] ?? plateFiles[0] })

    // 3. one keyframe per shot: an image edit that is given the plate and the references of the characters in it, then vetted
    // BEFORE any video money is spent on it. A failed check is made again once; a second failure stops the episode. The shots do not
    // depend on each other, so they are made at the same time; the two tries of ONE shot stay in order (the second is told what was wrong).
    const failedNotes: { n: number; text: string }[] = []
    const makeKeyframe = async (s: ShotList['shots'][number]) => {
      const refFiles: string[] = [m.state.plates[s.n]]
      const castRefs: CastRef[] = []
      // the face of the shot: the beat names an expression for the main character it is about (the speaker, else the first main character
      // in the shot). That character is given the close-up of this expression as its reference, so the face matches the story beat by beat.
      const beat = script.beats.find((b) => b.n === s.beat)
      const wanted = beat?.expression ?? 'neutral'
      const lead = s.characters.find((n) => n === beat?.speaker && m.kits[n]) ?? s.characters.find((n) => m.kits[n])
      for (const name of s.characters) {
        const kit = m.kits[name]
        const sup = m.state.supporting[name]
        if (kit) {
          refFiles.push(...(name === lead ? [kit.sheet, kitFace(kit, wanted)] : kitReferences(kit, 2)), ...galleryReferences(m.ws.libraryDir, name, m.ws.assetsDir, 1))
          castRefs.push({ name, reference: abs(m, kit.sheet), main: true })
        } else if (sup) {
          refFiles.push(sup.file)
          castRefs.push({ name, reference: abs(m, sup.file), main: false })
        } else {
          throw new Error(`Shot ${s.n}: "${name}" has no reference image, so it cannot appear.`)
        }
      }
      m.state.shotCast[s.n] = castRefs
      const castLine = s.characters.length ? `Characters (each must look exactly like its reference image): ${s.characters.join(', ')}. No other characters.` : 'No characters, people or animals in this shot.'
      const faceLine = lead ? ` ${lead}'s face shows a clearly ${wanted} expression, like the expression close-up of ${lead} in the references.` : ''
      const prompt = scrubText(`${look}. ${s.keyframePrompt} Vertical 9:16 composition with the subjects in the middle of the frame. ${castLine}${faceLine} The first reference image is the empty location: keep its setting, light and colours. No text, no watermark, no logo.`)
      const rules = `${KEYFRAME_RULES} ${s.characters.length ? `The characters in the image must be exactly: ${s.characters.join(', ')}.` : 'There must be no characters at all.'}`

      let ok = false
      let lastNotes = ''
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        await ask(IMAGE_COST[KEYFRAME_QUALITY] + GATE_USD)
        const kf = await m.media.keyframe({ key: `${episodeKey}-shot-${s.n}-${attempt}`, prompt: attempt > 1 ? `${prompt} Fix this problem from the previous try: ${lastNotes}` : prompt, references: [...new Set(refFiles)] })
        cost += kf.costUsd
        if (kf.costUsd > 0) images++
        const gate = await m.media.gate(abs(m, kf.file), rules, castRefs.map((c) => ({ name: c.name, file: c.reference })))
        cost += gate.costUsd
        checked++
        if (gate.pass) { m.state.keyframes[s.n] = kf.file; ok = true } else { lastNotes = gate.notes; failedNotes.push({ n: s.n, text: `shot ${s.n}: keyframe try ${attempt} failed the check (${gate.notes.slice(0, 80)})` }) }
      }
      if (!ok) throw new Error(`Shot ${s.n}: the keyframe failed the character check twice (${lastNotes.slice(0, 120)}).`)
    }
    const keyframesFailed = await runPool(list, limit, makeKeyframe)
    failedNotes.sort((a, b) => a.n - b.n).forEach((f) => notes.push(f.text))
    if (keyframesFailed.length) throw keyframesFailed[0].error
  } catch (e) {
    throw withSpend(e as Error, round(cost))
  }

  // remembered next to the episode: the review step continues from it, and "Fix shot" finds each shot's keyframe
  saveMediaState(m.ws.episodeDir, m.state)
  const dialogue = list.filter((s) => s.type === 'dialogue').length
  const summary = `${list.length} shots · ${dialogue} dialogue · ${plateCount(m)} plates · ${Object.keys(m.state.supporting).length} supporting · ${checked} keyframe checks${notes.length ? ` · ${notes.slice(0, 2).join('; ')}` : ''}`
  return { output: shots, summary, usage: usageOf(`image:${m.media.provider}`, round(cost), 0, images) }
}

const plateCount = (m: MediaCtx) => new Set(Object.values(m.state.plates).filter(Boolean)).size

// ---------- Editor: voices, video clips (lip-synced, continuity-checked), the timeline ----------
export async function animatorMedia(ctx: Ctx, m: MediaCtx, script: Script, shots: ShotList): Promise<AgentResult<PipelineTimeline>> {
  let cost = 0
  const notes: string[] = []
  const { assetsDir } = m.ws

  try {
    const sfx = { whoosh: await ensureSfx('whoosh', assetsDir) }

    // 1. speech for every spoken line, one at a time (natural pacing), with word timings
    const mainVoices = ctx.profile.cast.map((c) => c.voiceProfile?.voice).filter(Boolean) as string[]
    const used = [...mainVoices, ...(ctx.profile.narrator?.voice ? [ctx.profile.narrator.voice] : [])]
    const supportingVoice = new Map<string, string>()
    const voiceOf = (name: string) => {
      const sc = script.supportingCast.find((x) => x.name === name)
      if (!sc) return null
      if (!supportingVoice.has(name)) { const v = voiceForSupporting(sc.voice, used); used.push(v); supportingVoice.set(name, v) }
      return { voice: supportingVoice.get(name)!, instructions: `${sc.personality}.` }
    }
    const speech: Record<number, SpeechInfo> = {}
    const voices: PipelineTimeline['audio']['voices'] = []
    // the voice of every line is chosen first, in script order (so a supporting character always gets the same voice), then the
    // lines themselves are spoken at the same time: each one is its own request and none depends on another
    const lines: { b: (typeof script.beats)[number]; voice: string; instructions: string | undefined }[] = []
    for (const b of script.beats) {
      if (!b.line || !b.speaker) continue
      const profile = b.speaker === NARRATOR ? ctx.profile.narrator : ctx.profile.cast.find((c) => c.name === b.speaker)?.voiceProfile ?? voiceOf(b.speaker)
      const voice = profile?.voice ?? 'fable'
      const instructions = [profile?.instructions, b.emotion && `Emotion: ${b.emotion}.`, b.delivery && `Delivery: ${b.delivery}.`].filter(Boolean).join(' ') || undefined
      lines.push({ b, voice, instructions })
      voices.push({ speaker: b.speaker, voice, text: b.line })
    }
    const spoken_ = await runPool(lines, imageConcurrency(), async ({ b, voice, instructions }) => {
      if (ctx.canSpend && !(await ctx.canSpend(0.01))) throw new BudgetError(`Cost cap reached before line ${b.n} could be spoken.`)
      const r = await m.media.speech({ name: `beat-${b.n}`, text: b.line!, voice, instructions })
      cost += r.costUsd
      speech[b.n] = speechInfoFrom(r.file, r.seconds, r.words)
    })
    if (spoken_.length) throw spoken_[0].error

    // 2. one video job per shot: its keyframe, its motion, the line to lip-sync (a character's own line only), and who must stay on-model
    const spoken = new Set<number>()
    const jobs: ShotJob[] = shots.shots.map((s) => {
      const key = m.state.keyframes[s.n]
      if (!key) throw new Error(`Shot ${s.n} has no keyframe`)
      const beat = script.beats.find((b) => b.n === s.beat)
      const sp = beat && speech[beat.n] && !spoken.has(beat.n) ? speech[beat.n] : null
      if (sp && beat) spoken.add(beat.n)
      const cast = m.state.shotCast[s.n] ?? []
      const characterSpeaks = !!(sp && beat?.speaker && beat.speaker !== NARRATOR && cast.some((c) => c.name === beat.speaker))
      const need = Math.max(s.durationSec, sp ? voiceNeedSec(sp.seconds) : 0)
      return {
        n: s.n, durationSec: need, videoSeconds: Math.max(s.videoSeconds, clipSeconds(ctx.video.model, need)), motionPrompt: [s.motionPrompt, ctx.profile.style.motion].filter(Boolean).join(' '),
        keyframe: abs(m, key), speech: characterSpeaks && sp ? { file: abs(m, sp.file) } : null, cast,
      }
    })

    // 3. the clips: made, lip-synced, checked for drift, retried once. Anything that cannot be made stops the episode.
    const make = m.makeClipFn ?? makeClip
    const noCharacters: ClipCheck = { verdict: { ok: true, worst: null, issues: [], undeclared: [] }, result: { characters: [], undeclaredCharacters: [], costUsd: 0 }, costUsd: 0 }
    const r = await produceVideoShots({
      model: ctx.video.model, shots: jobs, workDir: m.ws.clipsDir, allowanceSec: ctx.video.allowanceSec, canSpend: ctx.canSpend, negative: ctx.profile.style.negative,
      make: tokenOptimization() ? withClipCache(m.ws.libraryDir, make) : make, lipsync: m.lipsyncFn ?? makeLipsync, reuseExisting: m.reuseClips,
      check: (clip, job, attempt, clipSec) => (job.cast.length
        ? checkClipContinuity(m.media, { clip, workDir: m.ws.clipsDir, label: `shot-${job.n}-a${attempt}`, cast: job.cast, usedSeconds: job.durationSec, clipSeconds: clipSec })
        : Promise.resolve(noCharacters)),
      onApproved: async (clip, job) => { for (const c of job.cast.filter((x) => x.main)) await saveApprovedFrame(m.ws.libraryDir, c.name, clip, job.durationSec / 2) },
    })
    cost += r.totalCostUsd + r.checkCostUsd
    const clips: Record<number, { file: string; seconds: number }> = {}
    for (const [n, file] of Object.entries(r.files)) {
      const name = `clip-${n}.mp4`
      fs.copyFileSync(file, path.join(assetsDir, name))
      clips[Number(n)] = { file: name, seconds: (await probe(file)).durationSec }
    }

    // 4. background music in a mood that suits the niche; louder when nobody speaks, and ducked under speech by the mixer
    const mood = script.vibe ? VIBES[script.vibe].music : moodFor(ctx.profile.niche, ctx.profile.subNiche)
    const music = { src: ensureMusic(mood, assetsDir), volume: voices.length ? 0.16 : 0.3 }

    // 5. the timeline
    const built = buildTimeline({ fps: m.fps, width: m.width, height: m.height, script, shots: shots.shots, speech, clips, sfx, music, look: ctx.profile.style.look, transitions: ctx.profile.style.transitions, targetSec: REEL_MAX_SEC })
    m.state.timeline = built.timeline
    fs.writeFileSync(path.join(m.ws.episodeDir, 'timeline.json'), JSON.stringify(built.timeline, null, 2))
    notes.push(...built.notes)

    const timeline: PipelineTimeline = {
      durationSec: Math.round(built.durationSec),
      shots: built.timeline.shots.map((s, i) => ({
        n: shots.shots[i]?.n ?? i + 1, type: shots.shots[i]?.type ?? 'info', camera: s.transitionIn,
        motion: r.clips.find((c) => c.shot === shots.shots[i]?.n)?.lipsync ? `video + lip-sync (${ctx.video.model})` : `video (${ctx.video.model})`,
        durationSec: s.durationSec, videoSeconds: clips[shots.shots[i]?.n]?.seconds ?? 0,
      })),
      audio: { voices, music: `${mood} loop (generated)`, sfx: [...new Set(built.timeline.sfx.map((x) => x.src))] },
      videoClips: r.clips, mock: false,
    }
    const lip = r.clips.filter((c) => c.lipsync).length
    const summary = `${timeline.durationSec}s timeline · ${voices.length} voiced lines · ${Object.keys(clips).length}/${jobs.length} clips${lip ? ` · ${lip} lip-synced` : ''}${notes.length ? ` · ${notes.slice(0, 2).join('; ')}` : ''}`
    return { output: timeline, summary, usage: usageOf(`speech:${m.media.provider}+video:${ctx.video.provider}`, round(cost), r.totalSeconds) }
  } catch (e) {
    // paid clips of a failed run are already on the error (see video-shots); add the speech made before it
    throw withSpend(e as Error, round(cost))
  }
}

// ---------- Editor-QA: assemble, loudness, checks ----------
export async function editorQaMedia(ctx: Ctx, m: MediaCtx, timeline: PipelineTimeline): Promise<AgentResult<QaReport>> {
  const tl = m.state.timeline
  if (!tl) throw new Error('There is no timeline to assemble')
  const out = path.join(m.ws.outDir, 'master.mp4')
  const assemble = m.renderFn ?? assembleTimeline
  await assemble({ timeline: tl, assetsDir: m.ws.assetsDir, outFile: out, workDir: path.join(m.ws.outDir, 'work') })
  const loud = await normalizeLoudness(out)
  const secs = await videoSeconds(out)
  const expected = tl.shots.reduce((n, s) => n + s.durationSec, 0)
  const spoken = timeline.audio.voices.length
  // only a character's own line needs a speaking mouth; a narrator talks over the pictures
  const characterLines = timeline.audio.voices.filter((v) => v.speaker !== NARRATOR).length
  const lipsynced = timeline.videoClips.filter((c) => c.lipsync).length
  const drifted = timeline.videoClips.filter((c) => c.continuity && !c.continuity.ok)
  const checks = [
    { name: 'Render', ok: fs.existsSync(out) && fs.statSync(out).size > 1000, note: `${secs.toFixed(1)}s master` },
    { name: 'Length matches the timeline', ok: Math.abs(secs - expected) < 0.3, note: `${secs.toFixed(2)}s vs ${expected.toFixed(2)}s` },
    { name: 'Length fits a reel', ok: secs >= REEL_MIN_SEC - 0.5 && secs <= REEL_MAX_SEC + 1, note: `${secs.toFixed(1)}s for a ${REEL_MIN_SEC} to ${REEL_MAX_SEC} s reel` },
    { name: 'Loudness', ok: Math.abs(loud.after.integrated + 14) <= 1.5 && loud.after.truePeak <= -0.9, note: `${loud.after.integrated.toFixed(1)} LUFS · peak ${loud.after.truePeak.toFixed(1)} dB` },
    { name: 'Voices', ok: tl.voices.length === spoken, note: `${tl.voices.length} of ${spoken} lines placed` },
    { name: 'Captions', ok: tl.captions.length >= tl.voices.length, note: `${tl.captions.length} captions` },
    { name: 'Characters on-model', ok: drifted.length === 0, note: drifted.length ? `${drifted.length} clip(s) drifted` : `${timeline.videoClips.filter((c) => c.continuity?.ok).length} clips checked` },
    { name: 'Lip-sync', ok: !characterLines || lipsynced >= Math.min(characterLines, 1), note: characterLines ? `${lipsynced} lip-synced clip(s)` : 'not needed (narrator only)' },
  ]
  m.state.master = path.relative(m.ws.episodeDir, out)
  const passed = checks.every((c) => c.ok)

  // A vision look at one frame per shot of the finished reel. It only FLAGS what a person should look at; nothing is ever re-made
  // automatically (that costs money): the dashboard offers "Fix shot" instead. A failed check never fails the episode.
  let flags: ReelQaFlag[] = []
  let qaUsd = 0
  let qaNote = 'no problems seen'
  try {
    const starts = shotStarts(tl)
    const sheet = await makeSheetAt(out, path.join(m.ws.outDir, 'reel-sheet.jpg'), tl.shots.map((s, i) => starts[i] + s.durationSec / 2), 320)
    const r = await m.media.reelQa({ sheetFile: sheet, shots: tl.shots.map((s) => Number(s.id.replace(/^shot-/, ''))) })
    flags = r.flags
    qaUsd = r.costUsd
    if (flags.length) qaNote = `${flags.length} shot(s) to look at`
  } catch (e) {
    qaNote = `skipped (${(e as Error).message.slice(0, 80)})`
  }
  checks.push({ name: 'Reel check', ok: true, note: qaNote })
  return {
    output: { passed, checks, mock: false, flags }, summary: passed ? `Assembled ${secs.toFixed(1)}s · ${loud.after.integrated.toFixed(1)} LUFS${flags.length ? ` · ${flags.length} shot(s) flagged` : ''}` : `Checks failed: ${checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`,
    ...(qaUsd > 0 ? { usage: usageOf(MODELS.reelQa, round(qaUsd)) } : {}),
  }
}
