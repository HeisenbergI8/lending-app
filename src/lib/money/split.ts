import {
  type BasisPoints,
  type Centavos,
  BPS_DENOMINATOR,
  centavos,
  checkedProduct,
} from './centavos.ts'
import { computeInterest } from './interest.ts'
import { type Result, ok, err } from './result.ts'

/**
 * Who earns what on a loan.
 *
 * The borrower is charged one rate. That rate is split: the lender whose money
 * funded the loan takes most of it, the admin keeps a cut. A loan can be funded
 * by several lenders at once, and each earns on their own contribution.
 *
 *   Angel borrows ₱30,000 for 4 weeks at 7%/week.
 *   Funded entirely by John Ross at 5%, admin cut 2%.
 *     interest  = 30,000 x 7% x 4 = ₱8,400   Angel repays ₱38,400
 *     John Ross = 30,000 x 5% x 4 = ₱6,000
 *     admin     = 30,000 x 2% x 4 = ₱2,400
 *
 * The admin funding a loan with their own money looks like a special case and is
 * not one: the admin is a lender row whose lenderRate is the full borrower rate
 * and whose adminCut is zero. No branch anywhere asks whose money it is.
 */

export type Funding = {
  lenderId: string
  principal: Centavos
  /** What this funder earns per week on their own principal. */
  lenderRateBps: BasisPoints
  /** What the admin takes per week on this funder's principal. Zero when the funder IS the admin. */
  adminCutBps: BasisPoints
}

export type LoanTerms = {
  capital: Centavos
  borrowerRateBps: BasisPoints
  weeks: number
  fundings: Funding[]
}

export type SplitError =
  | { kind: 'no-fundings' }
  | { kind: 'fundings-do-not-match-capital'; capital: Centavos; funded: Centavos; difference: Centavos }
  | { kind: 'rates-do-not-match-borrower-rate'; lenderId: string; lenderRateBps: number; adminCutBps: number; borrowerRateBps: number }
  | { kind: 'non-positive-principal'; lenderId: string; principal: Centavos }
  | { kind: 'duplicate-lender'; lenderId: string }

export type LenderShare = {
  lenderId: string
  principal: Centavos
  earnings: Centavos
  /**
   * The admin's cut taken on THIS row's principal. Zero when the funder is the
   * admin themselves, who pays no cut to anyone.
   *
   * Worked out here rather than by the caller, and that is the whole point.
   * Rounding each row independently — principal x cut x weeks, rounded — gives a
   * set of numbers that need not add up to `adminEarnings`, and the loan then
   * fails to reconcile by a centavo or two with nothing to show why. These are
   * carved out of the admin's total by the same largest-remainder rule, so they
   * sum to it exactly, always.
   */
  adminCut: Centavos
}

export type Split = {
  /** Total interest charged to the borrower. */
  totalInterest: Centavos
  /** Capital + interest — what the borrower repays. */
  borrowerTotal: Centavos
  lenders: LenderShare[]
  /** The admin's cut only. If the admin also funded the loan, that shows in `lenders`. */
  adminEarnings: Centavos
}

/**
 * Both invariants that keep a split honest.
 *
 * 1. The fundings add up to exactly the capital. Not more, not less — money that
 *    does not come from a funder does not exist.
 * 2. On every row, lenderRate + adminCut equals the borrower's rate. This is what
 *    guarantees the shares add back up to the interest charged. Without it the
 *    admin could be silently over- or under-paying every lender and nothing would
 *    look wrong.
 */
function validate(terms: LoanTerms): SplitError | null {
  const { capital, borrowerRateBps, fundings } = terms

  if (fundings.length === 0) return { kind: 'no-fundings' }

  const seen = new Set<string>()
  for (const f of fundings) {
    if (seen.has(f.lenderId)) return { kind: 'duplicate-lender', lenderId: f.lenderId }
    seen.add(f.lenderId)

    if (f.principal <= 0) {
      return { kind: 'non-positive-principal', lenderId: f.lenderId, principal: f.principal }
    }
    if (f.lenderRateBps + f.adminCutBps !== borrowerRateBps) {
      return {
        kind: 'rates-do-not-match-borrower-rate',
        lenderId: f.lenderId,
        lenderRateBps: f.lenderRateBps,
        adminCutBps: f.adminCutBps,
        borrowerRateBps,
      }
    }
  }

  const funded = fundings.reduce<number>((sum, f) => sum + f.principal, 0)
  if (funded !== capital) {
    return {
      kind: 'fundings-do-not-match-capital',
      capital,
      funded: centavos(funded),
      difference: centavos(funded - capital),
    }
  }

  return null
}

