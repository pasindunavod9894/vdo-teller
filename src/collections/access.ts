import type { Access, Where } from 'payload'

/** Signed-in users only see and change their own documents (field `owner`). */
export const ownerOnly: Access = ({ req: { user } }) => {
  if (!user) return false
  return { owner: { equals: user.id } } as Where
}

export const loggedIn: Access = ({ req: { user } }) => Boolean(user)
