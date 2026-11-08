import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { CastPanel } from '@/components/dashboard/cast-panel'
import { DashHeader } from '@/components/dashboard/header'
import { ExportMenu } from '@/components/dashboard/export-menu'
import { Hero } from '@/components/dashboard/hero'
import { LibraryGrid } from '@/components/dashboard/library-grid'
import { ThemeBootstrap } from '@/components/dashboard/theme-bootstrap'
import { STYLE_CATALOGUE } from '@/lib/styles/catalogue'
import { IMAGE_COST, QUALITY_FOR_TIER } from '@/lib/art/plan'
import { heuristicTheme, isTheme, themeVars } from '@/themes/palettes'
import type { Frequency } from '@/lib/schedule'

const VOICE_LABEL: Record<string, string> = {
  none: 'No voice',
  narrator: 'Narrator',
  character_voices: 'Character voices',
  narrator_and_characters: 'Narrator + characters',
}
const FORMAT_LABEL: Record<string, string> = { 'story-reel': 'Story episode', 'quick-reel': 'Quick reel', 'long-form': 'Long-form' }

export default async function Dashboard({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ start?: string }> }) {
  const { id } = await params
  const { start } = await searchParams
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) redirect('/login')

  const series = await payload.findByID({ collection: 'series', id, user, overrideAccess: false, depth: 1 }).catch(() => null)
  if (!series || series.status === 'removed') notFound()

  const [{ docs: all }, { docs: cast }, { docs: episodes, totalDocs: episodeCount }] = await Promise.all([
    payload.find({ collection: 'series', where: { status: { not_equals: 'removed' } }, sort: 'createdAt', user, overrideAccess: false, limit: 20, depth: 0 }),
    payload.find({ collection: 'characters', where: { series: { equals: series.id } }, user, overrideAccess: false, depth: 1 }),
    payload.find({ collection: 'episodes', where: { series: { equals: series.id } }, sort: '-createdAt', user, overrideAccess: false, limit: 12, depth: 0 }),
  ])

  const hasTheme = isTheme(series.theme)
  const theme = isTheme(series.theme) ? series.theme : heuristicTheme(`${series.niche} ${series.subNiche ?? ''}`, series.style)
  const styleName = STYLE_CATALOGUE.find((s) => s.id === series.style)?.name ?? series.style
  const heroUrl = typeof series.heroImage === 'object' && series.heroImage ? (series.heroImage.url ?? null) : null
  const tierQuality = QUALITY_FOR_TIER[series.qualityTier as keyof typeof QUALITY_FOR_TIER] ?? 'medium'
  const lastEpisodeAt = episodes[0]?.createdAt ?? null
  const spent = series.spentUsd ?? 0
  const cap = series.costCapUsd ?? 5

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
          heroCost={IMAGE_COST[tierQuality === 'low' ? 'medium' : tierQuality]}
          chips={[series.niche, styleName, FORMAT_LABEL[series.format] ?? series.format, VOICE_LABEL[series.voiceMode] ?? series.voiceMode, series.aspect]}
        />

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label="Overview">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-[var(--radius)] border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="font-heading mt-1 text-2xl font-semibold">{v}</div>
            </div>
          ))}
        </section>

        <section aria-labelledby="library">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="library" className="text-2xl font-semibold">Video library</h2>
            <ExportMenu enabled={episodeCount > 0} main={series.aspect} />
          </div>
          <LibraryGrid
            seriesId={series.id}
            title={series.title}
            frequency={series.frequency as Frequency}
            lastEpisodeAt={lastEpisodeAt}
            runningEpisodeId={episodes.find((e) => e.status === 'running')?.id ?? null}
            autoStart={start === '1'}
            episodes={episodes.map((e) => ({
              id: e.id,
              title: e.title ?? '',
              status: e.status,
              hasVideo: Boolean((e.files as { master?: string } | null)?.master),
              meta: (e.files as { publish?: unknown } | null)?.publish,
              hook: e.idea && typeof e.idea === 'object' ? ((e.idea as { hook?: string }).hook ?? null) : null,
            }))}
          />
          {episodeCount === 0 && <p className="mt-3 text-sm text-muted-foreground">Your videos will appear here and play in this library.</p>}
        </section>

        <section aria-labelledby="cast">
          <h2 id="cast" className="mb-4 text-2xl font-semibold">Cast</h2>
          <CastPanel
            cast={cast.map((c) => ({
              id: c.id,
              name: c.name,
              role: c.role ?? '',
              canonical: c.canonicalDescription ?? '',
              referenceUrl: typeof c.referenceImages?.[0] === 'object' ? (c.referenceImages[0].url ?? null) : null,
            }))}
          />
        </section>
      </main>
    </div>
  )
}
