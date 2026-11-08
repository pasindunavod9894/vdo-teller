import type { CollectionConfig } from 'payload'
import { loggedIn, ownerOnly } from './access'

export const Episodes: CollectionConfig = {
  slug: 'episodes',
  admin: { useAsTitle: 'title' },
  access: { create: loggedIn, read: ownerOnly, update: ownerOnly, delete: ownerOnly },
  hooks: {
    beforeChange: [
      ({ data, req, operation }) => {
        if (operation === 'create' && req.user) data.owner = req.user.id
        return data
      },
    ],
  },
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, admin: { readOnly: true } },
    { name: 'series', type: 'relationship', relationTo: 'series', required: true },
    { name: 'title', type: 'text' },
    {
      name: 'status',
      type: 'select',
      options: ['queued', 'running', 'needs-review', 'done', 'failed'],
      defaultValue: 'queued',
      required: true,
    },
    { name: 'idea', type: 'json' },
    { name: 'script', type: 'json' },
    { name: 'shots', type: 'json' },
    { name: 'timeline', type: 'json' },
    { name: 'audio', type: 'json' },
    { name: 'files', type: 'json', admin: { description: 'master + exports (R2 keys / local file names)' } },
    { name: 'costUsd', type: 'number', defaultValue: 0 },
    { name: 'scheduledFor', type: 'date' },
  ],
}
