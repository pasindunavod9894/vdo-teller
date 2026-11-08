import React from 'react'
import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion'
import { frameAt, type CharacterLayer, type Shot } from '../engine/timeline'
import { clamp01, cycleFrame, energyAt, hopOffset, lerp, squashStretch } from '../engine/motion'
import { Particles } from './Effects'

const easeInOut = Easing.inOut(Easing.cubic)

/** Camera: returns a transform for the background and a (stronger) one for the foreground, which gives parallax depth. */
function useCamera(shot: Shot, frames: number) {
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  const { move, intensity, handheld } = shot.camera
  const p = easeInOut(Math.min(1, frame / Math.max(1, frames - 1)))
  let bgScale = 1, fgScale = 1, bgX = 0, fgX = 0
  if (move === 'push-in') { bgScale = 1 + 0.14 * intensity * p; fgScale = 1 + 0.26 * intensity * p }
  if (move === 'pull-out') { bgScale = 1 + 0.14 * intensity * (1 - p); fgScale = 1 + 0.26 * intensity * (1 - p) }
  if (move === 'pan-left') { bgScale = 1.08; fgScale = 1.08; bgX = -width * 0.035 * intensity * p; fgX = -width * 0.07 * intensity * p }
  if (move === 'pan-right') { bgScale = 1.08; fgScale = 1.08; bgX = width * 0.035 * intensity * p; fgX = width * 0.07 * intensity * p }
  // handheld: slow layered sine "noise" (deterministic); shake: fast and decaying
  const hh = handheld * 0.006 * width
  let dx = Math.sin(frame * 0.11) * hh + Math.sin(frame * 0.047 + 1.3) * hh * 0.7
  let dy = Math.cos(frame * 0.09) * hh * 0.8 + Math.sin(frame * 0.061 + 0.4) * hh * 0.6
  if (move === 'shake') {
    const decay = Math.exp(-frame / (frames * 0.5))
    const amp = 0.018 * width * intensity * decay
    dx += Math.sin(frame * 2.3) * amp; dy += Math.cos(frame * 2.9) * amp
    bgScale = 1.06; fgScale = 1.06
  }
  return { bg: `translate(${bgX + dx}px, ${dy}px) scale(${bgScale})`, fg: `translate(${fgX + dx * 1.4}px, ${dy * 1.4}px) scale(${fgScale})` }
}

const CharacterView: React.FC<{ layer: CharacterLayer }> = ({ layer }) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const t = frame / fps

  // which image: a walk cycle if active, otherwise the timed frame list
  const cyc = layer.cycle
  const cycleSrc = cyc ? cycleFrame(cyc.frames, cyc.hz, cyc.fromSec, cyc.toSec, t) : null
  const cycling = cycleSrc !== null
  const src = cycleSrc ?? frameAt(layer.frames, t)

  // position: static, or travelling along a path (with an optional hop)
  let x = layer.x, y = layer.y, pathScale = 1, sq = { sx: 1, sy: 1 }
  const pa = layer.path
  if (pa) {
    const raw = clamp01((t - pa.startSec) / Math.max(0.01, pa.endSec - pa.startSec))
    const e = pa.ease === 'inOut' ? easeInOut(raw) : raw
    x = lerp(pa.from.x, pa.to.x, e)
    y = lerp(pa.from.y, pa.to.y, e) - hopOffset(pa.arc, raw)
    pathScale = lerp(1, pa.scaleTo, e)
    if (pa.arc > 0 && raw > 0 && raw < 1) sq = squashStretch(raw)
  }

  // enter animation
  const since = Math.max(0, t - layer.enterAtSec)
  let opacity = 1, tx = 0, enterScale = 1
  if (layer.enter !== 'none') {
    if (t < layer.enterAtSec) opacity = 0
    const s = spring({ frame: Math.round(since * fps), fps, config: { damping: 14, stiffness: 110 } })
    if (layer.enter === 'pop') { enterScale = 0.6 + 0.4 * s; opacity = Math.min(opacity, s) }
    else { tx = (1 - s) * (layer.enter === 'slide-left' ? -0.4 : 0.4) * width; opacity = Math.min(opacity, Math.min(1, s * 2)) }
  }

  // idle life
  let breathe = layer.motion === 'breathe' ? 1 + 0.012 * Math.sin((2 * Math.PI * t) / 3.2) : 1
  let bob = layer.motion === 'bob' ? -Math.abs(Math.sin(2 * Math.PI * t * 1.6)) * 0.014 * height : 0
  let rot = 0

  // walk: bounce on every step and lean into the stride
  if (cycling && cyc) {
    const ph = (t - cyc.fromSec) * cyc.hz
    bob = -Math.abs(Math.sin(Math.PI * ph)) * cyc.bounce * height
    rot = Math.sin(Math.PI * ph) * cyc.lean * (layer.flip ? -1 : 1) * 0.5
    breathe = 1
  }

  // speech-driven head motion: nod and pulse on loud syllables, slow sway between them
  let talkScale = 1
  if (layer.talk) {
    const e = energyAt(layer.talk.energy, layer.talk.startSec, t, fps)
    const a = layer.talk.amount
    talkScale = 1 + 0.03 * e * a
    bob += -e * 0.007 * height * a
    rot += (Math.sin(t * 2.6) * 0.9 + Math.sin(t * 1.1 + 1) * 0.7 + (e - 0.4) * 1.2) * a
  }

  // shiver
  let sx = 0
  if (layer.shiver && t >= layer.shiver.fromSec && t < layer.shiver.toSec) {
    const a = layer.shiver.amount
    sx = Math.sin(t * 58) * 0.004 * width * a
    rot += Math.sin(t * 47) * 0.9 * a
  }

  // blink overlay
  const blinking = !!layer.blinks && layer.blinks.times.some((b) => t >= b && t < b + layer.blinks!.holdSec)

  const w = layer.width * width * pathScale
  const flipX = layer.flip ? -1 : 1
  return (
    <div style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, width: w, transform: `translate(calc(-50% + ${tx + sx}px), calc(-100% + ${bob}px)) rotate(${rot}deg) scale(${enterScale * talkScale})`, transformOrigin: '50% 100%', opacity }}>
      {/* contact shadow so the cut-out sits on the scene */}
      <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: -w * 0.03, height: w * 0.09, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,0,0.45), rgba(0,0,0,0) 70%)', filter: 'blur(6px)' }} />
      <div style={{ position: 'relative', transform: `scaleX(${flipX * sq.sx}) scaleY(${breathe * sq.sy})`, transformOrigin: '50% 100%' }}>
        <Img src={staticFile(src)} style={{ width: '100%', display: 'block', filter: 'drop-shadow(0 10px 14px rgba(0,0,0,0.28))' }} />
        {blinking && layer.blinks && <Img src={staticFile(layer.blinks.src)} style={{ position: 'absolute', inset: 0, width: '100%', display: 'block' }} />}
      </div>
    </div>
  )
}

