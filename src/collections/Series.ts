import type { CollectionConfig } from 'payload'
import { loggedIn, ownerOnly } from './access'

export const Series: CollectionConfig = {
  slug: 'series',
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
    { name: 'title', type: 'text', required: true },
    { name: 'niche', type: 'text', required: true },
    { name: 'subNiche', type: 'text' },
    { name: 'style', type: 'text', required: true },
    { name: 'styleApplicability', type: 'json' },
    { name: 'styleBible', type: 'json', admin: { description: 'The Style agent\'s visual recipe for this series: palette, lighting, motion, grade, captions, transitions.' } },
    {
      name: 'format',
      type: 'select',
      // Not chosen any more: every video is a short story of 25 to 30 seconds (see src/lib/format.ts), so this is always '30'. The other
      // values stay only because they are part of the database enum; dropping them needs a migration.
      options: [
        { label: '10 seconds', value: '10' }, { label: '15 seconds', value: '15' }, { label: '30 seconds', value: '30' },
        { label: 'Story episode (old, now 30 s)', value: 'story-reel' }, { label: 'Quick reel (old, now 15 s)', value: 'quick-reel' }, { label: 'Long-form (old, now 30 s)', value: 'long-form' },
      ],
      defaultValue: '30',
      required: true,
      admin: { description: 'Not used: every video is 25 to 30 seconds.' },
    },
    {
      name: 'voiceMode',
      type: 'select',
      options: ['none', 'narrator', 'character_voices', 'narrator_and_characters'],
      defaultValue: 'none',
      required: true,
    },
    { name: 'voiceApplicability', type: 'json' },
    { name: 'narratorVoice', type: 'json' },
    { name: 'aspect', type: 'select', options: ['9:16', '16:9', '1:1', '4:5'], defaultValue: '9:16', required: true },
    { name: 'theme', type: 'json' },
    { name: 'heroImage', type: 'upload', relationTo: 'media' },
    { name: 'folderLinked', type: 'checkbox', defaultValue: false },
    { name: 'status', type: 'select', options: ['draft', 'active', 'paused', 'removed'], defaultValue: 'draft', required: true },
    { name: 'costCapUsd', type: 'number', defaultValue: 30, admin: { description: 'Most this series may spend in USD. A reel costs about 3 to 6.' } },
    { name: 'spentUsd', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    {
      name: 'videoModel',
      type: 'select',
      options: [{ label: 'Kling 2.5 Turbo Pro (fal.ai)', value: 'kling-2.5-turbo' }, { label: 'Kling 2.5 Turbo Standard (fal.ai, cheaper, unverified)', value: 'kling-2.5-turbo-standard' }],
      defaultValue: 'kling-2.5-turbo',
      required: true,
      admin: { description: 'Video model used for real-motion shots (switchable per niche).' },
    },
    { name: 'videoBudgetSec', type: 'number', admin: { description: 'Optional hard limit on total video seconds for this series. Empty = limited only by the cost cap.' } },
    { name: 'videoSpentSec', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    { name: 'memory', type: 'json', admin: { readOnly: true, description: 'What the series remembers from earlier videos: recent ideas, running gags and recurring characters. Updated automatically.' } },
    { name: 'reviewBeforeVideo', type: 'checkbox', defaultValue: false, admin: { description: 'Pause after the script and keyframes so you can approve before any video clip is paid for.' } },
  ],
}
