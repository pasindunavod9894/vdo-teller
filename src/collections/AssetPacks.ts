import type { CollectionConfig } from 'payload'
import { ownerOnly } from './access'

// One pack per character: four expression close-ups made from its reference sheet (the old pose/mouth kinds are legacy). Locked with the character.
export const AssetPacks: CollectionConfig = {
  slug: 'asset-packs',
  admin: { useAsTitle: 'id' },
  access: { create: () => false, read: ownerOnly, update: () => false, delete: () => false },
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true },
    { name: 'character', type: 'relationship', relationTo: 'characters', required: true, unique: true },
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'kind', type: 'select', options: ['expression', 'pose', 'emotion', 'mouth', 'face'], required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'image', type: 'upload', relationTo: 'media', required: true },
      ],
    },
  ],
}
