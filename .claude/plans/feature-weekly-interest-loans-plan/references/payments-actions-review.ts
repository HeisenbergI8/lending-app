// Review of src/server/payments/actions.ts (241 lines) — the write path
// markWeekPaid is modelled on, and the upsert Phase 2 breaks.

/**
 * The two rules the new week action inherits verbatim:
 *
 * "FULL PAYMENT ONLY ... the amount is never typed. It is read from the loan,
 *  which means it cannot be mistyped and cannot drift from what was agreed the
 *  day the loan was created."
 *
 * "PROOF IS OPTIONAL BUT FLAGGED. Marking a loan paid with nothing attached is
 *  allowed and shows a warning until a file arrives. Requiring the file would
 *  mean a real repayment going unrecorded because a screenshot was still on
 *  someone else's phone."
 *
 * NOTE: a weekly payment is not a partial payment and does not contradict
 * FEATURES.md §12. No single amount is ever paid in parts — a week is paid whole
 * or not at all.
 */

// ---- IMPORTANT: the trap CONVENTIONS.md names, reused not copied -----------
/**
 * "Put the files in the bucket BEFORE anything is written to the database.
 *
 *  The order matters. Files first means a failure leaves nothing recorded and the
 *  admin simply tries again; rows first would leave a payment claiming proof that
 *  is not there. Anything already uploaded when a later file fails is removed, so
 *  a retry does not silently leave orphans behind in a bucket nobody looks at."
 */
async function uploadAll(userId: string, paymentId: string, files: File[]): Promise<Upload[]> {
  const done: Upload[] = []
  try { /* ... */ return done }
  catch (error) {
    await Promise.all(done.map((u) => removeProof(u.path).catch(() => undefined)))
    throw error
  }
}
function filesFrom(form: FormData, field: string): File[] { /* drops the empty File */ }
// IMPORTANT: both are module-private today. Step 3.4 imports them from a
// payments/uploads.ts. It must be an EXTRACTION, not a copy — two copies of the
// cleanup loop is two chances to lose one, on the one path that touches a private
// bucket.

// ---- The upsert Phase 2 breaks --------------------------------------------
/**
 * "The payment row is upserted rather than created, because undoing a payment
 *  soft-deletes the row instead of destroying it and `Payment.loanId` is unique —
 *  a loan marked paid, undone and paid again must reuse the row it already has."
 */
await tx.payment.upsert({
  where: { loanId },                              // <-- IMPORTANT: requires the
  create: { id: paymentId, /* ... */ },           // unique index. Compile error
  update: { paidOn, amountCentavos, deletedAt: null },  // after Step 2.1.
})
// The composite loanId_weekNumber key Prisma generates will not accept null for
// weekNumber, so it becomes findFirst + create/update. The GUARANTEE is unchanged:
// the partial unique index still allows only one settling row per loan.
//
// IMPORTANT: the "reuse the row it already has" reasoning applies to a WEEK too.
// An undone week leaves an archived row occupying (loanId, weekNumber), so
// markWeekPaid must find-then-write exactly as this does. A plain `create`
// passes every test written against a clean loan and throws the first time the
// Admin corrects a mistake. Filed High.

// ---- undoPayment ----------------------------------------------------------
await tx.payment.updateMany({ where: { loanId, userId: user.id }, data: { deletedAt: new Date() } })
await tx.loan.update({ where: { id: loanId }, data: { status: 'ACTIVE' } })
// IMPORTANT: unscoped by week. On a weekly loan this would archive TWENTY
// collected weeks along with the February payment — money that really was
// received, erased by one button. Must gain `weekNumber: null`.
//
// "The files are left attached rather than deleted alongside: if the payment was
//  recorded in error the screenshots usually still belong to it."

// ---- What markPaid does NOT check, and must ------------------------------
if (loan.status === 'PAID') return failed('That loan is already marked paid.')
// QUESTION -> now an Issue: there is no check that earlier weeks are paid. On a
// weekly loan, February settles the loan AND is the final week. With weeks 12 and
// 13 never collected, this would move the loan to PAID carrying two weeks nobody
// recorded, and the borrower's track record would read "paid on time".
// One call to nextUnpaidWeek is the guard. Filed High.

// ---- amountCentavos -------------------------------------------------------
amountCentavos: loan.totalCentavos   // "Never typed. The total was fixed the day
                                     //  the loan was created."
// IMPORTANT: on a weekly loan this is wrong — February is the capital plus the
// FINAL WEEK only, not the whole total, because nineteen weeks are already in.
// FEATURES.md §5: "February is ONE payment: capital plus that final week's
// interest." Getting this wrong double-counts nineteen weeks on one row, and the
// Excel Payments sheet would add up to nearly twice what was received.

// ---- refresh --------------------------------------------------------------
revalidatePath('/', 'layout')
// NOTE: correct and reused unchanged. A collected week moves the dashboard, the
// lender profile, the borrower profile and the loans list at once.
