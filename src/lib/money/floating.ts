import { type Centavos, centavos } from './centavos.ts'

/**
 * Floating funds — a lender's idle cash.
 *
 * NEVER STORED. Every figure here is derived from the transactions and loans
 * that produced it, on every read. A stored balance is a number that can drift
 * away from its own history, and when it does there is no way to tell which of
 * the two is wrong.
 *
 *   floating = deposits - withdrawals - principal still out on loan + earnings realised
 *
 * The spec's version reads "deposits - withdrawals - principal out + principal
 * repaid + earnings". It is the same sum: principal that came back is simply no
 * longer out. Subtracting only what is still out says it in one step instead of
 * two, and removes the chance of counting the return twice.
 *
 * On repayment, capital AND profit both go straight back to floating — there is
 * no separate "earned but not withdrawn" bucket. When Angel repays her ₱30,000
 * loan, John Ross's floating rises by ₱36,000: his capital plus his ₱6,000.
 *
 * THE ADMIN IS A LENDER with isSelf = true, so this function serves them too.
 * Their 2% cut on other people's money arrives through the adminCut fields,
 * which are zero for everybody else. No branch anywhere asks whose pot this is.
 */

export type LenderLedger = {
  /** Money the lender put in. */
  deposits: Centavos
  /** Money the lender took out. */
  withdrawals: Centavos
  /** Their principal in loans that have not been repaid. Out of reach until it is. */
  activePrincipal: Centavos
  /** Their own earnings on loans already repaid. In hand. */
  settledEarnings: Centavos
  /** Their own earnings on loans still running. Expected, not banked. */
  pendingEarnings: Centavos
  /** The admin's cut on OTHER funders' principal, loans repaid. Zero for a plain lender. */
  settledAdminCuts: Centavos
  /** The same cut on loans still running. Zero for a plain lender. */
  pendingAdminCuts: Centavos
}

export type LenderPosition = {
  /** Idle cash, available to lend today. */
  floating: Centavos
  /** Principal currently in borrowers' hands. */
  outOnLoan: Centavos
  /** Profit actually received — already part of `floating`. */
  earned: Centavos
  /** Profit owed on loans still running. Deliberately NOT part of `floating`. */
  pending: Centavos
  deposits: Centavos
  withdrawals: Centavos
}

export const EMPTY_LEDGER: LenderLedger = {
  deposits: centavos(0),
  withdrawals: centavos(0),
  activePrincipal: centavos(0),
  settledEarnings: centavos(0),
  pendingEarnings: centavos(0),
  settledAdminCuts: centavos(0),
  pendingAdminCuts: centavos(0),
}

/**
 * Work out where a lender's money stands today.
 *
 * `floating` can come out NEGATIVE, and that is not a bug to clamp away. It means
 * more has been lent out than was ever put in — the admin covering a loan from
 * money that has not arrived. Showing it below zero is the only way the admin
 * finds out; flooring it at zero would hide exactly the situation worth seeing.
 */
export function lenderPosition(ledger: LenderLedger): LenderPosition {
  const earned = centavos(ledger.settledEarnings + ledger.settledAdminCuts)
  const pending = centavos(ledger.pendingEarnings + ledger.pendingAdminCuts)

  return {
    floating: centavos(ledger.deposits - ledger.withdrawals - ledger.activePrincipal + earned),
    outOnLoan: ledger.activePrincipal,
    earned,
    pending,
    deposits: ledger.deposits,
    withdrawals: ledger.withdrawals,
  }
}
