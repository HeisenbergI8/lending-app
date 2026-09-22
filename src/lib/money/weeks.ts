import { type Result, ok, err } from './result.ts'

/**
 * How long a loan runs, derived from two dates the admin types.
 *
 * The rule from the spec: `weeks = (due - start) / 7`, and it must come out a
 * whole number. A 30-day gap is 4.29 weeks, and rounding that silently would
 * change what the borrower owes — ₱8,400 at four weeks against ₱10,500 at five
 * on a ₱30,000 loan. So a date that does not divide evenly is refused, and the
 * form shows the nearest two that do.
 */

const MS_PER_DAY = 86_400_000
export const DAYS_PER_WEEK = 7

/**
 * The two things wrong with a pair of dates whatever the loan charges.
 *
 * A loan whose interest is a fixed peso amount can run any number of days, so
 * these two are the whole of its date rule. A loan on a weekly rate has a third
 * — see WeeksError.
 */
export type TermError = { kind: 'due-before-start' } | { kind: 'same-day' }

export type WeeksError =
  | TermError
  | {
      kind: 'not-whole-weeks'
      days: number
      /** The two valid due dates either side, so the form can offer them. */
      previousValidDue: Date
      nextValidDue: Date
    }

/**
 * Whole days between two calendar dates.
 *
 * Deliberately ignores the time of day and the time zone. A loan runs from one
 * calendar day to another; it does not care that the clocks went forward and
 * made one of those days 23 hours long. Subtracting raw timestamps across a DST
 * boundary yields 27.96 days for what everyone involved calls four weeks.
 */
export function daysBetween(start: Date, due: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const dueUtc = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate())
  return Math.round((dueUtc - startUtc) / MS_PER_DAY)
}

/**
 * The same calendar day, carried at local midday.
 *
 * EVERY Date that means a calendar day — a start date, a due date, the day a
 * lender handed cash over — goes through this before it is stored.
 *
 * Postgres `date` columns hold no time and no zone, so the driver has to pick a
 * calendar day out of the instant it is given, and it picks the UTC one. In
 * Manila, local midnight on 5 January is 4 January 16:00 UTC, so a date built
 * the obvious way is written as the day before and reads back as the day before
 * — for every date in the app, shifting a due date and tipping a loan into
 * overdue a day early.
 *
 * Midday is the fix because it is twelve hours from either edge: no time zone on
 * earth is far enough from UTC to push it into a different day.
 */
export function calendarDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

/** Add whole days to a date, keeping it a calendar date — at midday, as above. */
export function addDays(date: Date, days: number): Date {
  return calendarDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

/**
 * The loan's term in weeks, or why the dates are not acceptable.
 *
 * This is what powers the live "= 4 weeks" badge next to the due-date field.
 */
export function weeksBetween(start: Date, due: Date): Result<number, WeeksError> {
  const days = daysBetween(start, due)

  if (days < 0) return err({ kind: 'due-before-start' })
  if (days === 0) return err({ kind: 'same-day' })

  if (days % DAYS_PER_WEEK !== 0) {
    const completeWeeks = Math.floor(days / DAYS_PER_WEEK)
    return err({
      kind: 'not-whole-weeks',
      days,
      previousValidDue: addDays(start, completeWeeks * DAYS_PER_WEEK),
      nextValidDue: addDays(start, (completeWeeks + 1) * DAYS_PER_WEEK),
    })
  }

  return ok(days / DAYS_PER_WEEK)
}

/**
 * The loan's term in days, for a loan whose interest is a fixed amount.
 *
 * NO WHOLE-WEEK RULE HERE, and that is the point of it. The refusal in
 * weeksBetween exists because weeks are a multiplier — 30 days rounded to five
 * weeks changes what the borrower owes. A fixed amount has no multiplier to
 * round: the admin typed the interest, so three days is simply three days.
 */
export function termDaysBetween(start: Date, due: Date): Result<number, TermError> {
  const days = daysBetween(start, due)

  if (days < 0) return err({ kind: 'due-before-start' })
  if (days === 0) return err({ kind: 'same-day' })

  return ok(days)
}

/** The due date a given number of weeks after the start. The inverse of weeksBetween. */
export function dueDateAfterWeeks(start: Date, weeks: number): Date {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`A loan runs a whole number of weeks, at least one. Got ${weeks}`)
  }
  return addDays(start, weeks * DAYS_PER_WEEK)
}

const dayMonth = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Why two dates do not work, in words for the person who typed them.
 *
 * The whole-weeks refusal names the two dates that WOULD work, because "that is
 * not a whole number of weeks" leaves the admin counting on their fingers.
 *
 * Here rather than in a component because the same sentence belongs in the live
 * badge beside the due-date field AND in the server action's answer, and two
 * copies of it would drift apart the first time one is reworded.
 */
export function describeWeeksError(error: WeeksError): string {
  switch (error.kind) {
    case 'due-before-start':
      return 'The due date is before the start date.'
    case 'same-day':
      return 'A loan runs at least one week.'
    case 'not-whole-weeks':
      return `${error.days} days is not a whole number of weeks. Try ${dayMonth.format(error.previousValidDue)} or ${dayMonth.format(error.nextValidDue)}.`
  }
}

/**
 * How long a loan ran, in the words the admin would use.
 *
 * Weeks where the days divide evenly, days where they do not — so a loan on the
 * usual weekly rate still reads "4 weeks" and a three-day one reads "3 days"
 * rather than "0.43 weeks". The stored column is days for every loan; this is
 * the only place that decides how to say it.
 */
export function describeTerm(days: number): string {
  if (days % DAYS_PER_WEEK === 0) {
    const weeks = days / DAYS_PER_WEEK
    return weeks === 1 ? '1 week' : `${weeks} weeks`
  }
  return days === 1 ? '1 day' : `${days} days`
}

/** Why two dates do not work on a fixed-amount loan. The weekly twin is above. */
export function describeTermError(error: TermError): string {
  return error.kind === 'due-before-start'
    ? 'The due date is before the start date.'
    : 'A loan runs at least one day.'
}

/**
 * "2026-09-21" — from an `<input type="date">` or from a URL — as a calendar
 * date, or null when it is not a real day.
 *
 * `new Date(2026, 1, 31)` is 3 March, not an error: the constructor rolls a day
 * that does not exist over into the next month. A date picker will not produce
 * one, but a server action and a query string are both public and anything can
 * arrive in either, so the parts are read back and compared rather than trusted.
 */
export function parseCalendarDate(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return null

  const [, year, month, day] = match
  const parsed = calendarDate(new Date(Number(year), Number(month) - 1, Number(day)))

  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return null
  }

  return parsed
}

/** The inverse: a calendar date as "2026-09-21", which is what a date input reads. */
export function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
