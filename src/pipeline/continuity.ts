import fs from 'node:fs'
import path from 'node:path'
import { probe, run } from '../engine/ffmpeg'
import type { ContinuityResult, MediaServices } from '../media/types'
import { safeName } from '../media/workspace'

/**
 * Character continuity (plan R1-E): after a clip is made, sample frames across it, put them on one contact sheet and let a
 * vision model compare them with the characters' reference images. A character that drifts inside the clip, or one that is not
 * in the cast, fails the clip. Main characters are held to a stricter score than supporting ones.
 */
export const MAIN_MIN_SCORE = 0.8
export const SUPPORTING_MIN_SCORE = 0.65
export const SHEET_FRAMES = 5

export type CastRef = { name: string; /** absolute path of the reference image */ reference: string; main: boolean }

export type Verdict = {
  ok: boolean
  /** the character that failed worst, if any */
  worst: { name: string; score: number; driftStartSec: number | null } | null
  issues: string[]
  undeclared: string[]
}

/** The time of the last frame worth sampling in a video (a little before its end); Infinity when it cannot be read. */
export async function lastFrameTime(clip: string): Promise<number> {
  try { return Math.max(0, (await probe(clip)).videoSec - 0.1) } catch { return Infinity }
}

/** A strip of `frames` frames taken evenly across the first `seconds` of a clip, as one JPEG. */
export async function makeContactSheet(clip: string, out: string, seconds: number, frames = SHEET_FRAMES, height = 512): Promise<string> {
  const last = Math.max(0, seconds - 0.08)
  return makeSheetAt(clip, out, Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : (last * i) / (frames - 1))), height)
}

/** A strip with one frame at each of the given times (seconds), left to right: for example one frame per shot of a finished reel. */
export async function makeSheetAt(clip: string, out: string, times: number[], height = 512): Promise<string> {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const frames = times.length
  // a clip can be shorter than the part of it the reel uses (a lip-synced one is cut to its line): never look past its last frame
  const end = await lastFrameTime(clip)
  const inputs = times.flatMap((t) => ['-ss', Math.min(t, end).toFixed(3), '-i', clip])
  const scaled = times.map((_, i) => `[${i}:v]scale=-2:${height},setsar=1[f${i}]`).join(';')
  const filter = frames === 1 ? `${scaled};[f0]null[sheet]` : `${scaled};${times.map((_, i) => `[f${i}]`).join('')}hstack=inputs=${frames}[sheet]`
  await run(['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-map', '[sheet]', '-frames:v', '1', '-q:v', '3', out])
  return out
}

/**
 * Pure: decides from the checker's answer. A character that only starts to change after `usedSeconds` (the part of the clip
 * the reel actually uses) is fine, whatever its score: the rest of the clip is cut off in assembly.
 */
export function judgeContinuity(result: ContinuityResult, cast: CastRef[], usedSeconds: number): Verdict {
  const issues: string[] = []
  let worst: Verdict['worst'] = null
  for (const c of result.characters) {
    const main = cast.find((x) => x.name === c.name)?.main ?? false
    const min = main ? MAIN_MIN_SCORE : SUPPORTING_MIN_SCORE
    const driftsLater = c.driftStartSec !== null && c.driftStartSec >= usedSeconds
    const drifted = c.driftStartSec !== null && c.driftStartSec < usedSeconds
    if (driftsLater) continue
    if (drifted || c.sameIdentity < min) {
      issues.push(`${c.name}${drifted ? ` changes after ${c.driftStartSec!.toFixed(1)}s` : ` looks different (${c.sameIdentity.toFixed(2)})`}${c.issues.length ? `: ${c.issues.join(', ')}` : ''}`)
      if (!worst || c.sameIdentity < worst.score) worst = { name: c.name, score: c.sameIdentity, driftStartSec: c.driftStartSec }
    }
  }
  if (result.undeclaredCharacters.length) issues.push(`unexpected character(s): ${result.undeclaredCharacters.join(', ')}`)
  return { ok: issues.length === 0, worst, issues, undeclared: result.undeclaredCharacters }
}

export type ClipCheck = { verdict: Verdict; result: ContinuityResult; costUsd: number }

/** Samples the clip, asks the vision model and judges the answer. */
export async function checkClipContinuity(media: MediaServices, o: { clip: string; workDir: string; label: string; cast: CastRef[]; usedSeconds: number; clipSeconds: number }): Promise<ClipCheck> {
  const sheet = await makeContactSheet(o.clip, path.join(o.workDir, `sheet-${safeName(o.label)}.jpg`), Math.min(o.clipSeconds, Math.max(o.usedSeconds, 1)))
  const result = await media.continuity({ sheetFile: sheet, characters: o.cast.map((c) => ({ name: c.name, reference: c.reference })), clipSeconds: Math.min(o.clipSeconds, Math.max(o.usedSeconds, 1)) })
  return { verdict: judgeContinuity(result, o.cast, o.usedSeconds), result, costUsd: result.costUsd }
}

// ---------- the approved-frames gallery: a series' own proof of how a character looks in finished reels ----------
export const GALLERY_MAX = 8

const galleryDir = (libraryDir: string, character: string) => path.join(libraryDir, 'gallery', safeName(character))

/** Keeps one frame of a clip that passed the check (up to GALLERY_MAX per character, oldest dropped first). */
export async function saveApprovedFrame(libraryDir: string, character: string, clip: string, atSec: number): Promise<string> {
  const dir = galleryDir(libraryDir, character)
  fs.mkdirSync(dir, { recursive: true })
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
  while (files.length >= GALLERY_MAX) fs.rmSync(path.join(dir, files.shift()!))
  const file = path.join(dir, `${Date.now()}.jpg`)
  await run(['-y', '-v', 'error', '-ss', Math.min(Math.max(0, atSec), await lastFrameTime(clip)).toFixed(3), '-i', clip, '-frames:v', '1', '-vf', 'scale=-2:768', '-q:v', '3', file])
  return file
}

/** The newest approved frames of a character, copied into `assetsDir` so a keyframe edit can use them as extra references. Returns file names. */
export function galleryReferences(libraryDir: string, character: string, assetsDir: string, count = 2): string[] {
  const dir = galleryDir(libraryDir, character)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().slice(-count).map((f, i) => {
    const name = `gallery-${safeName(character)}-${i}.jpg`
    fs.copyFileSync(path.join(dir, f), path.join(assetsDir, name))
    return name
  })
}
