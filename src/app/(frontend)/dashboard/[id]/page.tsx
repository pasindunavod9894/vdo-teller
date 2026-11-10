import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { CastPanel } from '@/components/dashboard/cast-panel'
import { DashHeader } from '@/components/dashboard/header'
import { Hero } from '@/components/dashboard/hero'
import { CostPanel } from '@/components/dashboard/cost-panel'
import { DEFAULT_SERIES_CAP_USD, episodeCeilingUsd } from '@/pipeline/budget'
import { REEL, REEL_TARGET_SEC } from '@/lib/format'
import { DROPPED_IDEA_ERROR } from '@/lib/series-state'
import { failedStepOf, retryLabel } from '@/pipeline/retry'
import { ReviewToggle } from '@/components/dashboard/review-toggle'
import { qaDataOf, reviewDataOf } from '@/components/dashboard/episode-props'
import { LibraryGrid } from '@/components/dashboard/library-grid'
import { ThemeBootstrap } from '@/components/dashboard/theme-bootstrap'
import { STYLE_CATALOGUE } from '@/lib/styles/catalogue'
import { IMAGE_COST, KEYFRAME_QUALITY } from '@/lib/art/plan'
import { heuristicTheme, isTheme, themeVars } from '@/themes/palettes'
import { getDailyState } from '@/pipeline/payload-store'
import type { VideoClip } from '@/pipeline/schemas'
import type { OnModel } from '@/components/dashboard/library-grid'

/** One line about the episode's continuity check: are the characters on-model in every checked clip? Null when nothing was checked. */
function onModelOf(videoClips: unknown): OnModel | null {
  const checked = (Array.isArray(videoClips) ? (videoClips as VideoClip[]) : []).filter((c) => c?.continuity)
  if (checked.length === 0) return null
  const bad = checked.filter((c) => !c.continuity!.ok)
  if (bad.length === 0) return { ok: true, issue: null, drifted: false }
  return { ok: false, issue: bad.find((c) => c.continuity!.issues?.length)?.continuity!.issues[0] ?? null, drifted: bad.some((c) => c.status === 'drifted') }
}

const VOICE_LABEL: Record<string, string> = {
  none: 'No voice',
  narrator: 'Narrator',
  character_voices: 'Character voices',
  narrator_and_characters: 'Narrator + characters',
}

