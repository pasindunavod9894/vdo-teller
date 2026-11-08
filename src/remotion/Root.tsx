import React from 'react'
import { Composition } from 'remotion'
import { Episode } from './Episode'
import { framesOf, TimelineSchema, type Timeline } from '../engine/timeline'

// Placeholder props: real timelines are passed in as `inputProps` by the renderer.
const placeholder: Timeline = TimelineSchema.parse({ shots: [{ id: 'placeholder', durationSec: 1, background: 'placeholder.png' }] })

export const Root: React.FC = () => (
  <Composition
    id="Episode"
    component={Episode}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ timeline: placeholder }}
    calculateMetadata={({ props }) => {
      const t = props.timeline
      return { fps: t.fps, width: t.width, height: t.height, durationInFrames: t.shots.reduce((n, s) => n + framesOf(s.durationSec, t.fps), 0) }
    }}
  />
)
