// Review of src/server/loans/actions.ts (493 lines) — create, edit, undo.

/**
 * "THE ARITHMETIC HAPPENS ONCE, HERE, and the answers are written to the row.
 *  Nothing recalculates afterwards and no job runs weekly — 'automated interest
 *  computation' in the spec means the app does the sums so the admin does not,
 *  not that a scheduler wakes up."
 *
 * IMPORTANT: weekly-interest loans do NOT change this. FEATURES.md §5: "Nothing
 * recalculates; there is still no background job." The schedule is carved out of
 * figures decided here, on the day the loan is made. §12 still lists "a weekly
 * background job recalculating interest" as out of scope.
 */

// ---- createLoan -----------------------------------------------------------
// Writes Loan + LoanFunding rows in one transaction, with the borrower and any
// new lender created inside it:
//   "Creating them first and then failing on the dates would leave a person in
//    the list who was never lent anything."
// NOTE: interestCollection and nextDueOn slot into the existing data object. No
// structural change.

borrowerRateBps: input.interest.basis === 'WEEKLY_RATE' ? input.interest.borrowerRateBps : null
// "Null on a fixed-amount loan, because no rate was used."

// ---- updateLoan: two things the plan must add ----------------------------
/**
 * "Every figure is computed again from scratch, because that is what 'entered
 *  wrong' means — the old numbers were answers to the wrong question. The funding
 *  rows are replaced rather than patched, so a funder removed from the form is
 *  removed from the loan.
 *
 *  A PAID loan is refused. Its payment records a total that was agreed and handed
 *  over; changing the total underneath it would leave the two disagreeing with
 *  nothing to say which is right."
 */
if (existing.status === 'PAID') return failed('A loan that has been paid cannot be edited.')

// IMPORTANT 1 — nextDueOn cannot be taken from loanTerms on an edit. loanTerms
// answers for a NEW loan, which has no paid weeks, so it returns start + 1 week.
// A weekly loan with six weeks collected would be reset to owing week 1, and the
// Admin would see money she has received go back onto the "still owed" side.

// IMPORTANT 2 — the PAID refusal has a weekly sibling that does not exist yet.
// Shortening a weekly loan below its highest paid week leaves a Payment row
// pointing at a week the loan no longer has. Exactly the situation the quoted
// paragraph describes, one week at a time rather than all at once.
//
// NOTE: the funding rows are DELETED AND RECREATED on every edit:
await tx.loanFunding.deleteMany({ where: { loanId, userId: user.id } })
await tx.loanFunding.createMany({ data: terms.value.fundings.map(/* ... */) })
// Which means earningsCentavos and adminCutCentavos CHANGE on an edit — and those
// are exactly what weeklySchedule slices. A loan edited after six weeks were
// collected gets a new schedule, and the six collected rows keep the amounts they
// were collected at. The two need not agree any more.
//
// QUESTION for the owner, and the plan does not decide it: after such an edit,
// should the collected weeks be re-priced, left alone, or should the edit be
// refused outright the way a PAID loan is? "Left alone" is what the code does if
// nobody chooses, and it is defensible — the money really was collected at those
// amounts — but it means the weeks no longer sum to interestCentavos. The
// shortening guard above covers the worst case; this is the subtler one.

// ---- resolveFunders -------------------------------------------------------
// "isSelf is read from the row rather than taken from the form: whether money is
//  the admin's own decides what rate it earns, and that is not something a form
//  should be able to claim."
// NOTE: the conversion action reads the funding rows straight from the database
// and never takes a lender id from the form, so it inherits this for free.

// ---- LoanRefused ----------------------------------------------------------
class LoanRefused extends Error {}
// "Inside $transaction the only way to abort is to throw, but a refusal is not a
//  crash — the form needs to render it."
// NOTE: convertToWeekly does its checks BEFORE opening the transaction, so it does
// not need this. Worth not copying it in out of habit.

// ---- deleteLoan / restoreLoan --------------------------------------------
// Soft delete on the Loan only; Payment rows are not touched and come back with
// it. A weekly loan's twenty payments restore whole, because they hang off the
// loan and the loan is what was hidden. No change needed — another dividend of
// generalising Payment rather than adding a table.
