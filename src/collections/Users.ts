import type { Access, CollectionConfig } from 'payload'

const selfOnly: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  return { id: { equals: user.id } }
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'username' },
  auth: {
    loginWithUsername: { allowEmailLogin: false, requireEmail: false },
  },
  access: {
    // Anyone can sign up; only admins can open the Payload admin panel.
    create: () => true,
    read: selfOnly,
    update: selfOnly,
    delete: selfOnly,
    admin: ({ req: { user } }) => user?.role === 'admin',
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, req }) => {
        // The very first account becomes the admin; everyone else is a normal user.
        if (operation === 'create') {
          const { totalDocs } = await req.payload.count({ collection: 'users', overrideAccess: true })
          data.role = totalDocs === 0 ? 'admin' : 'user'
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: ['user', 'admin'],
      defaultValue: 'user',
      required: true,
      saveToJWT: true,
      access: { create: () => false, update: ({ req: { user } }) => user?.role === 'admin' },
    },
  ],
}