type Share = { key: string; numerator: number }

/**
 * Hand out whole centavos in proportion to each share's exact value, losing none.
 *
 * ₱8,400 does not always divide evenly. Flooring each share drops the remainders
 * and the parts no longer sum to the whole; rounding each share independently can
 * overshoot it. Largest-remainder does neither: floor everything, then give the
 * leftover centavos one at a time to whoever was cut by the most.
 *
 * Ties break by position, so the same loan always splits the same way. A split
 * that shuffles its remainder between runs is a reconciliation bug waiting to
 * happen, and an untestable one.
 */
function distribute(shares: Share[], total: Centavos): Map<string, Centavos> {
  const floors = shares.map((s) => ({
    key: s.key,
    base: Math.floor(s.numerator / BPS_DENOMINATOR),
    remainder: s.numerator % BPS_DENOMINATOR,
  }))

  const allocated = floors.reduce((sum, f) => sum + f.base, 0)
  let leftover = total - allocated

  if (leftover < 0 || leftover > floors.length) {
    throw new Error(
      `Remainder distribution went wrong: ${leftover} centavos left over across ` +
        `${floors.length} shares. This is a bug in the money module, not bad input.`,
    )
  }

  const order = floors
    .map((f, index) => ({ ...f, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  const result = new Map<string, Centavos>()
  for (const f of floors) result.set(f.key, centavos(f.base))

  for (const f of order) {
    if (leftover === 0) break
    result.set(f.key, centavos((result.get(f.key) as number) + 1))
    leftover -= 1
  }

  return result
}

const ADMIN_SHARE_KEY = '\u0000admin'

/**
 * Break the admin's total cut back down to the rows it was earned on.
 *
 * A second pass over the SAME total, never a fresh calculation: the figure being
 * divided is the one already allocated, so the parts cannot add up to anything
 * else. Rows the admin takes no cut on are left out of the draw entirely rather
 * than given a weight of zero — a zero-weight row can still win a leftover
 * centavo on a tie, and a centavo of cut on the admin's own capital is a cut
 * they are charging themselves.
 */
function adminCutPerRow(fundings: Funding[], weeks: number, adminEarnings: Centavos): Map<string, Centavos> {
  const chargeable = fundings
    .map((f) => ({ key: f.lenderId, numerator: checkedProduct(f.principal, f.adminCutBps, weeks) }))
    .filter((share) => share.numerator > 0)

  if (chargeable.length === 0 || adminEarnings === 0) return new Map()
  return distribute(chargeable, adminEarnings)
}

/** Work out what every party earns, or why the loan's funding does not add up. */
export function splitLoan(terms: LoanTerms): Result<Split, SplitError> {
  const invalid = validate(terms)
  if (invalid) return err(invalid)

  const { capital, borrowerRateBps, weeks, fundings } = terms

  const totalInterest = computeInterest({ capital, rateBps: borrowerRateBps, weeks })

  const shares: Share[] = fundings.map((f) => ({
    key: f.lenderId,
    numerator: checkedProduct(f.principal, f.lenderRateBps, weeks),
  }))

  const adminNumerator = fundings.reduce(
    (sum, f) => sum + checkedProduct(f.principal, f.adminCutBps, weeks),
    0,
  )
  shares.push({ key: ADMIN_SHARE_KEY, numerator: adminNumerator })

  const allocation = distribute(shares, totalInterest)
  const adminEarnings = allocation.get(ADMIN_SHARE_KEY) as Centavos
  const cuts = adminCutPerRow(fundings, weeks, adminEarnings)

  return ok({
    totalInterest,
    borrowerTotal: centavos(capital + totalInterest),
    lenders: fundings.map((f) => ({
      lenderId: f.lenderId,
      principal: f.principal,
      earnings: allocation.get(f.lenderId) as Centavos,
      adminCut: cuts.get(f.lenderId) ?? centavos(0),
    })),
    adminEarnings,
  })
}

/**
 * What the admin actually takes home: their cut, plus their earnings as a funder
 * if they put their own money in.
 */
export function adminTotalEarnings(split: Split, adminLenderId: string | null): Centavos {
  const asLender = adminLenderId
    ? (split.lenders.find((l) => l.lenderId === adminLenderId)?.earnings ?? 0)
    : 0
  return centavos(split.adminEarnings + asLender)
}
