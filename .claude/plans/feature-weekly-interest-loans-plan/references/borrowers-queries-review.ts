// Review of src/server/borrowers/queries.ts (340 lines) — the borrower profile
// and the list, both of which print what a borrower owes.

// ---- SUMMARY_ROW, line ~64: the borrowers list ---------------------------
const SUMMARY_ROW = {
  loans: {
    where: { deletedAt: null },
    select: {
      status: true,
      dueOn: true,              // <-- must become nextDueOn (feeds trackRecord)
      totalCentavos: true,
      // "deletedAt comes back so an UNDONE payment can be dropped: the loan is
      //  running again, and it must not count as paid in the track record."
      payment: { select: { paidOn: true, deletedAt: true } },   // <-- to-many
    },
  },
}
// "The rule for what counts as on time lives in `trackRecord`, so the loans are
//  fetched and counted rather than re-expressed as SQL — a second implementation
//  of 'paid late' is a second answer waiting to disagree with the PDF statement,
//  which uses the same function."
// NOTE: that discipline is why the overdue fix here is one field, not a rewrite.

// ---- toSummary().outstanding, line ~108 ----------------------------------
outstanding: centavos(
  borrower.loans.filter((l) => l.status === 'ACTIVE').reduce((s, l) => s + l.totalCentavos, 0),
)
// IMPORTANT: this is "what Angel owes", shown beside her name on the borrowers
// list and on the dashboard. On a weekly loan fifteen weeks in, it overstates by
// fifteen weeks of interest that has already been handed over.
//
// NOTE: `topBorrowers` ranks by this figure and the ranking is done by Postgres —
// see the dashboard comment, "This screen used to load EVERY borrower with EVERY
// loan and payment and sort them in JavaScript." Subtracting the collected weeks
// must not quietly move that sort back into JS. It is an aggregate over Payment,
// which Postgres can do.

// ---- getBorrower, line ~260 ----------------------------------------------
// Selects each loan with its payment and proof files. The narrowing, written as a
// generic here and as a plain arrow in four other files — which is the repetition
// the plan's server/payments/settled.ts collapses:
const livePayment = <T extends { deletedAt: Date | null }>(loan: { payment: T | null }): T | null =>
  loan.payment?.deletedAt === null ? loan.payment : null
// "An undone payment is soft-deleted rather than destroyed, and Prisma cannot
//  filter a to-one relation in a select — so it is dropped here."
// NOTE: once it is a to-many, Prisma CAN filter it in the select. The limitation
// this comment describes goes away.

state: loanState(loan.status, loan.dueOn),      // <-- call site, must pass nextDueOn
missingProof: livePayment(loan) !== null && livePayment(loan)!.proofFiles.length === 0

// QUESTION: the borrower profile lists each loan with its due date. On a weekly
// loan, which date? FEATURES.md §5 settles it for the Active Loans list (the next
// unpaid week) and for the loan page (both), and says nothing about the borrower
// profile. The profile is a history of what this person borrowed, so the capital
// date reads more naturally there — but then the badge beside it says Overdue for
// a date that is months away, which looks like a bug. Not decided by this plan.
// Listing both, as the loan page does, is the safe answer.

// NOTE: paid loans stay on the profile forever (FEATURES.md §4, "that history is
// the point"). A settled weekly loan keeps its twenty payment rows, so the
// profile can show the whole collection history if it is ever wanted.
