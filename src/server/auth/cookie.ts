import { cookies } from 'next/headers'

import { sessionExpiry } from './session.ts'

/**
 * The session cookie.
 *
 * httpOnly     JavaScript cannot read it, so a cross-site scripting bug cannot
 *              walk off with the session.
 * sameSite lax The browser will not attach it to a cross-site POST, which is
 *              what stops another site submitting a form as you. Lax rather than
 *              strict so that following a link into the app still arrives logged in.
 * secure       HTTPS only in production. Left off in development because
 *              localhost is not served over HTTPS and the cookie would be dropped.
 */

export const SESSION_COOKIE = 'lending_session'

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: sessionExpiry(),
  })
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
