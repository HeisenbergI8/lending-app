import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Password hashing.
 *
 * scrypt from Node's own crypto — no bcrypt, no argon2 dependency. scrypt is
 * deliberately slow and memory-hard, which is the whole point: it makes guessing
 * expensive for an attacker holding the hashes.
 *
 * Stored format: `scrypt:<salt hex>:<derived hex>`. The salt is per password and
 * lives alongside the hash, which is normal — a salt is not a secret. Its job is
 * to make two people who chose the same password hash differently, so one cracked
 * password does not unlock every account that shares it.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const SALT_BYTES = 16
const KEY_LENGTH = 64
const PREFIX = 'scrypt'

export const MIN_PASSWORD_LENGTH = 8

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `${PREFIX}:${salt}:${derived.toString('hex')}`
}

/**
 * Check a password against a stored hash.
 *
 * The comparison is timing-safe. A plain `===` on two hex strings returns as soon
 * as it finds a differing character, and that difference in duration is
 * measurable over enough requests — it leaks how much of a guess was correct.
 * timingSafeEqual always reads both buffers to the end.
 *
 * Returns false rather than throwing on a malformed stored hash: a corrupt row
 * should fail the login, not crash the request handler.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== PREFIX) return false

  const [, salt, expectedHex] = parts
  if (!salt || !expectedHex) return false

  let expected: Buffer
  try {
    expected = Buffer.from(expectedHex, 'hex')
  } catch {
    return false
  }
  if (expected.length !== KEY_LENGTH) return false

  const actual = await scrypt(password, salt, KEY_LENGTH)
  return timingSafeEqual(actual, expected)
}

/**
 * Burn roughly the same time as a real password check.
 *
 * Called when the username does not exist. Without it, a missing user returns
 * noticeably faster than a wrong password, and that difference alone tells an
 * attacker which usernames are real.
 */
export async function fakeVerifyPassword(password: string): Promise<false> {
  await scrypt(password, 'timing-equalisation-salt', KEY_LENGTH)
  return false
}
