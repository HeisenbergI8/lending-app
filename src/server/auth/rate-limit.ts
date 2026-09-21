import { createHash } from 'node:crypto'

import { db } from '../db.ts'

/**
 * Login rate limiting.
 *
 * Without it, nothing stops someone working through a password list: the login
 * endpoint answers as fast as scrypt can run, forever.
 *
 * The counters live in Postgres rather than in memory because the app runs
 * serverless. An in-memory counter is per-instance and resets whenever the
 * platform starts a new one, so it would look like protection while providing
 * close to none.
 *
 * Two limits, because either alone has a hole:
 *
 *   PAIR (username + IP), tight    stops guessing one account from one place.
 *   IP alone, loose                catches someone trying many usernames from
 *                                  one place, which the pair counter would miss.
 *
 * Keying on username ALONE is deliberately avoided: anyone could then lock the
 * admin out of their own account just by failing logins on purpose.
 */

export const WINDOW_MS = 15 * 60_000
export const MAX_ATTEMPTS_PER_PAIR = 5
export const MAX_ATTEMPTS_PER_IP = 20
/** Attempts older than this are deleted on the next check. */
const RETENTION_MS = 24 * 60 * 60_000

export type RateLimitVerdict =
  | { blocked: false }
  | { blocked: true; retryAfterMs: number }

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function identifierFor(username: string, ip: string): string {
  return sha256(`${username.toLowerCase()}|${ip}`)
}

export function ipHashFor(ip: string): string {
  return sha256(ip)
}

/**
 * Decide from a list of attempt timestamps. Pure, so the policy is testable
 * without a database.
 *
 * The lockout runs from the OLDEST attempt still inside the window, not from the
 * newest. Counting from the newest would let someone keep trying every few
 * seconds and extend their own lockout forever without ever being released —
 * and, worse, would mean a legitimate user who mistypes twice more is punished
 * far longer than intended.
 */
export function verdictFor(
  timestamps: Date[],
  max: number,
  now: Date = new Date(),
  windowMs: number = WINDOW_MS,
): RateLimitVerdict {
  const cutoff = now.getTime() - windowMs
  const recent = timestamps.map((t) => t.getTime()).filter((t) => t > cutoff)

  if (recent.length < max) return { blocked: false }

  const oldest = Math.min(...recent)
  const retryAfterMs = oldest + windowMs - now.getTime()
  return { blocked: true, retryAfterMs: Math.max(retryAfterMs, 0) }
}

/** Turn a delay into something a person can read. */
export function describeRetryAfter(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes <= 1) return 'in about a minute'
  return `in about ${minutes} minutes`
}

/** Is this username-and-address currently locked out? */
export async function checkRateLimit(username: string, ip: string): Promise<RateLimitVerdict> {
  const now = new Date()
  const since = new Date(now.getTime() - WINDOW_MS)

  const [pairAttempts, ipAttempts] = await Promise.all([
    db.loginAttempt.findMany({
      where: { identifier: identifierFor(username, ip), createdAt: { gt: since } },
      select: { createdAt: true },
    }),
    db.loginAttempt.findMany({
      where: { ipHash: ipHashFor(ip), createdAt: { gt: since } },
      select: { createdAt: true },
    }),
  ])

  const pair = verdictFor(pairAttempts.map((a) => a.createdAt), MAX_ATTEMPTS_PER_PAIR, now)
  if (pair.blocked) return pair

  return verdictFor(ipAttempts.map((a) => a.createdAt), MAX_ATTEMPTS_PER_IP, now)
}

export async function recordFailedAttempt(username: string, ip: string): Promise<void> {
  await db.loginAttempt.create({
    data: { identifier: identifierFor(username, ip), ipHash: ipHashFor(ip) },
  })

  // Opportunistic cleanup. At this volume a scheduled job would be more moving
  // parts than the problem deserves.
  await db.loginAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } })
    .catch(() => undefined)
}

/** A successful login clears the slate for that pair. */
export async function clearAttempts(username: string, ip: string): Promise<void> {
  await db.loginAttempt
    .deleteMany({ where: { identifier: identifierFor(username, ip) } })
    .catch(() => undefined)
}
