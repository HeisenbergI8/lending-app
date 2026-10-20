/**
 * What state a loan is in today.
 *
 * Pure, and in lib/ rather than beside the badge that renders it, for two
 * reasons. It is a rule about loans, not about presentation — the same answer
 * drives a report and a notification, neither of which renders a badge. And a
 * .tsx file cannot be imported by `node --test`, because Node strips types but
 * does not compile JSX; rules that live in a component are rules that cannot be
 * tested without a browser.
 *
 * OVERDUE IS NOT STORED ANYWHERE. It is ACTIVE with a due date in the past — a
 * fact about today, not a state someone has to remember to write down. A stored
 * flag would need a job to flip it, and would be wrong every night until that
 * job ran.
 *
 * ON A WEEKLY LOAN THE DATE IS NOT THE LOAN'S DUE DATE. A loan collecting its
 * interest every week is late the moment a WEEK is missed, months before the
 * capital is due, and it stays late until that week is paid — the next week
 * piles on top rather than replacing it. So what is compared is the earliest
 * unpaid week, which nextUnpaidWeek in money/weekly.ts decides and
 * Loan.nextDueOn caches for the queries that have to ask it in SQL.
 *
 * THE RULE BELOW IS UNTOUCHED. What changed is which date the caller hands it,
 * and on every AT_END loan — which is every loan that is not collected weekly —
 * that is still the due date.
 */

import { addDays, daysBetween, storedCalendarDate } from './money/weeks.ts'

export type LoanState = 'paid' | 'overdue' | 'due-today' | 'due-soon' | 'active'

const DAY_MS = 86_400_000
/** Within this many days, a loan is worth flagging before it is actually late. */
export const DUE_SOON_DAYS = 3

/** Midnight on a date, so comparisons are between calendar days, not instants. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function loanState(
  status: 'ACTIVE' | 'PAID',
  /** The next day money is owed. Loan.nextDueOn — which equals dueOn at the end. */
  nextDueOn: Date,
  now: Date = new Date(),
): LoanState {
  if (status === 'PAID') return 'paid'

  // Calendar days, not elapsed milliseconds. A loan due today must read "due
  // today" whether it is checked at breakfast or at one minute to midnight, and
  // a daylight-saving shift must not move a due date by a day.
  const days = Math.round((startOfDay(nextDueOn) - startOfDay(now)) / DAY_MS)

  if (days < 0) return 'overdue'
  if (days === 0) return 'due-today'
  if (days <= DUE_SOON_DAYS) return 'due-soon'
  return 'active'
}

/**
 * The same rule, for a `nextDueOn` straight out of the database.
 *
 * EVERY PRODUCTION CALLER WANTS THIS ONE. `Loan.nextDueOn` is a `@db.Date`, so
 * the driver hands it back at midnight UTC and its calendar day is in the UTC
 * parts. `loanState` above compares LOCAL parts, which is right for a date built
 * from a form or a test and a day early for a date column: west of London a loan
 * due TODAY read as overdue, and the overdue list on the summary report grew a
 * row that was not late at all.
 *
 * `loanState` is left alone rather than fixed in place because it is also given
 * ordinary local dates — its own tests pass `new Date(2026, 8, 21, 0, 1)` to
 * prove the time of day cannot shift the answer. A conversion inside it would be
 * wrong for those. So the two conventions get two functions, exactly as
 * `inRange` and `storedDayInRange` do, and the choice at each call site is a
 * question with one right answer: did this date come out of a `date` column?
 */
export function storedLoanState(
  status: 'ACTIVE' | 'PAID',
  nextDueOn: Date,
  now: Date = new Date(),
): LoanState {
  return loanState(status, storedCalendarDate(nextDueOn), now)
}

/** The longest gap the "Remind me every" setting accepts, in weeks. */
export const MAX_REMIND_WEEKS = 52

/**
 * THE NEXT REMINDER DAY on a loan the Admin asked to be reminded about every
 * `everyWeeks` weeks (owner, 2026-10-20), or null when there is none.
 *
 * Counted from the start date: start + N weeks, start + 2N weeks, and so on.
 * The first one on or after `today` is the answer. A reminder that would land on
 * or after the due date is dropped, because from there the real due date is
 * what the badge shows. All three dates are calendar days at midday.
 */
export function nextReminderOn(startOn: Date, dueOn: Date, everyWeeks: number | null, today: Date): Date | null {
  if (!everyWeeks || everyWeeks < 1) return null
  const period = everyWeeks * 7
  const since = daysBetween(startOn, today)
  const step = Math.max(1, Math.ceil(since / period))
  const on = addDays(startOn, step * period)
  return daysBetween(on, dueOn) > 0 ? on : null
}

/**
 * A loan's state with its reminder taken into account — what every badge on
 * screen shows.
 *
 * The reminder can only RAISE a loan that would otherwise read 'active' to
 * 'due-soon', inside the same DUE_SOON_DAYS window, the reminder day itself
 * included. Overdue, due today and a real due-soon always win: those are about
 * money owed, a reminder is only a nudge. `reminderOn` is set only when the
 * reminder is the reason for the badge, so the row can say "Reminder <day>"
 * instead of the due date.
 *
 * All dates as they come out of `date` columns (midnight UTC), like
 * storedLoanState.
 */
export function storedLoanStateWithReminder(
  loan: { status: 'ACTIVE' | 'PAID'; nextDueOn: Date; startOn: Date; dueOn: Date; remindEveryWeeks: number | null },
  now: Date = new Date(),
): { state: LoanState; reminderOn: Date | null } {
  const state = storedLoanState(loan.status, loan.nextDueOn, now)
  if (state !== 'active') return { state, reminderOn: null }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const on = nextReminderOn(storedCalendarDate(loan.startOn), storedCalendarDate(loan.dueOn), loan.remindEveryWeeks, today)
  if (on && daysBetween(today, on) <= DUE_SOON_DAYS) return { state: 'due-soon', reminderOn: on }
  return { state, reminderOn: null }
}
