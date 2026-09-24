import { createHash, randomBytes } from 'node:crypto'

import { db } from '../db.ts'

/**
 * Server-side sessions.
 *
 * Chosen over JWTs deliberately: deleting the row logs a device out immediately,
 * which a signed token cannot do until it expires. With one admin there is no
 * scale argument for statelessness, and this holds real money records.
 *
 * THE TOKEN IS NEVER STORED. The browser holds a random token; the database
 * holds only its SHA-256. So someone who reads the Session table — a leaked
 * backup, a stray query — learns nothing they can present as a login. The hash
 * is a one-way function of the token, and only the token opens the door.
 *
 * SHA-256 is right here and would be wrong for a password: it is fast, which is
 * a flaw when the input is a guessable human password and a non-issue when it is
 * 32 bytes of randomness that no one is going to guess.
 */

const TOKEN_BYTES = 32
const SESSION_DAYS = 30
/** Past this much remaining, an active session gets its expiry pushed out. */
const REFRESH_WHEN_DAYS_LEFT = 15

const DAY_MS = 86_400_000

export type SessionUser = {
  id: string
  username: string
  isDemo: boolean
}

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** The database key for a token. One-way: the row cannot yield the token back. */
export function sessionIdFromToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_DAYS * DAY_MS)
}

export function shouldRefresh(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < REFRESH_WHEN_DAYS_LEFT * DAY_MS
}

export async function createSession(userId: string): Promise<string> {
  const token = generateSessionToken()
  await db.session.create({
    data: { id: sessionIdFromToken(token), userId, expiresAt: sessionExpiry() },
  })
  return token
}

/**
 * Resolve a token to its user, or null.
 *
 * An expired session is deleted on sight rather than merely rejected, so the
 * table does not accumulate dead rows waiting for a cleanup job that does not exist.
 */
export async function validateSessionToken(token: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { id: sessionIdFromToken(token) },
    include: { user: { select: { id: true, username: true, isDemo: true } } },
  })
  if (!session) return null

  const now = new Date()
  if (session.expiresAt <= now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }

  if (shouldRefresh(session.expiresAt, now)) {
    await db.session
      .update({ where: { id: session.id }, data: { expiresAt: sessionExpiry(now) } })
      .catch(() => undefined)
  }

  return session.user
}

export async function invalidateSessionToken(token: string): Promise<void> {
  await db.session
    .delete({ where: { id: sessionIdFromToken(token) } })
    .catch(() => undefined)
}

/**
 * Log a user out of every device EXCEPT the one asking.
 *
 * What a password change ends. If it were changed because a phone went missing,
 * leaving that phone's session alive would make the change pointless — the token
 * in its cookie is what keeps it in, not the password. The browser doing the
 * asking keeps its own row, so the admin is not signed out of the screen she is
 * standing on.
 */
export async function invalidateOtherSessions(userId: string, keepToken: string): Promise<void> {
  await db.session.deleteMany({
    where: { userId, NOT: { id: sessionIdFromToken(keepToken) } },
  })
}
