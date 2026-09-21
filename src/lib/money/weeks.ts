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

export type WeeksError =
  | { kind: 'due-before-start' }
  | { kind: 'same-day' }
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

/** Add whole days to a date, keeping it a calendar date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
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

/** The due date a given number of weeks after the start. The inverse of weeksBetween. */
export function dueDateAfterWeeks(start: Date, weeks: number): Date {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`A loan runs a whole number of weeks, at least one. Got ${weeks}`)
  }
  return addDays(start, weeks * DAYS_PER_WEEK)
}
