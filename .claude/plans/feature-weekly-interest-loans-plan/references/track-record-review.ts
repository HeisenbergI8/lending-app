// Review of src/lib/track-record.ts — COPY 2 OF 4 of the overdue rule.

export type BorrowerLoanRecord = {
  status: 'ACTIVE' | 'PAID'
  dueOn: Date          // IMPORTANT: must become the NEXT date money is owed.
  paidOn: Date | null
}

export function trackRecord(loans: BorrowerLoanRecord[], now: Date = new Date()): TrackRecord {
  for (const loan of loans) {
    if (loan.status === 'PAID') {
      // "Paying ON the due date is on time, not late — the spec's 'late is 1-2
      //  days past due' starts the day after."
      const late = loan.paidOn !== null && startOfDay(loan.paidOn) > startOfDay(loan.dueOn)
      // ...
      continue
    }
    record.active += 1
    if (startOfDay(loan.dueOn) < startOfDay(now)) record.overdue += 1   // <-- COPY 2
  }
}

// IMPORTANT: two callers feed this, and they must agree because one of them
// prints a PDF the Admin hands to somebody:
//   src/server/borrowers/queries.ts  SUMMARY_ROW -> toSummary, and getBorrower
//   src/server/reports/queries.ts:667 borrowerReport
// Both currently select loan.dueOn. Both must select loan.nextDueOn.
//
// The file's own comment is the reason it is one function and not two:
//   "the same counts go into a PDF statement, which renders no badge at all."

// QUESTION — and it is a real one for a weekly loan, not a nitpick.
//
// `paidOn` on a weekly loan is the SETTLING payment's date — February. The late
// test compares that against dueOn. But a borrower who missed six weekly payments
// and then paid the capital on the exact day is, by this function, "paid on time".
// Every week they were late is invisible in the counted record.
//
// FEATURES.md §7 says the counted track record is "how often this person borrows,
// and whether they pay", and §5 says a missed week makes the loan Overdue. Whether
// six missed weeks should leave a mark on the record after the loan settles is a
// question the spec does not answer, and this plan does not decide it — the
// arithmetic above is left alone and only the date it compares is changed.
//
// Raised here rather than in the plan's Follow Ups because it is about what a
// track record MEANS, which is the owner's call and not a defect in this feature:
// the same loan collected at the end would behave identically.

// NOTE: describeTrackRecord() builds a sentence printed onto PDFs, and its comment
// already warns that `overdue` "is a fact about today, so this string is only true
// on the day it is built. Screens re-render; a printed PDF does not." A weekly
// loan makes that staler faster — the count can change every week rather than once.
