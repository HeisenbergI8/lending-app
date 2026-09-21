import { addDays, calendarDate, parseCalendarDate, toDateInput } from './money/weeks.ts'

/**
 * The stretch of time a report covers.
 *
 * Pure, and in lib/ so the page, the route and the tests all read the same
 * rules. What a range MEANS is written down once, in the report itself and here:
 * an event falls in the range when its own date does — a loan by the day it
 * started, a payment by the day it arrived, a lender's money in or out by the
 * day it moved.
 *
 * Position figures are never ranged. Floating funds, what is still out and what
 * a borrower owes are facts about today, because the ledger stores movements
 * rather than nightly balances and cannot honestly answer "as of last March".
 */

export type ReportRange = { from: Date; to: Date }

export const REPORT_KINDS = ['summary', 'lender', 'borrower', 'borrower-file'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value)
}

/** This month so far — the range a statement usually covers. */
export function defaultRange(today: Date = new Date()): ReportRange {
  return {
    from: calendarDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: calendarDate(today),
  }
}

/**
 * Read a range out of a query string, falling back to this month.
 *
 * A range typed backwards is turned the right way round rather than refused —
 * it is the same range, and refusing it would mean an error page for a person
 * who filled two boxes in the order they read them.
 */
export function parseReportRange(
  params: { from?: string | null; to?: string | null },
  today: Date = new Date(),
): ReportRange {
  const fallback = defaultRange(today)
  const from = parseCalendarDate(params.from ?? '') ?? fallback.from
  const to = parseCalendarDate(params.to ?? '') ?? fallback.to
  return from > to ? { from: to, to: from } : { from, to }
}

/**
 * The range as a `where` clause for a Postgres `date` column.
 *
 * `to` is inclusive — the admin picking 31 March means the whole of 31 March.
 * The upper bound is therefore the day after at midday, because a `date` column
 * read back through the driver lands at the start of its own day and `lte` on
 * midday of the 31st would drop it.
 */
export function rangeFilter(range: ReportRange) {
  return { gte: range.from, lt: addDays(range.to, 1) }
}

/** Midnight, so a comparison is between calendar days rather than instants. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Whether a day falls in the range — for filtering rows already in hand.
 *
 * CALENDAR DAYS, never instants. A Postgres `date` read back through the driver
 * arrives at midnight UTC, which is morning in Manila; the range's own ends are
 * carried at local midday. Comparing those two as timestamps puts the day AFTER
 * the range inside it by twelve hours. Comparing the days themselves cannot.
 */
export function inRange(date: Date | null | undefined, range: ReportRange): boolean {
  if (!date) return false
  const day = startOfDay(date)
  return day >= startOfDay(range.from) && day <= startOfDay(range.to)
}

const long = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Sep 1, 2026 – Sep 21, 2026", for the line under a report's title. */
export function describeRange(range: ReportRange): string {
  return `${long.format(range.from)} – ${long.format(range.to)}`
}

/** The range as query parameters, for a link or a form's default values. */
export function rangeParams(range: ReportRange): { from: string; to: string } {
  return { from: toDateInput(range.from), to: toDateInput(range.to) }
}
