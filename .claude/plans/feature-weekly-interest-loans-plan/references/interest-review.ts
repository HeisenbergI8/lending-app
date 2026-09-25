// Review of src/lib/money/interest.ts (63 lines) — short, but it holds the
// sentence this whole feature is most likely to be accused of contradicting.

/**
 * "Nothing here runs on a schedule. The whole figure is computed once, when the
 *  admin creates the loan, and never recalculated. 'Automated interest
 *  computation' in the spec means the app does the arithmetic instead of the
 *  admin — not that a job wakes up every week."
 *
 * IMPORTANT: weekly-interest loans do not change this and must not be read as
 * changing it. FEATURES.md §5 says the same thing in its own words: "The
 * arithmetic is exactly the weekly rate of section 2, computed once at creation
 * over the whole term. What changes is WHEN the interest is collected."
 *
 * The distinction to hold on to: the SCHEDULE is derived on read from stored
 * figures (which is cheap, deterministic, and depends on no rate). The INTEREST
 * is not. Nothing wakes up.
 */

export type InterestBasis = 'WEEKLY_RATE' | 'FIXED_AMOUNT'
// NOTE: declared here rather than beside either basis "because the client form
// and the server queries both name it." InterestCollection needs the same
// treatment — the loan form (client) and terms.ts (server) both name it, and the
// client cannot import from src/server/. So the type belongs in src/lib/, not in
// server/loans/terms.ts where the plan's diff implies it.

function assertTerms({ capital, rateBps, weeks }: InterestTerms): void {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`A loan runs a whole number of weeks, at least one. Got ${weeks}`)
  }
}
// NOTE: throws rather than returning a Result, for the same reason weeklySlices
// does — a non-integer week count here is a caller bug, not something the Admin
// typed. The Admin-facing refusal happens once, in terms.ts. Precedent for the
// choice made in Step 1.1.

/**
 * "Kept separate because the split needs the un-rounded value: rounding each
 *  share on its own and adding them up is how the parts stop matching the whole."
 */
export function interestNumerator(terms: InterestTerms): number {
  return checkedProduct(terms.capital, terms.rateBps, terms.weeks)
}

/** Interest in whole centavos, rounded half-up. */
export function computeInterest(terms: InterestTerms): Centavos {
  return centavos(Math.round(interestNumerator(terms) / BPS_DENOMINATOR))
}
// IMPORTANT: this is where Loan.interestCentavos comes from — ONE rounding, over
// the whole term. weeklySlices never calls it. It slices the stored result, so
// the weeks inherit that single rounding rather than performing twenty of their
// own. Twenty roundings of capital x rate x 1 week would not sum to this figure,
// and that is precisely the bug the ordering in plan §1.2 avoids.
