/**
 * THE APP RUNS ON MANILA TIME, whatever the server's clock is set to.
 *
 * Every "today" in the app — what is overdue, what is due this week, the
 * default dates on a form, the date boxes' minimums — is read off the server's
 * local calendar (calendarDate in lib/money/weeks.ts and friends). On Vercel
 * that calendar is UTC, eight hours behind the Philippines, so from midnight to
 * 8am Manila time the app still thought it was yesterday: a loan that fell
 * overdue at midnight did not show as overdue until breakfast.
 *
 * Setting TZ here, before the server handles its first request, moves every
 * one of those readings at once instead of threading a zone through forty call
 * sites. Node re-reads TZ when it is assigned at runtime. Vercel does not let
 * TZ be set as a project environment variable (it is reserved), which is why
 * this is done in code. Dates stored in Postgres are unaffected: they are
 * written at local midday and read back by their UTC parts (weeks.ts), which
 * is exact in any zone.
 *
 * The edge runtime has no process timezone to set and nothing here runs there.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') process.env.TZ = 'Asia/Manila'
}
