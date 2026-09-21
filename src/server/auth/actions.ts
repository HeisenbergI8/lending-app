'use server'

import { redirect } from 'next/navigation'

import { db } from '../db.ts'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie.ts'
import { fakeVerifyPassword, verifyPassword } from './password.ts'
import {
  checkRateLimit,
  clearAttempts,
  describeRetryAfter,
  recordFailedAttempt,
} from './rate-limit.ts'
import { requestIp } from './request-ip.ts'
import { createSession, invalidateSessionToken } from './session.ts'

export type LoginState = { error: string | null }

/**
 * Log in.
 *
 * One message for every failure — "Incorrect username or password" — whether the
 * username exists or not. Saying "no such user" would confirm which usernames are
 * real, and the timing is equalised for the same reason: a missing user still
 * pays the cost of a password hash before the answer comes back.
 *
 * Next.js checks the request origin on server actions, so a form posted from
 * another site is rejected before this function runs.
 *
 * Repeated failures are rate limited — see rate-limit.ts. The check happens
 * before the password is verified, so a locked-out caller does not even get the
 * timing signal of a hash being computed.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!username || !password) {
    return { error: 'Enter your username and password.' }
  }

  const ip = await requestIp()

  const limit = await checkRateLimit(username, ip)
  if (limit.blocked) {
    return {
      error: `Too many failed attempts. Try again ${describeRetryAfter(limit.retryAfterMs)}.`,
    }
  }

  const user = await db.user.findUnique({ where: { username } })

  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await fakeVerifyPassword(password)

  if (!ok || !user) {
    await recordFailedAttempt(username, ip)
    return { error: 'Incorrect username or password.' }
  }

  await clearAttempts(username, ip)
  const token = await createSession(user.id)
  await setSessionCookie(token)
  redirect('/')
}

export async function logout(): Promise<void> {
  const token = await readSessionCookie()
  if (token) await invalidateSessionToken(token)
  await clearSessionCookie()
  redirect('/login')
}
