import type { CollectionConfig } from 'payload'
import { loggedIn, ownerOnly } from './access'

export const Characters: CollectionConfig = {
  slug: 'characters',
  admin: { useAsTitle: 'name' },
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
    { name: 'name', type: 'text', required: true },
    { name: 'role', type: 'text' },
    { name: 'bible', type: 'json', admin: { description: 'Look, outfit, personality, setting' } },
    { name: 'canonicalDescription', type: 'textarea', admin: { description: '~150-token description used in prompts' } },
    {
      name: 'voiceProfile',
      type: 'group',
      fields: [
        { name: 'voice', type: 'text' },
        { name: 'pace', type: 'text' },
        { name: 'pitch', type: 'text' },
        { name: 'accent', type: 'text' },
        { name: 'instructions', type: 'textarea' },
      ],
    },
    { name: 'referenceImages', type: 'upload', relationTo: 'media', hasMany: true },
  ],
}
