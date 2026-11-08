// src/lib/money/floating.ts — a lender's idle cash, derived and never stored; and the "is the money there" check.

// floating = deposits - withdrawals - principal still out + earnings realised (incl. Admin cut on the Admin pot).
// NOTE: can be negative, and is never clamped. The engine's month-end `cash` follows the same rule.

// IMPORTANT: the shortfall rule a real new loan must pass. Phase 3 calls it for each month's planned
// pretend loans, so "not enough free cash" means the same thing in the estimate as on the loan form.
export function shortfalls(
  shares: { lenderId: string; principal: Centavos }[],
  floatingOf: (lenderId: string) => Centavos,
): Shortfall[] {
  // totals per lender first, then: total > floating => short
}

// NOTE: advances (LenderTransaction with loanId) are ordinary withdrawals in this ledger, so they are
// already inside today's floating figure. The estimate does not predict future advances (owner-visible
// limitation, Phase 2 issues).
