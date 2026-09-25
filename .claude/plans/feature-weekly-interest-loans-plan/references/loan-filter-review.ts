// Review of src/lib/loan-filter.ts (115 lines) — what the status chips mean, and
// why Phase 4's split of dueOn / nextDueOn is a filter change and not a UI one.

/** "The one-tap filters from the spec. They are loan states, not a second
 *  vocabulary." */
export type LoanStatusFilter = 'active' | 'overdue' | 'paid'

export type LoanFilter = {
  query: string
  amount: Centavos | null
  terms: string[]
  from: Date | null      // "Due on or after this day."
  to: Date | null        // "Due on or before this day."
  status: LoanStatusFilter | null
}
// IMPORTANT: `from` and `to` are documented as being about the DUE date. On a
// weekly loan the Admin has two due dates and this type says nothing about which.
// The plan binds the range to the capital date (Loan.dueOn) and the status to the
// next owed date (Loan.nextDueOn), on the grounds that the range is the date the
// Admin typed and remembers.
//
// QUESTION for the owner: filtering "due in October" will not surface a weekly
// loan whose weeks fall in October but whose capital is due in January. That is
// the right answer to the question as asked, and it is surprising. Nothing on the
// search form says which date it means.

/**
 * NOTE: the shape of the whole file, and the reason nothing here changes:
 *
 * "The search lives in the query string rather than in component state on
 *  purpose: a filtered list is then a link. It survives a reload, it can be sent
 *  to yourself, and the page stays a plain server component."
 *
 * "Pure, and in lib/ rather than beside the page, because a .tsx file cannot be
 *  imported by `node --test`."
 */

export function parseLoanFilter(params): LoanFilter {
  // "Anything unrecognised is dropped rather than refused — a hand-edited or stale
  //  URL should show the list, not an error page."
  // "A range typed backwards is the same range. Correcting it beats showing an
  //  empty list to someone who filled the boxes in the order they read."
  // NOTE: no change. The filter's SHAPE is untouched by this feature; only which
  // column loanWhere() applies each part to moves.
}

// ---- The page-reset rule, worth not breaking -----------------------------
export function loanFilterHref(filter, change = {}, page = 1): string {}
// "`page` defaults to 1 and is left out at 1, so CHANGING the filter resets the
//  paging by simply not carrying it: tapping a chip while on page 4 of the old
//  search would otherwise land on page 4 of a shorter list."

// NOTE: tests/loans/loan-filter.test.ts and tests/loans/loan-where.test.ts both
// exist. Neither knows about weekly loans, and both should stay green — which is
// the evidence that Phase 4's split changes nothing for the loans that already
// exist. If loan-where.test.ts goes red, it is describing the old `active`/`from`
// interaction, and whether that interaction should survive is the owner's call
// rather than the implementer's.
