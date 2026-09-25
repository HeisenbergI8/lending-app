// Review of src/server/reports/queries.ts (741 lines) — all five reports' money.
// FEATURES.md §9 lists four; admin-cut was added since. Not a gap.

/**
 * The rule the whole file is built on, and the reason the plan does not let a
 * report do its own weekly arithmetic:
 *
 * "Nothing here computes money that the app already computes elsewhere ... A
 *  report that did its own arithmetic would be a second opinion about the same
 *  pesos, and the admin would have no way to tell which one to believe when they
 *  disagreed."
 *
 * And the distinction every figure is labelled by:
 *
 * "IN THIS PERIOD — events whose own date falls in the range: loans by the day
 *  they started, payments by the day they arrived ...
 *  AS OF TODAY — floating funds, what is still out, what a borrower owes."
 *
 * NOTE: a collected week is squarely an IN THIS PERIOD event with its own date.
 * The vocabulary already fits; nothing conceptual has to be invented.
 */

// ---- The four `where` clauses that must gain weekNumber: null -------------
// IMPORTANT: this is the single highest-risk conversion in Phase 2. Turning a
// to-one `payment: {...}` into `payments: { some: {...} }` type-checks perfectly
// WITHOUT the week filter, and then a loan whose week 3 was paid in March is
// reported as REPAID in March — capital counted as returned, five months early.

summaryReport:  payment: { deletedAt: null, paidOn: period }                    // :298
adminCutReport: OR: [{ startOn: period }, { payment: { deletedAt: null, paidOn: period } }]  // :400
lenderReport:   OR: [{ startOn: period }, { payment: { deletedAt: null, paidOn: period } }]  // :506
lenderReport:   loan: { deletedAt: null, payment: { deletedAt: null, paidOn: period } }      // :532

// ---- summaryReport, line ~325 ---------------------------------------------
collected: sum(paid.map((loan) => loan.totalCentavos))
earned: sum(paid.map((loan) => adminTakeOnLoan(loan.fundings.map(/* ... */))))
// "The admin's take on a repaid loan comes from the same rule the loan screen
//  uses — see adminTakeOnLoan. A report must not be a second opinion."
// IMPORTANT: both are keyed on loans REPAID in the period. Weeks collected in the
// period are money that arrived and appear in neither.
//
// outOnLoan / floating come from listLenders(), so they follow Phase 5 for free.
// That is the payoff of the file's no-second-opinion rule.

// ---- adminCutReport, line ~459 --------------------------------------------
// "TWO SECTIONS, BECAUSE THE TWO ARE NOT THE SAME MONEY. A loan that started in
//  March promises the Admin a cut; a loan repaid in March hands one over. Rolled
//  into one figure they read as a month's profit, and a month of heavy lending
//  with nothing collected would report a fortune that has not arrived."
//
// NOTE: a weekly loan is precisely the case that distinction was invented for,
// arriving in twenty pieces. `agreed` (cut on loans started) is unaffected.
// `collected` misses the weeks. `outstandingToday` sums the cut across every
// ACTIVE loan and so DOUBLE-COUNTS the weeks already released into Admin earnings.

outstandingToday: sum(running.map((loan) => cutOf(loan.fundings)))   // IMPORTANT

// ---- lenderReport, line ~588 ----------------------------------------------
earnedInPeriod: centavos(sum(repaid.map((f) => f.earningsCentavos)) + adminCutInPeriod)
// The comment records a bug already fixed once here, and it is the same shape as
// the one weekly loans introduce:
//   "Summing only this lender's funding rows reported a statement short by exactly
//    SUM('adminCutCentavos'), with no line anywhere admitting the gap."
// IMPORTANT: a lender's statement will now be short by exactly the weeks collected
// in the period, with no line admitting THAT gap. FEATURES.md §5 is explicit that
// this report must list the weekly payments.

// `outWith` (where their money is today) comes from getLender().fundings, so a
// weekly loan stays on it throughout — correct, the capital is still out.

// ---- borrowerReport, line ~640 --------------------------------------------
// No range filter in the query: "a borrower's file is a handful of rows, and the
// record and what they owe are counted across ALL of them."
paidInPeriod: sum(loans.filter((l) => inRange(l.paidOn, range)).map((l) => l.total))
owedToday: sum(borrower.loans.filter((l) => l.status === 'ACTIVE').map((l) => l.totalCentavos))
// IMPORTANT: `owedToday` is the borrower-facing "what Angel owes". On a weekly
// loan fifteen weeks in it overstates by fifteen weeks of interest already handed
// over — on a statement the Admin gives the borrower. Of every figure in this
// plan, this is the one most likely to be argued about by a human being.

record: trackRecord(borrower.loans.map((l) => ({ status, dueOn: l.dueOn, paidOn })))
// <-- must become nextDueOn. See track-record-review.ts. The comment beside it is
// worth keeping true: "a track record that changed with the dates on a report
// would not be a track record."

// ---- buildPreview, line ~230 ----------------------------------------------
// Buckets rows by month for the chart above each PDF. Fed the report's OWN rows:
//   "so the preview cannot disagree with the PDF that follows it."
// NOTE: on a lender statement the preview is fed `funded` (loans started), not
// payments, so it is unaffected. On a borrower report likewise. No change needed,
// which is worth stating so it is not changed anyway.

// QUESTION: should a weekly loan's preview show interest arriving month by month
// rather than all in the month the loan started? The chart is captioned as loans
// STARTED in the period, so as it stands it is honest. Not decided by this plan.
