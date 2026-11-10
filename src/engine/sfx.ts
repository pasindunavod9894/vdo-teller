import fs from 'node:fs'
import path from 'node:path'
import { run } from './ffmpeg'

/**
 * Sound effects made in code with FFmpeg (no downloads, no licences). They are simple on purpose: they give cuts, steam and
 * impacts a sound, and can be replaced later by a licensed library with the same names.
 */
export type SfxName = 'whoosh' | 'steam-hiss' | 'pop' | 'thud'

type Recipe = { duration: number; graph: string }

const RECIPES: Record<SfxName, Recipe> = {
  // a quick swell of filtered noise: the sound of a whip-pan or a fast movement
  whoosh: { duration: 0.7, graph: 'anoisesrc=color=pink:duration=0.7:amplitude=0.6,highpass=f=200,lowpass=f=4200,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.4,volume=1.2' },
  // steady high-frequency noise: steam escaping a pot
  'steam-hiss': { duration: 3, graph: 'anoisesrc=color=white:duration=3:amplitude=0.3,highpass=f=3500,afade=t=in:d=0.5,afade=t=out:st=2:d=1,volume=0.8' },
  // a short low-to-mid blip: a cartoon pop
  pop: { duration: 0.18, graph: 'sine=frequency=380:duration=0.18,afade=t=out:st=0:d=0.18,volume=0.9' },
  // a low impact
  thud: { duration: 0.35, graph: 'sine=frequency=70:duration=0.35,lowpass=f=200,afade=t=out:st=0:d=0.35,volume=1.6' },
}

export const SFX_NAMES = Object.keys(RECIPES) as SfxName[]
export const sfxDuration = (name: SfxName) => RECIPES[name].duration

/** Writes `<dir>/sfx-<name>.wav` (48 kHz mono) unless it already exists, and returns the file name. */
export async function ensureSfx(name: SfxName, dir: string): Promise<string> {
  const file = `sfx-${name}.wav`
  const dest = path.join(dir, file)
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dir, { recursive: true })
    await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', RECIPES[name].graph, '-ar', '48000', '-ac', '1', dest])
  }
  return file
}
