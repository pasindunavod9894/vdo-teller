import type { Series } from '@/payload-types'
import { DEFAULT_VIDEO_MODEL, episodeVideoAllowance, isVideoModel } from '@/lib/video'
import { videoProvider } from '@/providers/video'
import type { Ctx } from './agents'

/**
 * This episode's real-video budget: the tier's allowance, limited by the money left under the cost cap and, if the series
 * has one, by its own video-second limit (plan §12). Pure apart from reading which provider is configured.
 */
export function videoBudgetFor(series: Pick<Series, 'videoModel' | 'qualityTier' | 'costCapUsd' | 'spentUsd' | 'videoBudgetSec' | 'videoSpentSec'>, episodeSec: number): Ctx['video'] {
  const model = isVideoModel(series.videoModel) ? series.videoModel : DEFAULT_VIDEO_MODEL
  let allowanceSec = episodeVideoAllowance({ tier: series.qualityTier, episodeSec, model, capUsd: series.costCapUsd ?? 5, spentUsd: series.spentUsd ?? 0 })
  if (typeof series.videoBudgetSec === 'number') {
    const remaining = Math.max(0, series.videoBudgetSec - (series.videoSpentSec ?? 0))
    allowanceSec = Math.min(allowanceSec, Math.floor(remaining / 5) * 5)
  }
  return { model, allowanceSec, provider: videoProvider() }
}