export default async function Dashboard({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ start?: string }> }) {
  const { id } = await params
  const { start } = await searchParams
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) redirect('/login')

  const series = await payload.findByID({ collection: 'series', id, user, overrideAccess: false, depth: 1 }).catch(() => null)
  if (!series || series.status === 'removed') notFound()

  const [{ docs: all }, { docs: cast }, { docs: allEpisodes, totalDocs }, daily] = await Promise.all([
    payload.find({ collection: 'series', where: { status: { not_equals: 'removed' } }, sort: 'createdAt', user, overrideAccess: false, limit: 20, depth: 0 }),
    payload.find({ collection: 'characters', where: { series: { equals: series.id } }, user, overrideAccess: false, depth: 1 }),
    payload.find({ collection: 'episodes', where: { series: { equals: series.id } }, sort: '-createdAt', user, overrideAccess: false, limit: 12, depth: 0 }),
    getDailyState(payload, user.id),
  ])

  // a video the user dropped at the review ("Try another idea") is not listed: nothing was made and it does not count as a daily video
  const episodes = allEpisodes.filter((e) => !(e.status === 'failed' && e.error === DROPPED_IDEA_ERROR))
  const episodeCount = totalDocs - (allEpisodes.length - episodes.length)

  // for a failed video: the step it stopped in, so the card can offer to run it again from there
  const failedIds = episodes.filter((e) => e.status === 'failed').map((e) => e.id)
  const { docs: failedRows } = failedIds.length
    ? await payload.find({ collection: 'pipeline-steps', where: { and: [{ episode: { in: failedIds } }, { status: { equals: 'failed' } }] }, sort: 'order', limit: 60, depth: 0, user, overrideAccess: false })
    : { docs: [] }
  const failureOf = (e: (typeof episodes)[number]) => e.status === 'failed'
    ? { reason: e.error ?? '', label: retryLabel(failedStepOf(failedRows.filter((r) => (typeof r.episode === 'object' ? r.episode.id : r.episode) === e.id))) }
    : null

  // where the latest episode's money went
  const latest = episodes[0]
  const { docs: latestSteps } = latest
    ? await payload.find({ collection: 'pipeline-steps', where: { episode: { equals: latest.id } }, sort: 'order', limit: 20, depth: 0, user, overrideAccess: false })
    : { docs: [] }
  const ceiling = episodeCeilingUsd(REEL_TARGET_SEC, series.videoModel)

  const hasTheme = isTheme(series.theme)
  const theme = isTheme(series.theme) ? series.theme : heuristicTheme(`${series.niche} ${series.subNiche ?? ''}`, series.style)
  const styleName = STYLE_CATALOGUE.find((s) => s.id === series.style)?.name ?? series.style
  const heroUrl = typeof series.heroImage === 'object' && series.heroImage ? (series.heroImage.url ?? null) : null
  const spent = series.spentUsd ?? 0
  const cap = series.costCapUsd ?? DEFAULT_SERIES_CAP_USD

  const stats: [string, string][] = [
    ['Episodes', String(episodeCount)],
    ['Cast', String(cast.length)],
    ['Spent so far', `$${spent.toFixed(2)}`],
    ['Cost cap', `$${cap.toFixed(2)}`],
  ]

  return (
    <div data-series-theme style={themeVars(theme) as React.CSSProperties} className="min-h-screen bg-background text-foreground">
      <ThemeBootstrap seriesId={series.id} hasTheme={hasTheme} />
      <DashHeader series={all.map((s) => ({ id: s.id, title: s.title }))} currentId={series.id} username={user.username ?? ''} />
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-8">
        <Hero
          seriesId={series.id}
          title={series.title}
          tagline={theme.tagline}
          heroUrl={heroUrl}
          heroCost={IMAGE_COST[KEYFRAME_QUALITY]}
          chips={[series.niche, styleName, REEL.label, VOICE_LABEL[series.voiceMode] ?? series.voiceMode, series.aspect]}
        />

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label="Overview">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-[var(--radius)] border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="font-heading mt-1 text-2xl font-semibold">{v}</div>
            </div>
          ))}
        </section>

        <ReviewToggle seriesId={series.id} initial={Boolean(series.reviewBeforeVideo)} />

        <section aria-labelledby="library">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="library" className="text-2xl font-semibold">Video library</h2>
          </div>
          <LibraryGrid
            seriesId={series.id}
            title={series.title}
            daily={{ used: daily.used, limit: daily.limit, left: daily.left, nextAt: daily.nextAt ? daily.nextAt.toISOString() : null }}
            runningEpisodeId={episodes.find((e) => e.status === 'running')?.id ?? null}
            autoStart={start === '1'}
            episodes={episodes.map((e) => ({
              id: e.id,
              title: e.title ?? '',
              status: e.status,
              hasVideo: Boolean((e.files as { master?: string } | null)?.master),
              meta: (e.files as { publish?: unknown } | null)?.publish,
              exports: Object.fromEntries(Object.entries(((e.files as { exports?: Record<string, { status: string; error?: string }> } | null)?.exports) ?? {}).map(([k, v]) => [k, { status: v.status, error: v.error }])),
              onModel: onModelOf(e.videoClips),
              review: e.status === 'awaiting-approval' ? reviewDataOf(e, series.videoModel) : null,
              qa: (e.files as { master?: string } | null)?.master ? qaDataOf(e, series.videoModel) : null,
              hook: e.idea && typeof e.idea === 'object' ? ((e.idea as { hook?: string }).hook ?? null) : null,
              failure: failureOf(e),
            }))}
          />
          {episodeCount === 0 && <p className="mt-3 text-sm text-muted-foreground">Your videos will appear here and play in this library.</p>}
        </section>

        <section aria-labelledby="costs">
          <h2 id="costs" className="mb-4 text-2xl font-semibold">Costs</h2>
          <CostPanel
            title={latest?.title || 'Latest episode'} ceilingUsd={ceiling}
            steps={latestSteps.map((s) => ({ agent: s.label || s.agent, model: s.model, inputTokens: s.inputTokens, cachedTokens: s.cachedTokens, outputTokens: s.outputTokens, imageCount: s.imageCount, videoSeconds: s.videoSeconds, costUsd: s.costUsd }))}
          />
        </section>

        <section aria-labelledby="cast">
          <h2 id="cast" className="mb-4 text-2xl font-semibold">Cast</h2>
          <CastPanel
            seriesId={series.id}
            speaks={series.voiceMode === 'character_voices' || series.voiceMode === 'narrator_and_characters'}
            cast={cast.map((c) => ({
              id: c.id,
              name: c.name,
              role: c.role ?? '',
              canonical: c.canonicalDescription ?? '',
              look: (c.bible as { look?: string } | null)?.look ?? '',
              personality: (c.bible as { personality?: string } | null)?.personality ?? '',
              referenceUrl: typeof c.referenceImages?.[0] === 'object' ? (c.referenceImages[0].url ?? null) : null,
            }))}
          />
        </section>
      </main>
    </div>
  )
}
