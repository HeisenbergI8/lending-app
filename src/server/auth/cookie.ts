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
 *
 * REMEMBER ME IS THIS COOKIE'S EXPIRY AND NOTHING ELSE. With it, the cookie is
 * written with a date and survives the browser closing; without it, the cookie
 * is given no expiry at all, which makes it a session cookie the browser drops
 * the moment it quits. The Session row is thirty days either way — the row is
 * not what keeps anyone logged in, the token in the browser is, and once that
 * is gone the row is unreachable. Writing a shorter row as well would mean a
 * second lifetime to keep in step with this one for no gain.
 */

export const SESSION_COOKIE = 'lending_session'

export async function setSessionCookie(token: string, remember: boolean): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Omitted entirely rather than set to a near date: a cookie with no expiry
    // is a session cookie, and that is a different thing from one that expires
    // shortly.
    ...(remember ? { expires: sessionExpiry() } : {}),
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
