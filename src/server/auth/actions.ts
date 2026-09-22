'use server'

import { redirect } from 'next/navigation'

import { type FormState } from '@/lib/form-state.ts'

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

export type LoginState = {
  error: string | null
  /**
   * When the lockout lifts, as epoch milliseconds — present only while blocked.
   *
   * A timestamp rather than a duration, because the form ticks it down once a
   * second and a duration would start decaying the moment it was rendered. The
   * server's clock and the browser's can differ by a few seconds; that is a few
   * seconds on a fifteen-minute wait, and the server re-checks on submit
   * regardless, so an optimistic browser clock cannot let anyone in early.
   */
  retryAt?: number
}

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
  // An unchecked checkbox posts nothing at all, so absence is the "no" — never
  // a missing value to default. The form ships it checked.
  const remember = formData.get('remember') !== null

  if (!username || !password) {
    return { error: 'Enter the username and password.' }
  }

  const ip = await requestIp()

  const limit = await checkRateLimit(username, ip)
  if (limit.blocked) {
    return {
      // The sentence still reads on its own, for a browser with no JavaScript
      // running the countdown. Where there is JavaScript, retryAt replaces the
      // rounded "about 15 minutes" with a clock that moves.
      error: `Too many failed attempts. Try again ${describeRetryAfter(limit.retryAfterMs)}.`,
      retryAt: Date.now() + limit.retryAfterMs,
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
  await setSessionCookie(token, remember)
  redirect('/')
}

/**
 * Log out.
 *
 * Shaped like every other form action so it can go through ActionForm and get
 * the same "are you sure" dialog as delete and restore. It never returns: the
 * redirect throws, so the FormState is there for the type, not for a caller.
 */
export async function logout(_state: FormState, _form: FormData): Promise<FormState> {
  const token = await readSessionCookie()
  if (token) await invalidateSessionToken(token)
  await clearSessionCookie()
  redirect('/login')
}
