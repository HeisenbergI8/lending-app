// Review of src/server/deleted/purge.ts (204 lines) — the daily job that really
// destroys data. Reviewed to establish whether weekly payments need anything.

/**
 * "TWO RULES SHAPE EVERYTHING BELOW.
 *
 *  1. FILES BEFORE ROWS. A proof file lives half in Postgres and half in the
 *     bucket. Deleting the row first would strand the file with nothing left
 *     pointing at it — a private screenshot of somebody's payment, paid for
 *     forever, invisible to the app that is supposed to be looking after it. So
 *     the bucket goes first, and if the bucket will not answer, the row STAYS and
 *     tomorrow's run tries again. A day late is free; an orphaned file is not.
 *
 *  2. NOTHING LIVE IS TAKEN DOWN WITH IT."
 */

// ---- Step 2: undone payments ---------------------------------------------
const payments = await db.payment.findMany({
  where: expired,                                   // { userId?, deletedAt: { lt: cutoff } }
  select: { id: true, proofFiles: { select: { id: true, storagePath: true } } },
})
// "Their proof rows go with them by cascade, so their files have to leave the
//  bucket first — all of them, not just deleted ones."
//
// NOTE: THIS NEEDS NO CHANGE. The where clause is on deletedAt and says nothing
// about weekNumber, so an undone WEEK is collected by exactly this pass, with its
// proof files, thirty days after it was undone. A LoanWeek table would have
// needed its own step here, with its own files-before-rows loop.

// ---- Step 4: loans, line ~114 --------------------------------------------
const loans = await db.loan.findMany({
  where: expired,
  select: { id: true, payment: { select: { proofFiles: { ... } } } },   // <-- to-one
})
clearOwners(loans.map((loan) => ({ id: loan.id, proofFiles: loan.payment?.proofFiles ?? [] })))
// IMPORTANT — the one real change in this file, and it is a silent one if missed.
// A deleted loan cascades to ALL its payments and their proof files. Today the
// select reaches one payment; on a weekly loan there are twenty, each possibly
// with screenshots. Converted to `payments` it must FLATTEN every payment's files,
// not take the first:
//
//   proofFiles: loan.payments.flatMap((p) => p.proofFiles)
//
// Taking payments[0] would type-check, delete the loan, cascade nineteen payments
// and their proof rows out of Postgres, and leave nineteen sets of private
// screenshots in the Supabase bucket with nothing pointing at them. Exactly the
// failure rule 1 exists to prevent, and nothing would report it.
//
// "Deleting a Loan, by contrast, is meant to cascade: the schema takes its
//  funding split, its payment and that payment's proof rows with it, because
//  those describe the loan and mean nothing without it."

// ---- What is NOT affected -------------------------------------------------
// The held-borrower / held-lender logic (onDelete: Restrict) is about people, not
// payments. Unchanged.
// The bucketReady short-circuit — "a run that cannot do that half of the job
// should not do the other half either" — unchanged.

// NOTE: tests/deleted/window.test.ts covers purgeCutoff only, not this file. The
// flatMap above is therefore uncovered by any test, which is worth knowing when
// deciding how carefully to read that one line.
