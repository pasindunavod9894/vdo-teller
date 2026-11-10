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
      options: ['queued', 'running', 'awaiting-approval', 'needs-review', 'done', 'failed'],
      defaultValue: 'queued',
      required: true,
    },
    { name: 'ideas', type: 'json', admin: { description: 'The three ideas the Creator proposed; the Story Builder picked one.' } },
    { name: 'idea', type: 'json' },
    { name: 'styleNotes', type: 'json', admin: { description: 'The Style agent\'s notes for this reel: mood, time of day, weather, accent colour.' } },
    { name: 'script', type: 'json' },
    { name: 'critique', type: 'json', admin: { description: 'The Critic\'s last verdict; an approved script is reused if a later step fails and the episode is retried.' } },
    { name: 'shots', type: 'json' },
    { name: 'timeline', type: 'json' },
    { name: 'audio', type: 'json' },
    { name: 'files', type: 'json', admin: { description: 'master + exports (R2 keys / local file names)' } },
    { name: 'costUsd', type: 'number', defaultValue: 0 },
    { name: 'videoCostUsd', type: 'number', defaultValue: 0 },
    { name: 'videoClips', type: 'json', admin: { description: 'One entry per real-video shot: shot, model, seconds, costUsd, file, status.' } },
    { name: 'qaFlags', type: 'json', admin: { description: 'Shots the vision check of the finished video wants a person to look at: shot, kind, issue.' } },
    { name: 'error', type: 'text' },
    { name: 'mode', type: 'text' },
    { name: 'scheduledFor', type: 'date' },
  ],
}
