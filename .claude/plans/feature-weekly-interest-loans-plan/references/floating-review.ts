// Review of src/lib/money/floating.ts — the figure this whole feature moves, and
// the file that does NOT change.

/**
 * The formula, and the reason Phase 5 changes the inputs rather than this:
 *
 *   floating = deposits - withdrawals - principal still out on loan + earnings realised
 *
 * "On repayment, capital AND profit both go straight back to floating — there is
 *  no separate 'earned but not withdrawn' bucket."
 *
 * "THE ADMIN IS A LENDER with isSelf = true, so this function serves them too.
 *  Their 2% cut on other people's money arrives through the adminCut fields,
 *  which are zero for everybody else. No branch anywhere asks whose pot this is."
 */

export type LenderLedger = {
  deposits: Centavos
  withdrawals: Centavos
  activePrincipal: Centavos    // "Out of reach until it is [repaid]."
  settledEarnings: Centavos    // "Their own earnings on loans already repaid. In hand."
  pendingEarnings: Centavos    // "on loans still running. Expected, not banked."
  settledAdminCuts: Centavos   // the cut on OTHER funders' principal, loans repaid
  pendingAdminCuts: Centavos
}

export function lenderPosition(ledger: LenderLedger): LenderPosition {
  const earned = centavos(ledger.settledEarnings + ledger.settledAdminCuts)
  const pending = centavos(ledger.pendingEarnings + ledger.pendingAdminCuts)

  return {
    floating: centavos(ledger.deposits - ledger.withdrawals - ledger.activePrincipal + earned),
    outOnLoan: ledger.activePrincipal,
    earned,
    pending,
    // ...
  }
}

// IMPORTANT — THIS IS THE CHECK THAT THE PLAN'S PHASE 5 IS RIGHT, and it is worth
// working through rather than trusting.
//
// FEATURES.md §5 says: "across the loan's life, 'Out on loan' holds steady at
// ₱60,000 while 'Earned' climbs each week it is actually collected."
//
// Reading the formula above: moving one collected week's money from
// pendingEarnings to settledEarnings
//   - raises `earned` by that week                       ✓ Earned climbs
//   - raises `floating` by that week, through `earned`   ✓ released into floating
//   - leaves activePrincipal alone                       ✓ Out on loan holds steady
//   - lowers `pending` by that week                      ✓ no longer expected
//
// All four sentences of the spec fall out of the existing function, given better
// inputs. NOT A LINE OF THIS FILE CHANGES, and that is the evidence that the
// design is right rather than merely workable. A plan that needed to teach
// lenderPosition a new case would be describing a different feature.
//
// The same holds for the Admin's cut through settledAdminCuts / pendingAdminCuts,
// which is the other half of "the Admin's cut into Admin earnings".

// NOTE: floating can come out negative and that is deliberate — "more has been
// lent out than was ever put in ... flooring it at zero would hide exactly the
// situation worth seeing." Nothing in this feature should clamp it, and an
// advance drawn against a weekly loan (see the split.ts review) is a way to make
// it happen.
