// src/lib/money/split.ts — who earns what on a loan; the largest-remainder rule that loses no centavo.

export type Funding = {
  lenderId: string
  principal: Centavos
  lenderRateBps: BasisPoints
  adminCutBps: BasisPoints // zero when the funder IS the admin
}
export type LoanTerms = { capital: Centavos; borrowerRateBps: BasisPoints; weeks: number; fundings: Funding[] }

// IMPORTANT: pretend loans are priced by this exact function (Phase 3 pretendLoan), so their earnings
// and admin cut are what the loan form would store for the same inputs.
export function splitLoan(terms: LoanTerms): Result<Split, SplitError> { /* ... */ }

// IMPORTANT: private. Phase 1.2 adds an exported `splitByWeight` that calls it twice (weights -> ppm,
// then money), because weight x total can exceed MAX_SAFE_INTEGER.
// Contract: numerators sum to total x denominator; ties break by input order.
function distribute(shares: Share[], total: Centavos, denominator: number): Map<string, Centavos> { /* ... */ }

// NOTE: validate() refuses a non-positive principal row ('non-positive-principal'), so pretend fundings
// whose split share is 0 are filtered out before calling splitLoan.
