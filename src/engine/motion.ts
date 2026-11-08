/** Pure motion math used by the renderer. Kept free of React/Remotion so it can be unit-tested. */

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Squash-and-stretch for a hop: stretches in the air, squashes at take-off and landing. p is 0..1 along the path. */
export function squashStretch(p: number) {
  const bump = (c: number) => Math.exp(-(((p - c) / 0.07) ** 2))
  const sy = 1 + 0.1 * Math.sin(Math.PI * p) - 0.14 * (bump(0) + bump(1))
  return { sy, sx: 1 / Math.pow(sy, 0.6) }
}

/** Parabolic hop offset (fraction of frame height, upwards positive): 0 at both ends, `arc` at the middle. */
export const hopOffset = (arc: number, p: number) => arc * 4 * p * (1 - p)

/** Which image of a walk cycle is shown at time t, or null outside the cycle. */
export function cycleFrame(frames: string[], hz: number, fromSec: number, toSec: number, t: number): string | null {
  if (t < fromSec || t >= toSec) return null
  return frames[Math.floor((t - fromSec) * hz) % frames.length]
}

/** Normalised speech loudness for frame i (0 outside the clip). */
export function energyAt(energy: number[], startSec: number, t: number, fps: number): number {
  const i = Math.floor((t - startSec) * fps)
  return i >= 0 && i < energy.length ? energy[i] : 0
}
