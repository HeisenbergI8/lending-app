import { addDays, calendarDate, daysBetween, parseCalendarDate, storedCalendarDate, toDateInput } from './money/weeks.ts'

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

export const REPORT_KINDS = ['summary', 'admin-cut', 'lender', 'borrower', 'borrower-file'] as const
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

/**
 * The same test, for a day that came out of a `date` COLUMN.
 *
 * WHY THIS IS SEPARATE AND inRange IS NOT FIXED INSTEAD. A `date` column comes
 * back at midnight UTC, so its calendar day lives in the UTC parts; anything
 * else — a real timestamp, a date built from a form — has its day in the LOCAL
 * parts. `inRange` is given both, so a conversion inside it is wrong for half
 * its callers. Its own tests say so: they pass `new Date(2026, 2, 31, 23, 59)`
 * to prove the time of day cannot decide the answer.
 *
 * So the two conventions get two functions, and picking between them is a
 * question with one right answer at every call site: did this date come out of a
 * `date` column? The six that exist are LoanRequest.startOn,
 * LenderTransaction.occurredOn, Loan.startOn, Loan.dueOn, Loan.nextDueOn and
 * Payment.paidOn.
 *
 * Reading those locally is what put a payment dated 1 March into February and
 * dropped one dated 31 March out of a March report, anywhere west of London.
 */
export function storedDayInRange(date: Date | null | undefined, range: ReportRange): boolean {
  return date ? inRange(storedCalendarDate(date), range) : false
}

const long = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Sep 1, 2026 to Sep 21, 2026", for the line under a report's title. */
export function describeRange(range: ReportRange): string {
  return `${long.format(range.from)} to ${long.format(range.to)}`
}

/** How many days the range covers, both ends included. "Aug 1 to Aug 31" is 31. */
export function rangeDays(range: ReportRange): number {
  return daysBetween(range.from, range.to) + 1
}

/** Whether two ranges are the same pair of calendar days. */
export function sameRange(a: ReportRange, b: ReportRange): boolean {
  return toDateInput(a.from) === toDateInput(b.from) && toDateInput(a.to) === toDateInput(b.to)
}

export type RangePreset = { key: string; label: string; range: ReportRange }

/**
 * The four stretches of time worth one tap.
 *
 * WHY THESE FOUR. Two date boxes can express any range, and that is exactly the
 * problem: the ranges actually asked for are "this month", "last month" and
 * "the year so far", and typing six digits twice to get one of them is the work
 * a preset removes. They are ORDERED SHORTEST FIRST so the row reads as a
 * widening lens rather than an arbitrary list.
 *
 * NONE OF THEM RUNS PAST TODAY. A range ending in the future would count days no
 * loan has lived through yet, and the figure would quietly include interest that
 * has not been earned. Last month is the one exception to ending today, and it
 * ends on the last day of that month, which is already past.
 *
 * "Last 90 days" rather than "Last 3 months", because three months is either 89
 * or 92 days depending on which three, and a figure that moves with the calendar
 * cannot be compared with the one beside it. 90 days is 90 days.
 */
export function rangePresets(today: Date = new Date()): RangePreset[] {
  const now = calendarDate(today)
  const thisMonth = calendarDate(new Date(now.getFullYear(), now.getMonth(), 1))
  const lastMonth = calendarDate(new Date(now.getFullYear(), now.getMonth() - 1, 1))

  return [
    { key: 'this-month', label: 'This month', range: { from: thisMonth, to: now } },
    // Ends the day before this month starts, which is the last day of last month
    // whatever its length — no 28/30/31 arithmetic to get wrong in February.
    { key: 'last-month', label: 'Last month', range: { from: lastMonth, to: addDays(thisMonth, -1) } },
    { key: 'last-90', label: 'Last 90 days', range: { from: addDays(now, -89), to: now } },
    { key: 'this-year', label: 'This year', range: { from: calendarDate(new Date(now.getFullYear(), 0, 1)), to: now } },
  ]
}

/** The range as query parameters, for a link or a form's default values. */
export function rangeParams(range: ReportRange): { from: string; to: string } {
  return { from: toDateInput(range.from), to: toDateInput(range.to) }
}
