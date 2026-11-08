// Sets a known password on the throwaway e2e test user, for trying the dashboard locally. Test data only.
// Run: pnpm tsx --env-file=.env scripts/set-test-password.ts <username> <password>
async function main() {
  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const [username, password] = process.argv.slice(2)
  if (!username?.startsWith('e2e-') || !password) throw new Error('Only e2e-* test users can be changed with this script.')
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'users', where: { username: { equals: username } }, limit: 1, overrideAccess: true })
  if (!docs[0]) throw new Error('No such user')
  await payload.update({ collection: 'users', id: docs[0].id, data: { password }, overrideAccess: true })
  console.log('password set for', username)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
