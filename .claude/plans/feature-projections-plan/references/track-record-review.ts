// src/lib/track-record.ts — counts a borrower's history: paid on time / paid late / overdue.

// The existing "on time" rule. Phase 2 reuses its two decisions:
//   - paying ON the due calendar day is on time (late starts the day after);
//   - a loan closed by an extension (capital carried on as a new loan) is neither.
if (loan.closedByExtension) continue
if (loan.status === 'PAID') {
  const late = loan.paidOn !== null && startOfDay(loan.paidOn) > startOfDay(loan.dueOn)
  // ...
}

// IMPORTANT: this rule compares against the loan's CURRENT due date — for an extended loan, the date the
// extension moved it to. The Projections on-time measure now does exactly the same (owner, 2026-11-08:
// an extension is agreed, not late). "On time" therefore means one thing across the app.

// NOTE: a PAID loan with paidOn null counts as on time here. The Projections measure reads Payment.paidOn,
// which is NOT NULL in the schema, so that case cannot arise there.
