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
    { name: 'format', type: 'select', options: ['story-reel', 'quick-reel', 'long-form'], required: true },
    {
      name: 'voiceMode',
      type: 'select',
      options: ['none', 'narrator', 'character_voices', 'narrator_and_characters'],
      defaultValue: 'none',
      required: true,
    },
    { name: 'voiceApplicability', type: 'json' },
    { name: 'narratorVoice', type: 'json' },
    { name: 'frequency', type: 'select', options: ['daily', 'every-2-days', '3-per-week', 'weekly'], required: true },
    { name: 'qualityTier', type: 'select', options: ['budget', 'standard', 'premium'], defaultValue: 'standard', required: true },
    { name: 'aspect', type: 'select', options: ['9:16', '16:9', '1:1', '4:5'], defaultValue: '9:16', required: true },
    { name: 'theme', type: 'json' },
    { name: 'heroImage', type: 'upload', relationTo: 'media' },
    { name: 'folderLinked', type: 'checkbox', defaultValue: false },
    { name: 'status', type: 'select', options: ['draft', 'active', 'paused', 'removed'], defaultValue: 'draft', required: true },
    { name: 'costCapUsd', type: 'number', defaultValue: 5 },
    { name: 'spentUsd', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    {
      name: 'videoModel',
      type: 'select',
      options: [{ label: 'Kling 2.5 Turbo (fal.ai)', value: 'kling-2.5-turbo' }],
      defaultValue: 'kling-2.5-turbo',
      required: true,
      admin: { description: 'Video model used for real-motion shots (switchable per niche).' },
    },
    { name: 'videoBudgetSec', type: 'number', admin: { description: 'Optional hard limit on total real-video seconds for this series. Empty = limited only by the tier and the cost cap.' } },
    { name: 'videoSpentSec', type: 'number', defaultValue: 0, admin: { readOnly: true } },
  ],
}
