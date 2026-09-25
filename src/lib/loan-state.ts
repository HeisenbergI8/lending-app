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