const TextView: React.FC<{ text: string; atSec: number; durationSec: number; position: 'top' | 'center' | 'bottom' }> = ({ text, atSec, durationSec, position }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const t = frame / fps
  if (t < atSec || t > atSec + durationSec) return null
  const s = spring({ frame: Math.round((t - atSec) * fps), fps, config: { damping: 12, stiffness: 160 } })
  const out = interpolate(t, [atSec + durationSec - 0.2, atSec + durationSec], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const top = position === 'top' ? height * 0.1 : position === 'center' ? height * 0.42 : height * 0.68
  return (
    <div style={{ position: 'absolute', left: '6%', right: '6%', top, textAlign: 'center', transform: `scale(${0.7 + 0.3 * s})`, opacity: Math.min(1, s) * out }}>
      <span style={{ fontFamily: "'Arial Rounded MT Bold','Helvetica Neue',Arial,sans-serif", fontWeight: 900, fontSize: height * 0.05, color: '#fff', WebkitTextStroke: `${height * 0.006}px #1b1b1b`, paintOrder: 'stroke fill', textShadow: '0 6px 0 rgba(0,0,0,0.25)', lineHeight: 1.1 }}>{text}</span>
    </div>
  )
}

export const ShotView: React.FC<{ shot: Shot; frames: number }> = ({ shot, frames }) => {
  const frame = useCurrentFrame()
  const { width, fps } = useVideoConfig()
  const cam = useCamera(shot, frames)

  // transition into the shot
  let wrapStyle: React.CSSProperties = {}
  if (shot.transitionIn === 'fade') wrapStyle = { opacity: interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' }) }
  if (shot.transitionIn === 'whip') {
    const k = interpolate(frame, [0, 7], [1, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    wrapStyle = { transform: `translateX(${k * width * 0.6}px)`, filter: `blur(${k * 14}px)` }
  }

  const characters = shot.layers.filter((l): l is CharacterLayer => l.kind === 'character')
  return (
    <AbsoluteFill style={{ overflow: 'hidden', ...wrapStyle }}>
      <AbsoluteFill style={{ transform: cam.bg, transformOrigin: '50% 50%' }}>
        {shot.video ? (
          // real-motion clip from the video model (silent; our own voice/music/sfx are mixed separately)
          <OffthreadVideo
            src={staticFile(shot.video.src)} muted playbackRate={shot.video.playbackRate}
            startFrom={Math.round(shot.video.startFromSec * fps)} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Img src={staticFile(shot.background)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </AbsoluteFill>
      {shot.layers.filter((l) => l.kind === 'particles').map((l, i) => l.kind === 'particles' && <Particles key={`p${i}`} preset={l.preset} count={l.count} />)}
      <AbsoluteFill style={{ transform: cam.fg, transformOrigin: '50% 80%' }}>
        {characters.map((c) => <CharacterView key={c.id} layer={c} />)}
      </AbsoluteFill>
      {shot.layers.map((l, i) => l.kind === 'text' && <TextView key={`t${i}`} text={l.text} atSec={l.atSec} durationSec={l.durationSec} position={l.position} />)}
    </AbsoluteFill>
  )
}
