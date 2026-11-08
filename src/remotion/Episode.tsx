import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { framesOf, shotStarts, type Timeline } from '../engine/timeline'
import { Grade, Grain, Vignette } from './Effects'
import { ShotView } from './ShotView'

const Captions: React.FC<{ captions: Timeline['captions']; position: Timeline['look']['captionPosition'] }> = ({ captions, position }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const t = frame / fps
  const c = captions.find((x) => t >= x.startSec && t <= x.endSec)
  if (!c) return null
  const words = c.text.split(/\s+/).filter(Boolean)
  const progress = (t - c.startSec) / Math.max(0.1, c.endSec - c.startSec)
  const active = Math.min(words.length - 1, Math.floor(progress * words.length))
  const s = spring({ frame: Math.round((t - c.startSec) * fps), fps, config: { damping: 14, stiffness: 170 } })
  return (
    <AbsoluteFill style={{ justifyContent: position === 'bottom' ? 'flex-end' : position === 'middle' ? 'center' : 'flex-start', alignItems: 'center', paddingBottom: position === 'bottom' ? height * 0.14 : 0, paddingTop: position === 'top' ? height * 0.11 : 0, pointerEvents: 'none' }}>
      <div style={{ width: '86%', textAlign: 'center', transform: `scale(${0.9 + 0.1 * s})`, opacity: Math.min(1, s * 1.5), lineHeight: 1.18 }}>
        {words.map((w, i) => (
          <span key={i} style={{ fontFamily: "'Arial Rounded MT Bold','Helvetica Neue',Arial,sans-serif", fontWeight: 900, fontSize: height * 0.042, margin: '0 0.14em', display: 'inline-block', color: i === active ? '#ffe14d' : '#ffffff', WebkitTextStroke: `${height * 0.0055}px #141414`, paintOrder: 'stroke fill', transform: i === active ? 'scale(1.08)' : 'none' }}>{w}</span>
        ))}
      </div>
    </AbsoluteFill>
  )
}

export const Episode: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const { fps, durationInFrames } = useVideoConfig()
  const starts = shotStarts(timeline)

  // Music is ducked under speech and faded out at the end.
  const musicVolume = (f: number) => {
    if (!timeline.music) return 0
    const t = f / fps
    const speaking = timeline.captions.some((c) => t >= c.startSec - 0.1 && t <= c.endSec + 0.2)
    const duck = speaking ? 0.35 : 1
    const fade = interpolate(f, [durationInFrames - fps * 1.2, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' })
    return timeline.music.volume * duck * fade
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Grade grade={timeline.look.grade}>
        {timeline.shots.map((shot, i) => {
          const frames = framesOf(shot.durationSec, fps)
          return (
            <Sequence key={shot.id} from={Math.round(starts[i] * fps)} durationInFrames={frames}>
              <ShotView shot={shot} frames={frames} />
            </Sequence>
          )
        })}
      </Grade>
      <Captions captions={timeline.captions} position={timeline.look.captionPosition} />
      <Vignette amount={timeline.look.vignette} />
      <Grain amount={timeline.look.grain} />
      {timeline.voices.map((v, i) => (
        <Sequence key={`v${i}`} from={Math.round(v.startSec * fps)}><Audio src={staticFile(v.src)} volume={v.volume} /></Sequence>
      ))}
      {timeline.sfx.map((v, i) => (
        <Sequence key={`s${i}`} from={Math.round(v.startSec * fps)}><Audio src={staticFile(v.src)} volume={v.volume} /></Sequence>
      ))}
      {timeline.music && <Audio src={staticFile(timeline.music.src)} loop volume={musicVolume} />}
    </AbsoluteFill>
  )
}
