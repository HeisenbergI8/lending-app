/**
 * How long a deleted row has left.
 *
 * Deleting in this app sets `deletedAt` and nothing more. The row keeps working
 * — its loans still point at it, its money still adds up — it is simply hidden
 * from every ordinary screen and listed on Recently Deleted instead.
 *
 * Thirty days later the purge destroys it for real, and THAT is irreversible:
 * there is no second bin behind this one. Thirty days is the same promise the
 * phone makes about photos, which is the promise the screen is named after.
 *
 * The number and the arithmetic live here, apart from both the purge and the
 * screen, so the countdown the admin reads and the cutoff the purge applies can
 * never disagree about what "thirty days" means.
 */

export const PURGE_AFTER_DAYS = 30

const DAY_MS = 86_400_000

/** Anything deleted before this moment is out of time. */
export function purgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS)
}

/**
 * Whole days left before a row is destroyed, never below zero.
 *
 * Rounded UP, so a row with eleven hours left reads "1 day" rather than "0" —
 * the admin is being told how long they still have, and rounding that down to
 * nothing would be a lie in the one direction that costs them something.
 */
export function daysUntilPurge(deletedAt: Date, now: Date = new Date()): number {
  const remaining = deletedAt.getTime() + PURGE_AFTER_DAYS * DAY_MS - now.getTime()
  return Math.max(0, Math.ceil(remaining / DAY_MS))
}
