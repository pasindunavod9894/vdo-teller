/** What each series action changes. A removed series is only hidden (status 'removed'), so it can be restored from the undo toast. */
export const SERIES_ACTIONS = ['link-folder', 'unlink-folder', 'remove', 'restore'] as const
export type SeriesAction = (typeof SERIES_ACTIONS)[number]

export const isSeriesAction = (v: unknown): v is SeriesAction => typeof v === 'string' && (SERIES_ACTIONS as readonly string[]).includes(v)

export function seriesPatch(action: SeriesAction): { folderLinked?: boolean; status?: 'active' | 'removed' } {
  switch (action) {
    case 'link-folder': return { folderLinked: true, status: 'active' }
    case 'unlink-folder': return { folderLinked: false }
    case 'remove': return { status: 'removed' }
    case 'restore': return { status: 'active' }
  }
}
