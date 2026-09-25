// Review of src/server/loans/queries.ts (524 lines) — COPIES 3 AND 4 of the
// overdue rule, plus two money figures and the loan detail the schedule hangs off.

/**
 * The file's own statement of what is derived and what is not:
 *
 * "Every figure on a loan — weeks, interest, total, each funder's earnings — was
 *  computed once when it was created and stored. Nothing here recalculates any of
 *  it ... The one thing that IS derived is the state: overdue is ACTIVE with a
 *  due date in the past."
 */

// ---- COPY 3: loanWhere, line ~127 -----------------------------------------
export function loanWhere(userId: string, filter: LoanFilter) {
  const today = calendarDate(new Date())

  const dueOn = {
    ...(filter.from ? { gte: filter.from } : {}),
    ...(filter.to ? { lte: filter.to } : {}),
    ...(filter.status === 'overdue' ? { lt: today } : {}),          // <-- COPY 3
    // "An active loan is one not yet due, so the range's own `gte` is tightened
    //  to today rather than replaced — both bounds have to hold, and the later of
    //  the two is the one that does the work."
    ...(filter.status === 'active'
      ? { gte: filter.from && filter.from > today ? filter.from : today }
      : {}),
  }
  // IMPORTANT: the date range and the status filter share ONE column today. On a
  // weekly loan they stop meaning the same thing — the range means the capital
  // date the Admin typed, the status means the earliest unpaid week. The plan
  // splits them onto dueOn and nextDueOn, which also drops the `active` branch's
  // interaction with `from`. On every AT_END loan the result is identical.
  // tests/loans/loan-where.test.ts exists and is the evidence.
}

// ---- COPY 4: the separate overdue count, line ~243 ------------------------
db.loan.count({ where: { AND: [where, { status: 'ACTIVE', dueOn: { lt: today } }] } })
// NOTE the comment above it, which must be preserved when the column changes:
//   "AND, never a spread. Spreading `where` and then setting `status: 'ACTIVE'`
//    OVERRIDES the filter instead of narrowing it, and under the Paid chip that
//    made the Overdue tile report an active loan that was not in the list at all."

// ---- Why nextDueOn is a column and not a subquery -------------------------
// The file argues its own performance design at length, and it is the argument
// against deriving "earliest unpaid week" per row:
//
//   "THREE QUERIES, IN PARALLEL, AND NONE OF THEM READS THE WHOLE TABLE. The rows
//    come back one page at a time, and the two figure queries are aggregates that
//    Postgres answers from the `userId, status, deletedAt` and `dueOn` indexes
//    without handing any rows to Node. The previous version fetched every matching
//    loan WITH its funding rows and added them up here, which is the shape that
//    works at nine loans and stops working at nine thousand."
//
// IMPORTANT: a correlated subquery over Payment in loanWhere would be run by the
// findMany, the groupBy, the count and overdueSummary's two aggregates. That is
// the paging design undone. It is the whole justification for the stored column.

// Also note the tiebreaker, which the plan's orderBy change must keep:
//   orderBy: [{ status: 'asc' }, { dueOn: 'asc' }, { id: 'asc' }]
//   "if the sort does not decide every pair of rows ... one loan appears twice and
//    another is never shown. With real data this showed up immediately: 86 loans,
//    85 distinct, because several shared a due date."
// Swapping dueOn for nextDueOn keeps id as the tiebreaker. It must stay.

// ---- Money figure 1: listLoans().totals.outstanding, line ~289 ------------
outstanding: centavos(active?._sum.totalCentavos ?? 0)
// "The tiles say 'still to collect', not 'still to collect on this page'."
// IMPORTANT: on a weekly loan totalCentavos includes every week, including the
// ones already in hand. Overstates by exactly what has been collected.

// ---- Money figure 2: interestSummary, line ~322 ---------------------------
// The comment records a MEASUREMENT, in the form CONVENTIONS.md's reporting rules
// ask for, and it is worth quoting because the plan's change must not break it:
//
//   "MEASURED, not assumed, on 2026-09-22 against the demo account: SUM over
//    Loan.interestCentavos for non-deleted loans came to exactly the same figure
//    as SUM(LoanFunding.earningsCentavos) + SUM(LoanFunding.adminCutCentavos)
//    over the same loans ... One number, one source."
//
// `collected` is that sum restricted to status = PAID. IMPORTANT: on a weekly loan
// the interest is collected for months before the loan is PAID, so `collected`
// understates and `pending` overstates by the same amount — and the Floating tile
// on the SAME SCREEN will include that money. Two tiles disagreeing about the
// same pesos is the failure this file's comments are written to prevent.
//
// QUESTION: the plan adds SUM(Payment.amountCentavos) over weekly rows on ACTIVE
// loans. That is a SECOND route to a figure ledgers() reaches by slicing the
// funding rows. They agree as long as markWeekPaid writes the schedule's amount.
// A reconciliation entry should prove it rather than the comment asserting it.

// ---- getLoan, line ~400 ---------------------------------------------------
// Selects payment: { paidOn, deletedAt, proofFiles }, fundings with both rates and
// both money columns, notes, and advances. Everything weeklySchedule needs is
// ALREADY FETCHED except the week numbers of the payments — one more field on a
// select that is already there.
//
// The narrowing the plan replaces with a shared helper:
const payment = loan.payment?.deletedAt === null ? loan.payment : null
// "Prisma cannot filter a to-one relation in a select, so an undone payment is
//  dropped here instead."
// NOTE: once loanId is not unique this becomes an array and Prisma CAN filter it
// in the select — `payments: { where: { deletedAt: null, weekNumber: null } }`.
// The limitation the comment describes goes away, which is a small win.

// IMPORTANT: adminStakeInLoan is called here with `advanced` summed from live
// advance rows. This is the caller that must subtract released weekly earnings —
// see split-review.ts. High severity.
