import { headers } from 'next/headers'

/**
 * The caller's address, as best it can be known.
 *
 * Behind a proxy the socket address is the proxy's, so the real client sits in
 * x-forwarded-for — a comma-separated chain where the FIRST entry is the
 * original client. Vercel also sets x-real-ip, which is already just that.
 *
 * x-forwarded-for is client-controlled and can be forged. That is acceptable
 * here: forging it defeats the per-IP counter but not the username-and-IP pair
 * counter, which still sees each forged address as a fresh identity with its own
 * small budget. The limit degrades rather than disappears.
 */
export async function requestIp(): Promise<string> {
  const h = await headers()

  const forwarded = h.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return h.get('x-real-ip')?.trim() || 'unknown'
}
