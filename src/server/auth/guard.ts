import { cache } from 'react'
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
 *
 * WRAPPED IN React cache(), which memoises per request. The layout, the page and
 * its generateMetadata each call this, and without the wrapper that is three
 * round trips to the session table before a screen fetches its own data — on a
 * connection where every round trip is the slowest thing the request does. The
 * cache is per render pass, so a login on one request is never visible to
 * another, and nothing is held between requests.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionCookie()
  if (!token) return null
  return validateSessionToken(token)
})

/** The same, but sends anyone not logged in to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}
