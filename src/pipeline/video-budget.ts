import type { Series } from '@/payload-types'
import { DEFAULT_VIDEO_MODEL, episodeVideoAllowance, isVideoModel } from '@/lib/video'
import { videoProvider } from '@/providers/video'
import { DEFAULT_SERIES_CAP_USD } from './budget'
import type { Ctx } from './agents'

/**
 * This episode's real-video budget: what the money left under the cost cap can pay for and, if the series has one, its own
 * video-second limit (plan §12). Every shot is video, so this is a limit that stops the episode, not a tier share.
 * Pure apart from reading which provider is configured.
 */
export function videoBudgetFor(series: Pick<Series, 'videoModel' | 'costCapUsd' | 'spentUsd' | 'videoBudgetSec' | 'videoSpentSec'>): Ctx['video'] {
  const model = isVideoModel(series.videoModel) ? series.videoModel : DEFAULT_VIDEO_MODEL
  let allowanceSec = episodeVideoAllowance({ model, capUsd: series.costCapUsd ?? DEFAULT_SERIES_CAP_USD, spentUsd: series.spentUsd ?? 0 })
  if (typeof series.videoBudgetSec === 'number') {
    const remaining = Math.max(0, series.videoBudgetSec - (series.videoSpentSec ?? 0))
    allowanceSec = Math.min(allowanceSec, Math.floor(remaining / 5) * 5)
  }
  return { model, allowanceSec, provider: videoProvider() }
}
