import React from 'react'
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Timeline } from '../engine/timeline'

// "Real feel" finish (plan §1b): colour grade, vignette, film grain.

const GRADES: Record<Timeline['look']['grade'], string> = {
  neutral: 'none',
  warm: 'sepia(0.16) saturate(1.15) contrast(1.05) hue-rotate(-8deg)',
  cool: 'saturate(1.05) hue-rotate(10deg) contrast(1.05) brightness(0.98)',
  vivid: 'saturate(1.3) contrast(1.08)',
  noir: 'grayscale(0.9) contrast(1.2) brightness(0.95)',
}

export const Grade: React.FC<{ grade: Timeline['look']['grade']; children: React.ReactNode }> = ({ grade, children }) => (
  <AbsoluteFill style={{ filter: GRADES[grade] }}>{children}</AbsoluteFill>
)

export const Vignette: React.FC<{ amount: number }> = ({ amount }) => (
  <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${0.55 * amount}) 100%)` }} />
)

/** Animated film grain: SVG turbulence with a new seed every frame, blended as an overlay. */
export const Grain: React.FC<{ amount: number }> = ({ amount }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  if (amount <= 0) return null
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.4 * amount }}>
      <svg width={width} height={height} xmlns="http://www.w3.org/2000/svg">
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={frame % 24} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  )
}

/** Drifting particles (dust, sparkles, steam). Deterministic: the same frame always renders the same picture. */
export const Particles: React.FC<{ preset: 'dust' | 'sparkles' | 'steam'; count: number }> = ({ preset, count }) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const t = frame / fps
  const look = {
    dust: { color: 'rgba(255,245,220,0.8)', size: [3, 8], speed: 0.05, blur: 1, dir: -1 },
    sparkles: { color: 'rgba(255,240,150,0.95)', size: [6, 16], speed: 0.09, blur: 0, dir: -1 },
    steam: { color: 'rgba(255,255,255,0.35)', size: [40, 110], speed: 0.12, blur: 14, dir: -1 },
  }[preset]
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const x0 = random(`x${i}`), y0 = random(`y${i}`), s = random(`s${i}`), ph = random(`p${i}`)
        const life = (t * look.speed * (0.6 + s) + ph) % 1
        const size = look.size[0] + s * (look.size[1] - look.size[0])
        const x = (x0 + Math.sin(t * (0.6 + s) + i) * 0.03) * width
        const y = (y0 + life * look.dir * 0.35) * height
        const alpha = Math.sin(life * Math.PI)
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: '50%', background: look.color, opacity: alpha, filter: look.blur ? `blur(${look.blur}px)` : undefined, boxShadow: preset === 'sparkles' ? '0 0 12px rgba(255,230,120,0.9)' : undefined }} />
      })}
    </AbsoluteFill>
  )
}
