import { type Centavos, centavos } from './centavos.ts'
import { addDays, daysBetween } from './weeks.ts'

/**
 * Spreading a loan's interest across the days the money was out.
 *
 * THIS ANSWERS A DIFFERENT QUESTION FROM EVERY OTHER MONEY FIGURE IN THE APP,
 * and the difference is the whole reason it exists. Everywhere else the question
 * is "how much has reached somebody" — cash, decided by which weeks were
 * collected and which loans were repaid (see weekly.ts, releasedOnFunding).
 * Here the question is "how much did this pot earn during March", and a loan
 * running February to April earned in all three months whatever month the money
 * happened to arrive in.
 *
 * On a cash reading, a three-month loan collected at the end shows nothing for
 * two months and a spike in the third. That is true about the cash and useless
 * as a guide to what the pot is earning, which is what the lender is asking.
 *
 * NOTHING HERE RECALCULATES FROM A RATE. The total handed in is
 * LoanFunding.earningsCentavos or LoanFunding.adminCutCentavos, fixed the day
 * the loan was created by split.ts. This only decides which days of the term a
 * fixed amount belongs to. A rate changed next year cannot reach back into a
 * month already reported.
 *
 * THE TERM IS THE AGREED TERM, not however long the borrower actually took. The
 * interest was agreed for `termDays` days, so those are the days it is spread
 * over — a loan repaid early still earned its full interest, and one repaid late
 * did not earn extra. This ledger has no late fee and no early-repayment rebate,
 * so there is nothing else the spread could honestly follow.
 *
 * EVERY PARTITION OF THE TERM SUMS BACK TO THE TOTAL, exactly, in whole
 * centavos. That is what `accruedThrough` being cumulative buys: a range is the
 * difference between two cumulative figures, so January plus February plus March
 * is the same as January to March, and twelve monthly columns add up to the
 * loan's interest with no centavo appearing twice or going missing. Prorating
 * each month independently and rounding each one would not do that.
 */

/**
 * Days of the term that had been worked through the end of `day`.
 *
 * DAY ONE IS THE START DATE. The money is in the borrower's hands on `startOn`,
 * so that day is worked; the last worked day is the one before the due date,
 * which is `termDays` days later. Counting from the day after would leave the
 * whole term one day short and quietly hand the last day's interest to nobody.
 *
 * Clamped at both ends: nothing accrues before the loan starts, and nothing
 * accrues after it is due. A loan dated to start next month therefore
 * contributes nothing to this month, which is the same rule the twelve-month
 * chart follows.
 */
function daysWorkedThrough(startOn: Date, termDays: number, day: Date): number {
  return Math.min(Math.max(daysBetween(startOn, day) + 1, 0), termDays)
}

/**
 * How much of `total` had accrued by the end of `day`. Cumulative from the
 * start of the term, which is what makes the ranges below add up exactly.
 *
 * Floor rather than round, so the running figure can never get ahead of itself
 * and report a centavo the loan has not yet earned. Whatever the flooring leaves
 * behind lands on the final day of the term, the same way weeklySlices leaves
 * the remainder on the final week.
 */
function accruedThrough(total: Centavos, startOn: Date, termDays: number, day: Date): number {
  if (termDays <= 0) return 0
  return Math.floor((total * daysWorkedThrough(startOn, termDays, day)) / termDays)
}

/**
 * What this interest earned between `from` and `to`, both days included.
 *
 * `to` INCLUSIVE, because the admin picking 30 September means the whole of 30
 * September — the same rule report-range.ts states for every other ranged figure
 * on the app. So the range is the cumulative figure at the end of `to` minus the
 * cumulative figure at the end of the day before `from`.
 *
 * Returns zero for a range entirely before or after the term, and for a range
 * typed backwards. The callers all come through parseReportRange, which turns a
 * backwards range the right way round before it gets here.
 */
export function accruedBetween(
  total: Centavos,
  startOn: Date,
  termDays: number,
  from: Date,
  to: Date,
): Centavos {
  if (daysBetween(from, to) < 0) return centavos(0)

  return centavos(
    accruedThrough(total, startOn, termDays, to) -
      accruedThrough(total, startOn, termDays, addDays(from, -1)),
  )
}
