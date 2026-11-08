import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function DashboardIndex() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) redirect('/login')
  const { docs } = await payload.find({ collection: 'series', where: { status: { not_equals: 'removed' } }, sort: '-createdAt', limit: 1, user, overrideAccess: false })
  redirect(docs[0] ? `/dashboard/${docs[0].id}` : '/start')
}
