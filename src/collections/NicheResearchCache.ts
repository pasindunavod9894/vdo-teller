import type { CollectionConfig } from 'payload'

// Shared across all users (plan §3b): the same niche costs tokens only once per day.
export const NicheResearchCache: CollectionConfig = {
  slug: 'niche-research-cache',
  admin: { useAsTitle: 'key' },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true, index: true },
    { name: 'data', type: 'json', required: true },
    { name: 'expiresAt', type: 'date', required: true },
  ],
}
