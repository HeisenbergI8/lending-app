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

/** What can be wrong with the funding itself, whatever the loan charges. */
export type FundingError =
  | { kind: 'no-fundings' }
  | { kind: 'fundings-do-not-match-capital'; capital: Centavos; funded: Centavos; difference: Centavos }
  | { kind: 'non-positive-principal'; lenderId: string; principal: Centavos }
  | { kind: 'duplicate-lender'; lenderId: string }

export type SplitError =
  | FundingError
  | { kind: 'rates-do-not-match-borrower-rate'; lenderId: string; lenderRateBps: number; adminCutBps: number; borrowerRateBps: number }

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
 * The first invariant, and it holds for every loan: the fundings add up to
 * exactly the capital. Not more, not less — money that does not come from a
 * funder does not exist.
 */
function validateFundings(
  capital: Centavos,
  fundings: { lenderId: string; principal: Centavos }[],
): FundingError | null {
  if (fundings.length === 0) return { kind: 'no-fundings' }

  const seen = new Set<string>()
  for (const f of fundings) {
    if (seen.has(f.lenderId)) return { kind: 'duplicate-lender', lenderId: f.lenderId }
    seen.add(f.lenderId)

    if (f.principal <= 0) {
      return { kind: 'non-positive-principal', lenderId: f.lenderId, principal: f.principal }
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

/**
 * The second invariant, and it belongs to weekly-rate loans alone: on every row,
 * lenderRate + adminCut equals the borrower's rate. That is what guarantees the
 * shares add back up to the interest charged. Without it the admin could be
 * silently over- or under-paying every lender and nothing would look wrong.
 *
 * A fixed-amount loan has no rates to reconcile — the admin typed the interest
 * and the lenders' share of it — so splitFixed carves the figures out of the
 * typed total instead, which cannot drift for the same reason.
 */
function validate(terms: LoanTerms): SplitError | null {
  const funding = validateFundings(terms.capital, terms.fundings)
  if (funding) return funding

  for (const f of terms.fundings) {
    if (f.lenderRateBps + f.adminCutBps !== terms.borrowerRateBps) {
      return {
        kind: 'rates-do-not-match-borrower-rate',
        lenderId: f.lenderId,
        lenderRateBps: f.lenderRateBps,
        adminCutBps: f.adminCutBps,
        borrowerRateBps: terms.borrowerRateBps,
      }
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
 *
 * `denominator` is the scale the numerators are expressed over, and the whole
 * contract is that they sum to `total x denominator`. A rate loan weighs its
 * rows by principal x rate x weeks over BPS_DENOMINATOR; a fixed-amount loan
 * weighs them by amount x principal over the capital. Same arithmetic, same
 * guarantee, one function.
 */
function distribute(shares: Share[], total: Centavos, denominator: number): Map<string, Centavos> {
  const floors = shares.map((s) => ({
    key: s.key,
    base: Math.floor(s.numerator / denominator),
    remainder: s.numerator % denominator,
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
  return distribute(chargeable, adminEarnings, BPS_DENOMINATOR)
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

  const allocation = distribute(shares, totalInterest, BPS_DENOMINATOR)
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
 * A loan whose interest is a peso amount the admin typed, not a rate.
 *
 * Some loans do not fit a weekly rate at all: three days, or a figure agreed
 * with the borrower in conversation. ₱3,000 over three days for ₱500 is not 7%
 * of anything, and forcing it through a rate would either round the term to a
 * week or invent a percentage nobody agreed to.
 *
 * So both figures are typed. The admin says what the borrower pays on top, and
 * how much of that the lenders keep between them. WHAT IS LEFT IS THE ADMIN'S —
 * it is never a third typed number, because a third number can disagree with the
 * first two and then the loan does not add up.
 */
export type FixedFunding = { lenderId: string; principal: Centavos; isSelf: boolean }

export type FixedTerms = {
  capital: Centavos
  /** The whole interest the borrower pays on top of the capital. Typed, not derived. */
  interest: Centavos
  /** How much of that interest the lenders keep between them. The remainder is the Admin's. */
  lenderInterest: Centavos
  fundings: FixedFunding[]
}

export type FixedSplitError =
  | FundingError
  | { kind: 'non-positive-interest'; interest: Centavos }
  | { kind: 'lender-share-exceeds-interest'; lenderInterest: Centavos; interest: Centavos }
  | { kind: 'lender-share-without-lenders' }

/**
 * Work out what every party earns on a fixed-amount loan.
 *
 * Returns the SAME Split as the rate version, so nothing downstream — the loan
 * page, the lender ledgers, the reports — needs to know which kind of loan it is
 * looking at. Only the two typed figures differ; everything after them is the
 * same arithmetic with the same guarantee that the parts sum to the whole.
 */
export function splitFixed(terms: FixedTerms): Result<Split, FixedSplitError> {
  const { capital, interest, lenderInterest, fundings } = terms

  const invalid = validateFundings(capital, fundings)
  if (invalid) return err(invalid)

  if (interest <= 0) return err({ kind: 'non-positive-interest', interest })
  if (lenderInterest < 0 || lenderInterest > interest) {
    return err({ kind: 'lender-share-exceeds-interest', lenderInterest, interest })
  }

  // The Admin pot is left out of this draw on purpose. The lenders' share was
  // set aside for the people who are owed a share, and the admin's own money is
  // not one of them — it takes its part through the remainder below instead.
  const lenderRows = fundings.filter((f) => !f.isSelf)
  if (lenderInterest > 0 && lenderRows.length === 0) {
    return err({ kind: 'lender-share-without-lenders' })
  }

  const lenderCapital = lenderRows.reduce<number>((sum, f) => sum + f.principal, 0)
  const lenderEarnings =
    lenderInterest > 0
      ? distribute(
          lenderRows.map((f) => ({
            key: f.lenderId,
            numerator: checkedProduct(lenderInterest, f.principal),
          })),
          lenderInterest,
          lenderCapital,
        )
      : new Map<string, Centavos>()

  // Everything the lenders did not take is the admin's. It is spread across
  // EVERY row by principal so each row can say what was earned on it, and lands
  // as earnings on the admin's own row and as the cut on anybody else's —
  // exactly where a weekly-rate loan puts it, so the ledgers need no new branch.
  const adminAmount = centavos(interest - lenderInterest)
  const adminShares =
    adminAmount > 0
      ? distribute(
          fundings.map((f) => ({
            key: f.lenderId,
            numerator: checkedProduct(adminAmount, f.principal),
          })),
          adminAmount,
          capital,
        )
      : new Map<string, Centavos>()

  const lenders: LenderShare[] = fundings.map((f) => {
    const adminShare = adminShares.get(f.lenderId) ?? centavos(0)
    return {
      lenderId: f.lenderId,
      principal: f.principal,
      earnings: centavos((lenderEarnings.get(f.lenderId) ?? 0) + (f.isSelf ? adminShare : 0)),
      adminCut: f.isSelf ? centavos(0) : adminShare,
    }
  })

  return ok({
    totalInterest: interest,
    borrowerTotal: centavos(capital + interest),
    lenders,
    // Added up from the rows rather than taken as interest - lenderInterest,
    // because the admin's own funding row carries its share as earnings. Both
    // routes give the same figure; this one cannot double-count it.
    adminEarnings: centavos(lenders.reduce((sum, l) => sum + l.adminCut, 0)),
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

/**
 * The same figure, read back from the funding rows a loan was stored with.
 *
 * `adminTotalEarnings` answers it for a split being computed; this answers it
 * for a loan already in the database, where the cut was carved out once and
 * written down. Both the loan screen and the reports ask the question, and the
 * answer must not depend on which of them is asking — so it is written once,
 * here, beside the split that produced the numbers.
 *
 * Nothing is recomputed from a rate. The cut on a row the admin funded
 * themselves is zero, so their own capital's earnings are added rather than
 * double-counted, and no branch has to ask whose money it was.
 */
export function adminTakeOnLoan(
  fundings: { adminCut: Centavos; earnings: Centavos; isSelf: boolean }[],
): Centavos {
  return centavos(
    fundings.reduce(
      (total, funding) => total + funding.adminCut + (funding.isSelf ? funding.earnings : 0),
      0,
    ),
  )
}
