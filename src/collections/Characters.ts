import type { CollectionConfig } from 'payload'
import { loggedIn, ownerOnly } from './access'

export const Characters: CollectionConfig = {
  slug: 'characters',
  admin: { useAsTitle: 'name' },
  access: { create: loggedIn, read: ownerOnly, update: ownerOnly, delete: ownerOnly },
  hooks: {
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        if (operation === 'create' && req.user) data.owner = req.user.id
        // anything a person typed is cleaned and checked before it is saved: original, at most three per series, no repeated name, content check
        const { vetCharacterHook } = await import('../lib/art/characters')
        await vetCharacterHook({ data, req, operation, originalDoc })
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
    { name: 'locked', type: 'checkbox', defaultValue: false, admin: { description: 'A finished reference pack is locked: every reel uses exactly these images. "Edit character" opens it again.' } },
    { name: 'packVersion', type: 'number', defaultValue: 0, admin: { readOnly: true, description: 'Goes up each time the reference pack is rebuilt and locked.' } },
  ],
}
