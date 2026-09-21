import { purgeExpired } from '@/server/deleted/purge.ts'

/**
 * The daily run that empties Recently Deleted.
 *
 * Vercel Cron calls this once a day (see vercel.json) and nothing else should.
 * It is the only endpoint in the app that destroys data permanently, so it is
 * the only one written to REFUSE rather than fall back: no CRON_SECRET set means
 * 503 and no purge, not an open door that quietly deletes a year of loans the
 * first time somebody guesses the path.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
 * The comparison is length-safe and constant-ish; with a random 32-byte secret
 * the timing of a string compare is not the weak point, but there is no reason
 * to hand out the first differing byte either.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    return Response.json(
      { ok: false, error: 'CRON_SECRET is not set. Nothing was purged. See .env.example.' },
      { status: 503 },
    )
  }

  if (!matches(request.headers.get('authorization'), `Bearer ${secret}`)) {
    return Response.json({ ok: false, error: 'Not authorised.' }, { status: 401 })
  }

  const report = await purgeExpired()

  // Logged as well as returned: the cron's own response is seen by nobody, and
  // the run that destroyed thirty loans should be findable afterwards.
  console.info('[purge]', JSON.stringify(report))

  return Response.json({ ok: true, ...report })
}

function matches(given: string | null, expected: string): boolean {
  if (given === null || given.length !== expected.length) return false

  let difference = 0
  for (let i = 0; i < given.length; i += 1) {
    difference |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return difference === 0
}
