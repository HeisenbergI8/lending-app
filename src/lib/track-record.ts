/**
 * A borrower's counted track record.
 *
 * "5 loans · 5 paid on time · 0 late" — computed from real history, never stored
 * and never typed in. The admin's own Good/Okay/Bad label sits on top of this and
 * IS stored, because an opinion is not derivable from the loans.
 *
 * Pure, and in lib/ rather than beside the badge that renders it: the same counts
 * go into a PDF statement, which renders no badge at all. A rule that lives in a
 * .tsx file is also a rule `node --test` cannot reach, because Node strips types
 * but does not compile JSX.
 */

export type BorrowerLoanRecord = {
  status: 'ACTIVE' | 'PAID'
  /**
   * THE NEXT DAY MONEY IS OWED, which is Loan.nextDueOn and not always
   * Loan.dueOn. On an ordinary loan the two are the same. On one collecting its
   * interest weekly, the loan is late the moment a WEEK is missed rather than
   * when the capital comes due, and a reader who passes Loan.dueOn here counts
   * a weekly borrower as on time for four months.
   *
   * Both uses below are right with it. A settled loan has nextDueOn back at its
   * own due date — markPaid writes that — so "paid late" still compares the
   * repayment against the day the capital was actually due.
   */
  dueOn: Date
  /** When the repayment actually arrived. Null on an active loan. */
  paidOn: Date | null
}

export type TrackRecord = {
  total: number
  paid: number
  paidOnTime: number
  paidLate: number
  active: number
  /** Active and past its due date. A fact about today, not a stored state. */
  overdue: number
}

/** Midnight, so a comparison is between calendar days rather than instants. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Count the history.
 *
 * Paying ON the due date is on time, not late — the spec's "late is 1-2 days past
 * due" starts the day after. A paid loan with no recorded payment date counts as
 * on time: the admin marked it paid and there is no evidence of lateness, and
 * inventing one would put a black mark on a borrower's record out of nothing.
 * `paid` always equals `paidOnTime + paidLate`, whatever the dates look like.
 */
export function trackRecord(
  loans: BorrowerLoanRecord[],
  now: Date = new Date(),
): TrackRecord {
  const record: TrackRecord = { total: 0, paid: 0, paidOnTime: 0, paidLate: 0, active: 0, overdue: 0 }

  for (const loan of loans) {
    record.total += 1

    if (loan.status === 'PAID') {
      record.paid += 1
      const late = loan.paidOn !== null && startOfDay(loan.paidOn) > startOfDay(loan.dueOn)
      if (late) record.paidLate += 1
      else record.paidOnTime += 1
      continue
    }

    record.active += 1
    if (startOfDay(loan.dueOn) < startOfDay(now)) record.overdue += 1
  }

  return record
}

/**
 * "5 loans · 5 paid on time · 0 paid late", or the honest empty case.
 *
 * Both counts are about loans that have been REPAID, so "0 late" on its own read
 * as "this borrower is not late" — which is a different claim, and a false one
 * for anyone sitting on an unpaid loan past its due date. Nothing else on a PDF
 * statement carries that fact, so a borrower 42 days overdue was described as
 * "1 loan · 0 paid on time · 0 late" and read as clean.
 *
 * Two changes, both wording: "paid late" names which loans are counted, and the
 * overdue tail is appended only when there is something to say. `overdue` is
 * ACTIVE with dueOn before today — a fact about today, so this string is only
 * true on the day it is built. Screens re-render; a printed PDF does not.
 */
export function describeTrackRecord(record: TrackRecord): string {
  if (record.total === 0) return 'No loans yet'
  const loans = record.total === 1 ? '1 loan' : `${record.total} loans`
  const counted = `${loans} · ${record.paidOnTime} paid on time · ${record.paidLate} paid late`
  return record.overdue > 0 ? `${counted} · ${record.overdue} overdue now` : counted
}
