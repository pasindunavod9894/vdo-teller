import { run } from '../engine/ffmpeg'
import { hashOf } from './workspace'

/** A deterministic `0xRRGGBB` colour from a key, so the same name always gets the same placeholder colour. */
export function colourFor(key: string, lightness = 0.55): string {
  const hue = (parseInt(hashOf(key).slice(0, 6), 16) % 360) / 360
  const s = 0.5, l = lightness
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `0x${hex(f(hue + 1 / 3))}${hex(f(hue))}${hex(f(hue - 1 / 3))}`
}

/**
 * Writes a flat placeholder PNG with FFmpeg (no image library needed). `shape: 'scene'` draws a darker ground band,
 * `'character'` draws a simple head-and-body figure, `'face'` a head with two eyes whose look depends on `variant`.
 * Used only by the free mock mode, so the whole pipeline can run, and be tested, without spending anything.
 */
export async function placeholderPng(file: string, o: { width: number; height: number; colour: string; shape: 'scene' | 'character' | 'face'; variant?: number }): Promise<void> {
  const { width: W, height: H, colour } = o
  const boxes: string[] = []
  if (o.shape === 'scene') boxes.push(`drawbox=x=0:y=${Math.round(H * 0.68)}:w=${W}:h=${H}:color=black@0.25:t=fill`)
  if (o.shape === 'character') {
    boxes.push(`drawbox=x=${Math.round(W * 0.3)}:y=${Math.round(H * 0.42)}:w=${Math.round(W * 0.4)}:h=${Math.round(H * 0.45)}:color=0xf0e0c0:t=fill`)
    boxes.push(`drawbox=x=${Math.round(W * 0.34)}:y=${Math.round(H * 0.2)}:w=${Math.round(W * 0.32)}:h=${Math.round(H * 0.24)}:color=${colour}:t=fill`)
  }
  if (o.shape === 'face') {
    const eye = (o.variant ?? 0) % 2 === 0 ? 0.07 : 0.03
    for (const x of [0.32, 0.6]) boxes.push(`drawbox=x=${Math.round(W * x)}:y=${Math.round(H * 0.4)}:w=${Math.round(W * 0.08)}:h=${Math.round(H * eye)}:color=black:t=fill`)
    boxes.push(`drawbox=x=${Math.round(W * 0.38)}:y=${Math.round(H * 0.68)}:w=${Math.round(W * 0.24)}:h=${Math.round(H * (0.02 + 0.02 * ((o.variant ?? 0) % 3)))}:color=0x5a1d1d:t=fill`)
  }
  const vf = ['format=rgb24', ...boxes].join(',')
  await run(['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=${W}x${H}:d=1`, '-vf', vf, '-frames:v', '1', file])
}
