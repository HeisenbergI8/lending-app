// src/lib/track-record.ts — counts a borrower's history: paid on time / paid late / overdue.

// The existing "on time" rule. Phase 2 reuses its two decisions:
//   - paying ON the due calendar day is on time (late starts the day after);
//   - a loan closed by an extension (capital carried on as a new loan) is neither.
if (loan.closedByExtension) continue
if (loan.status === 'PAID') {
  const late = loan.paidOn !== null && startOfDay(loan.paidOn) > startOfDay(loan.dueOn)
  // ...
}

// IMPORTANT: this rule compares against Loan.nextDueOn / the MOVED due date of an extended loan.
// The Projections on-time measure deliberately uses the ORIGINAL due date (earliest
// LoanExtension.fromDueOn) — a difference raised as owner question Q1.
// QUESTION: is it acceptable that "on time" differs between the borrower record and the estimate?

// NOTE: a PAID loan with paidOn null counts as on time here. The Projections measure reads Payment.paidOn,
// which is NOT NULL in the schema, so that case cannot arise there.
