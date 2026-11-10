/** What to tell a person when Payload's sign-up or login answers with an error: the real reason, in plain words. */
export const USERNAME_TAKEN = 'That username is already taken. If it is yours, log in instead: your answers are kept and your series is created when you do.'

export function authErrorMessage(json: unknown): string {
  const e = (json as { errors?: { message?: string; data?: { errors?: { message?: string }[] } }[] } | null)?.errors?.[0]
  const detail = e?.data?.errors?.[0]?.message ?? e?.message ?? ''
  if (/already registered/i.test(detail)) return USERNAME_TAKEN
  return detail || 'Something went wrong'
}
