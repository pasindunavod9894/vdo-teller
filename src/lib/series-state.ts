/** What each series action changes. 'paused' stops automatic generation (the Generate button still works). A removed series is only hidden (status 'removed'), so it can be restored from the undo toast. */
export const SERIES_ACTIONS = ['link-folder', 'unlink-folder', 'pause', 'resume', 'remove', 'restore'] as const
export type SeriesAction = (typeof SERIES_ACTIONS)[number]

export const isSeriesAction = (v: unknown): v is SeriesAction => typeof v === 'string' && (SERIES_ACTIONS as readonly string[]).includes(v)

export function seriesPatch(action: SeriesAction): { folderLinked?: boolean; status?: 'active' | 'paused' | 'removed' } {
  switch (action) {
    case 'link-folder': return { folderLinked: true }
    case 'unlink-folder': return { folderLinked: false }
    case 'pause': return { status: 'paused' }
    case 'resume': return { status: 'active' }
    case 'remove': return { status: 'removed' }
    case 'restore': return { status: 'active' }
  }
}
