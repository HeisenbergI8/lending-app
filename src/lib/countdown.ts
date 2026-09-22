/**
 * A lockout, counted down.
 *
 * `describeRetryAfter` in the rate limiter rounds to "about 15 minutes", which
 * is the right shape for a sentence written once. It is the wrong shape for a
 * number that ticks: rounding up means the message says "about a minute" for a
 * full sixty seconds and then jumps to zero, so the admin watches a figure that
 * does not move and concludes the screen is stuck.
 *
 * This truncates instead, and counts seconds, so every tick visibly changes
 * something.
 *
 * Lives in src/lib/ rather than beside the rate limiter because the login form
 * is a client component and must not import from src/server/ — and because a
 * rule worth testing cannot live in a .tsx file, which `node --test` will not
 * compile.
 */

/** Milliseconds remaining as `m:ss`, or `mm:ss` past ten minutes. Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
