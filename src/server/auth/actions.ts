'use server'

import { redirect } from 'next/navigation'

import { type FormState, NO_ERROR, failed } from '@/lib/form-state.ts'

import { db } from '../db.ts'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie.ts'
import { requireUser } from './guard.ts'
import {
  fakeVerifyPassword,
  hashPassword,
  newPasswordProblem,
  verifyPassword,
} from './password.ts'
import {
  checkRateLimit,
  clearAttempts,
  describeRetryAfter,
  recordFailedAttempt,
} from './rate-limit.ts'
import { requestIp } from './request-ip.ts'
import { createSession, invalidateOtherSessions, invalidateSessionToken } from './session.ts'

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

/**
 * Change the signed-in account's password.
 *
 * THE CURRENT PASSWORD IS ASKED FOR AGAIN even though there is already a
 * session. A browser left open on an unlocked phone is the case this protects
 * against, and the old password is the only evidence that the person at the
 * keyboard is the account holder rather than whoever picked the phone up.
 *
 * THE DEMO ACCOUNT IS REFUSED. Its username and password are printed on the
 * sign in screen for anyone holding the CV link, so without this refusal any
 * visitor could change them and lock out every visitor after them. The screen
 * says so as well, but that is a courtesy — this is the rule.
 *
 * Every OTHER session is dropped once the password is written. Sessions are
 * what keep a device signed in, not the password, so a password changed because
 * a device went missing would otherwise change nothing about that device.
 */
export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  if (user.isDemo) {
    return failed('The demo account keeps the password printed on the sign in screen.')
  }

  const current = String(form.get('currentPassword') ?? '')
  const next = String(form.get('newPassword') ?? '')
  const confirm = String(form.get('confirmPassword') ?? '')

  const problem = newPasswordProblem(current, next, confirm)
  if (problem) return failed(problem)

  const account = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  })
  if (!account) return failed('That account no longer exists.')

  if (!(await verifyPassword(current, account.passwordHash))) {
    return failed('The current password is not correct.')
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next) },
  })

  // Read back rather than passed in: the token is httpOnly and the browser
  // cannot send it up with the form even if it wanted to.
  const token = await readSessionCookie()
  if (token) await invalidateOtherSessions(user.id, token)

  return NO_ERROR
}
