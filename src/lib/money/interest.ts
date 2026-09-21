import { type BasisPoints, type Centavos, BPS_DENOMINATOR, centavos, checkedProduct } from './centavos.ts'

/**
 * Interest on a loan.
 *
 *   interest = capital x rate x weeks
 *
 * Simple, never compounding, and always on the original capital — it does not
 * shrink as the loan is paid down, because the loan is repaid in one payment at
 * the end and the total is fixed the day it is created.
 *
 * Nothing here runs on a schedule. The whole figure is computed once, when the
 * admin creates the loan, and never recalculated. "Automated interest
 * computation" in the spec means the app does the arithmetic instead of the
 * admin — not that a job wakes up every week.
 */

export type InterestTerms = {
  capital: Centavos
  rateBps: BasisPoints
  weeks: number
}

function assertTerms({ capital, rateBps, weeks }: InterestTerms): void {
  if (capital <= 0) throw new Error(`Capital must be positive, got ${capital}`)
  if (!Number.isInteger(rateBps) || rateBps < 0) {
    throw new Error(`Rate must be a non-negative whole number of basis points, got ${rateBps}`)
  }
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`A loan runs a whole number of weeks, at least one. Got ${weeks}`)
  }
}

/**
 * The exact interest as a numerator over BPS_DENOMINATOR, before any rounding.
 *
 * Kept separate because the split needs the un-rounded value: rounding each
 * share on its own and adding them up is how the parts stop matching the whole.
 */
export function interestNumerator(terms: InterestTerms): number {
  assertTerms(terms)
  return checkedProduct(terms.capital, terms.rateBps, terms.weeks)
}

/** Interest in whole centavos, rounded half-up. */
export function computeInterest(terms: InterestTerms): Centavos {
  return centavos(Math.round(interestNumerator(terms) / BPS_DENOMINATOR))
}

/** What the borrower hands over on the due date: capital plus interest. */
export function borrowerTotal(terms: InterestTerms): Centavos {
  return centavos(terms.capital + computeInterest(terms))
}
