import fs from 'node:fs'
import { probe, run } from '../engine/ffmpeg'

/**
 * The lip-sync model returns a clip that is only as long as the spoken line (`cut_off`): a 1.8 s line turns a 5 s clip into a
 * 1.8 s one. The shot needs its full length, so the rest of the ORIGINAL clip is appended from the moment the lip-synced part ends.
 * Both were made from the same keyframe and are in step, so the join is seamless: only the mouth differs, and after the line it is
 * at rest. Free, and no second call to a paid service. Returns `lipFile` itself when there is nothing to add, or when either file
 * cannot be read (the caller then keeps what it has).
 */
export async function keepFullLength(lipFile: string, originalFile: string, destFile: string): Promise<string> {
  let lip: Awaited<ReturnType<typeof probe>>, orig: Awaited<ReturnType<typeof probe>>
  try { [lip, orig] = await Promise.all([probe(lipFile), probe(originalFile)]) } catch { return lipFile }
  if (!lip.hasVideo || !orig.hasVideo || lip.videoSec >= orig.videoSec - 0.1) return lipFile
  const fps = lip.fps || orig.fps || 24
  const { width: w, height: h } = lip
  const same = `fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,format=yuv420p`
  const filter = `[0:v]${same}[a];[1:v]trim=start=${lip.videoSec.toFixed(3)},setpts=PTS-STARTPTS,${same}[b];[a][b]concat=n=2:v=1:a=0,fps=${fps}[v]`
  await run(['-y', '-v', 'error', '-i', lipFile, '-i', originalFile, '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destFile])
  return destFile
}

/**
 * A file an earlier attempt of THIS episode already made (and paid for) is reused when it is readable and no newer than nothing it
 * depends on: a clip must be newer than its keyframe, a lip-synced clip newer than its clip and its line. Anything older was made
 * from an earlier version of its inputs and is made again.
 */
export async function reusableFile(file: string, dependsOn: string[]): Promise<boolean> {
  try {
    const made = fs.statSync(file).mtimeMs
    if (dependsOn.some((f) => fs.statSync(f).mtimeMs > made)) return false
    const p = await probe(file)
    return p.hasVideo && p.durationSec >= 0.5
  } catch { return false }
}
