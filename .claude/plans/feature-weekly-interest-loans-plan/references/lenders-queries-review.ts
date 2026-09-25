// Review of src/server/lenders/queries.ts (504 lines) — where Floating, Out on
// loan and Earned are actually computed. The most important file in Phase 5.

/**
 * "Floating funds is NEVER read from a column. It is derived on every read from
 *  the transactions and fundings that produced it."
 */

// ---- ledgers(), line ~140: THE function -----------------------------------
// Feeds every Floating / Out on loan / Earned figure in the app, on every screen.
// Two queries for the whole account, aggregated in JS:
//
//   "Aggregation happens in JS rather than SQL deliberately. The sums depend on
//    the loan's status AND on whose cut a row carries — the admin's 2% belongs to
//    the admin, not to the lender the funding row names — which is a join and a
//    CASE in SQL and four additions here. One admin's ledger is hundreds of rows,
//    not millions; clarity wins at this size."
//
// NOTE: that is also the licence for the plan's third query. A `findMany` of the
// weekly payment rows is tens of rows on this account and follows the same
// reasoning, rather than being a new departure.

for (const row of fundings) {
  const settled = row.loan.status === 'PAID'        // <-- IMPORTANT: THE BINARY
                                                    // THAT A WEEKLY LOAN BREAKS.
  if (settled) entry.settledEarnings += row.earningsCentavos
  else {
    entry.activePrincipal += row.principalCentavos
    entry.pendingEarnings += row.earningsCentavos
  }

  // "The cut on this row is the ADMIN's, wherever the principal came from. On a
  //  row the admin funded themselves it is zero, so this needs no branch."
  if (self) {
    if (settled) admin.settledAdminCuts += row.adminCutCentavos
    else admin.pendingAdminCuts += row.adminCutCentavos
  }
}
// A weekly loan is settled AND pending at once: capital out, part of the earnings
// in hand. The plan splits the earnings at the week line and leaves the principal
// alone, which is exactly what FEATURES.md §5 describes.

// ---- buildHistory(), line ~222: the 12-month chart ------------------------
// Rebuilds the pot as it stood at each month end, from the movements:
//
//   "pot at M   = deposits by M - withdrawals by M + earnings realised by M
//    out at M   = principal in loans that had started by M and were not yet repaid"
//
// IMPORTANT, and it is the reason the chart needs the weeks' own dates:
//   "REPAID means a live Payment row dated on or before the month end. A payment
//    that was undone is archived and its loan put back to ACTIVE, so reading the
//    payment rather than the status is the same answer, said in a way that also
//    works for a month that ended before the payment arrived."
//
// That design already reads payments by date rather than reading loan.status, so
// it extends to weekly payments naturally — each collected week lands in the
// month it was collected. The signature needs weeklyPaidOn: Date[] per row.
//
// NOTE: "THE LAST COLUMN IS TODAY, not the end of this month", so the final
// column agrees with the tiles above it. Must stay true after the change.

// ---- getLender(), line ~340 -----------------------------------------------
// The narrowing that six files repeat and the plan extracts into
// server/payments/settled.ts:
const settledOn = (payment: { paidOn: Date; deletedAt: Date | null } | null) =>
  payment && payment.deletedAt === null ? payment.paidOn : null
// "An undone payment is soft-deleted rather than destroyed, so it is still
//  attached to its loan and would otherwise read as money that came back."

fundings: rows.filter((row) => row.state !== 'paid'),   // "where the money is now"
settled:  rows.filter((row) => row.state === 'paid'),   // the track record
// NOTE: a weekly loan stays in `fundings` throughout, and that is correct — its
// capital IS still out with the borrower. No change needed to the partition.

// ---- splitCuts(), line ~294: the Admin's itemised cut ---------------------
//   "SETTLED MEANS THE LOAN IS PAID, and nothing else. That is the very test
//    `ledgers` applies ... so `settled` here sums to position.adminCutEarned and
//    `running` to position.adminCutPending — exactly, always, because they are
//    the same rows added up the same way."
//
// IMPORTANT: Phase 5 makes that sentence false. ledgers() will split the cut at
// the WEEK line while splitCuts splits it at the LOAN line, so a running weekly
// loan's cut sits partly in adminCutEarned while its row is listed under running.
// The tile and the rows beneath it will differ.
//
// NOTE: this screen has already solved this exact class of problem once, and the
// solution is the pattern to follow rather than a new one to invent:
//   "the tiles above carry a cut that belongs to none of the loans listed on this
//    page, because it was charged on other people's capital ... Without this the
//    tile is larger than the rows beneath it by an amount with no row anywhere."
// The answer there was to surface the difference, not to hide it. Same here.

// ---- notYetStarted, line ~483 ---------------------------------------------
// Another difference the screen prints rather than reconciles away:
//   "`position.outOnLoan` counts a loan from the moment it is recorded; the chart
//    counts it from its start date. This is the difference between the two, and
//    it is surfaced rather than reconciled away — the screen has to be able to
//    say why the last column is shorter than the tile above it."
// NOTE: a third instance of the same house habit. Worth pointing an implementer at.

// ---- rates / fixedAmountLoans, line ~470 ----------------------------------
// The profile lists the distinct weekly rates a lender's money runs at, and counts
// the fixed-amount loans separately because they have no rate:
//   "a profile that states a flat '5% a week' is a sentence that quietly becomes
//    false the first time a loan is written at anything else."
// QUESTION: should a weekly-COLLECTED loan be distinguished here too? Its rate is
// the same 5%, so `rates` is not wrong. But "where is John Ross's money right
// now?" has a different answer when part of it comes back every week. Not decided
// by this plan; the spec does not mention the lender profile's rate line.
