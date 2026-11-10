/** What each series action changes. 'paused' stops automatic generation (the Generate button still works). A removed series is only hidden (status 'removed'), so it can be restored from the undo toast. */
export const SERIES_ACTIONS = ['link-folder', 'unlink-folder', 'pause', 'resume', 'remove', 'restore', 'review-on', 'review-off'] as const
export type SeriesAction = (typeof SERIES_ACTIONS)[number]

export const isSeriesAction = (v: unknown): v is SeriesAction => typeof v === 'string' && (SERIES_ACTIONS as readonly string[]).includes(v)

/** 'review-on' / 'review-off' switch "Review before video": the video pauses after the script and keyframes, before any clip is paid for. */
export function seriesPatch(action: SeriesAction): { folderLinked?: boolean; status?: 'active' | 'paused' | 'removed'; reviewBeforeVideo?: boolean } {
  switch (action) {
    case 'link-folder': return { folderLinked: true }
    case 'unlink-folder': return { folderLinked: false }
    case 'pause': return { status: 'paused' }
    case 'resume': return { status: 'active' }
    case 'remove': return { status: 'removed' }
    case 'restore': return { status: 'active' }
    case 'review-on': return { reviewBeforeVideo: true }
    case 'review-off': return { reviewBeforeVideo: false }
  }
}

/** The reason saved on a video that was dropped because the user asked for a different idea at the review. The dashboard does not list such videos (nothing was made, and they do not count as one of the day's videos). */
export const DROPPED_IDEA_ERROR = 'You asked for a different idea before any video was made.'
