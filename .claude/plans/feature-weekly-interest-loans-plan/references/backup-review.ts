// Review of src/server/reports/backup.ts (339 lines) — the Excel backup, whose
// Payments sheet FEATURES.md §5 requires to carry one row per weekly payment.

/**
 * "NOT A REPORT. Every other thing under Reports answers a question about a
 *  period ... This is the opposite: every loan on the account, whenever it
 *  started ... It exists so the Admin can download one file a month and stop
 *  keeping a list by hand."
 *
 * "NOTHING HERE RECOMPUTES MONEY. Capital, interest and total are the columns
 *  stored when the loan was made; the Admin's share comes from adminTakeOnLoan,
 *  the same function the loan screen shows 'Admin interest' from."
 */

// ---- The single resolution that keeps every sheet agreeing, line 121 ------
const live = loans.map((loan) => ({
  ...loan,
  payment: loan.payment?.deletedAt === null ? loan.payment : null,
}))
// "An undone payment is archived but still attached to its loan. Resolving it
//  once here is what keeps every sheet below agreeing about whether a loan was
//  repaid."
// IMPORTANT: this stays, for the settling payment, and gains the live weekly list
// beside it. Resolving in one place is the property worth preserving — four sheets
// read from `live`.

// ---- Payments sheet, line ~186: THE sheet that changes shape --------------
const paymentRows = live
  .filter((loan) => loan.payment !== null)     // <-- ONE ROW PER LOAN today
  .map((loan) => [
    loan.borrowerName,
    day(payment.paidOn),
    pesos(centavos(payment.amountCentavos)),
    payment.proofFiles.length,
    // "The path inside the storage bucket, not a link. The file itself is never
    //  in the database and a signed link would be dead within the hour."
    payment.proofFiles.map((p) => p.storagePath).join(', '),
    day(payment.createdAt),
    loan.id,
  ])
// IMPORTANT: becomes a flatMap over each loan's live payments. FEATURES.md §5.
// NOTE: "Money is written as numbers with a peso format, so columns add up in
// Excel" (§9). A weekly loan with one row for its total would make the Amount
// column add up to more than was received across the whole file.
//
// A "What" column is proposed so a reader can tell week 7 from February. Without
// it the sheet shows twenty near-identical ₱4,200 rows and one large one, with
// nothing saying which is which.

// ---- Loans sheet, line ~130 ------------------------------------------------
loanState(loan.status, loan.dueOn, now) === 'overdue' ? 'Yes' : null
// <-- must pass nextDueOn. This is call site 11 of the loanState table.
// "Overdue is ACTIVE with a due date already past — a fact about the day the file
//  was made, not a column. Recomputing it from Due tomorrow gives a different
//  answer, which is why the Read me sheet dates the file."

daysLate(loan.dueOn, paidOn, now)
// QUESTION: on a weekly loan, days late against WHAT? The earliest unpaid week is
// the honest answer and matches the Overdue column beside it. Against the capital
// date it would read null while three weeks are owed. The plan uses nextDueOn for
// both; worth a reviewer's eye because the column header says only "Days late".

rateFraction(loan.borrowerRateBps)   // "Blank rather than 0%, which would read as
                                     //  a rate somebody chose."

// ---- Read me sheet, line ~300 ---------------------------------------------
// "The card on the Reports page says the period does not apply ... Six months
//  from now the file is on a hard drive and the card is not, so it says it here
//  too."
['Payments sheet', 'Repayments that stand. A payment that was undone is not here and its loan reads Active.']
// IMPORTANT: this line becomes false the moment a weekly loan is in the file —
// "repayments" is not what the sheet holds any more. It must be rewritten, and a
// weekly-loans line added, or the next monthly backup looks like a duplication bug
// to whoever opens it.
//
// NOTE: the Read me already follows CONVENTIONS.md's "a claim that ages carries
// the date it was measured" rule — 'Overdue and Days late' says "Worked out
// against 2026-09-24 ... these two go stale; every other column does not."
// Any new claim added here should carry the same treatment.

// ---- What is deliberately absent, per the file's header -------------------
//   Deleted loans, payments and proofs. "A backup that included them would not
//   agree with any screen."
//   An undone payment. "Paid on and Amount paid are blank unless the payment is
//   live, and the loan reads Active — which is what the loan screen says too."
// NOTE: an undone WEEK must be excluded on the same principle, which is why the
// weekly flatMap filters deletedAt === null rather than trusting `live`.
