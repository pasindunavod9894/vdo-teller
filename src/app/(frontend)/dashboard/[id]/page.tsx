import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { CastPanel } from '@/components/dashboard/cast-panel'

// Placeholder: the themed dashboard is built in Phase 6.
export default async function Dashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) redirect('/login')
  const series = await payload.findByID({ collection: 'series', id, user, overrideAccess: false }).catch(() => null)
  if (!series) notFound()
  const { docs: cast } = await payload.find({ collection: 'characters', where: { series: { equals: series.id } }, user, overrideAccess: false, depth: 1 })
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm text-muted-foreground">Signed in as {user.username}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">{series.title}</h1>
      <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
        {([['Niche', series.niche], ['Style', series.style], ['Format', series.format], ['Voice', series.voiceMode], ['Frequency', series.frequency], ['Quality', series.qualityTier]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-card p-4"><dt className="text-muted-foreground">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>
        ))}
      </dl>
      <h2 className="mt-10 text-xl font-semibold">Cast</h2>
      <div className="mt-3">
        <CastPanel cast={cast.map((c) => ({
          id: c.id, name: c.name, role: c.role ?? '', canonical: c.canonicalDescription ?? '',
          referenceUrl: typeof c.referenceImages?.[0] === 'object' ? (c.referenceImages[0].url ?? null) : null,
        }))} />
      </div>
      <p className="mt-10 text-sm text-muted-foreground">The themed dashboard and first video arrive in the next phases.</p>
    </main>
  )
}
