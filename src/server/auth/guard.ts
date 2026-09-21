import { redirect } from 'next/navigation'

import { readSessionCookie } from './cookie.ts'
import { type SessionUser, validateSessionToken } from './session.ts'

/**
 * Who is logged in, if anyone.
 *
 * Every server query in this app filters on the id this returns. The demo account
 * a recruiter logs into must never see real borrowers' names and debts, and a
 * filter applied directly to the query is one that cannot be forgotten in a join.
 *
 * Isolation is enforced here and in the data layer, never by hiding buttons. A
 * hidden button is not security; it is a suggestion.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await readSessionCookie()
  if (!token) return null
  return validateSessionToken(token)
}

/** The same, but sends anyone not logged in to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}
