import { type BasisPoints, type Centavos, parsePesos } from '../../lib/money/centavos.ts'
import { type InterestBasis, type InterestCollection } from '../../lib/money/interest.ts'
import {
  type FixedSplitError,
  type FundingError,
  type Split,
  splitFixed,
  splitLoan,
} from '../../lib/money/split.ts'
import { type Result, ok, err } from '../../lib/money/result.ts'
import { MIN_WEEKLY_WEEKS } from '../../lib/money/weekly.ts'
import {
  DAYS_PER_WEEK,
  addDays,
  describeTermError,
  describeWeeksError,
  termDaysBetween,
  weeksBetween,
} from '../../lib/money/weeks.ts'

/**
 * Turning a filled-in loan form into the numbers that get stored.
 *
 * Pure — no database, no Next.js, no request. It takes what the admin typed and
 * either returns every figure the loan needs or says, in words meant for a
 * person, which part does not work.
 *
 * It is separate from the action that writes the row so that the whole of the
 * loan's arithmetic can be tested without a database, and so the form and the
 * server cannot disagree about what a set of inputs means — both go through
 * here. The rules it enforces come straight from FEATURES.md sections 2 and 5.
 *
 * A loan charges interest one of two ways, and the choice is per loan:
 *
 *   WEEKLY_RATE   the usual. capital x rate x weeks, and the dates must land on
 *                 whole weeks because the week count is a multiplier.
 *   FIXED_AMOUNT  the admin types the interest and the lenders' share of it, and
 *                 the loan may run any number of days. For the three-day loan
 *                 that no weekly rate describes honestly.
 */

/** The default spread. All three are per week, and the last two are set PER LOAN. */
export const DEFAULT_BORROWER_RATE_BPS = 700
export const DEFAULT_ADMIN_CUT_BPS = 200

export type FunderInput = {
  lenderId: string
  /** The lender's own pot, which earns the full borrower rate and pays no cut. */
  isSelf: boolean
  principal: Centavos
}

export type { InterestBasis, InterestCollection }

/**
 * How this loan charges interest, with the figures that go with it.
 *
 * A discriminated union rather than every field on one object, because the two
 * halves are not both meaningful at once: a fixed-amount loan has no weekly
 * rate, and storing 0 for it would render as "0% a week" on the loan page.
 */
export type InterestInput =
  | { basis: 'WEEKLY_RATE'; borrowerRateBps: BasisPoints; adminCutBps: BasisPoints }
  | { basis: 'FIXED_AMOUNT'; interest: Centavos; lenderInterest: Centavos }

export type LoanInput = {
  capital: Centavos
  startOn: Date
  dueOn: Date
  interest: InterestInput
  /**
   * Whether the interest is collected weekly or all at the end. Read from the
   * form, defaulted by the caller, and refused below on a loan that cannot
   * carry it.
   */
  collection: InterestCollection
  funders: FunderInput[]
}

/** One funding row as it will be stored. The rates are null on a fixed-amount loan. */
export type FundingTerms = {
  lenderId: string
  principal: Centavos
  lenderRateBps: BasisPoints | null
  adminCutBps: BasisPoints | null
  earnings: Centavos
  adminCut: Centavos
}

export type LoanTermsResult = {
  /**
   * The term in DAYS, for every loan. Weeks are derived from it for display and
   * for the rate arithmetic; storing both would be two columns that can disagree.
   */
  termDays: number
  interest: Centavos
  total: Centavos
  /**
   * The next day money is owed. On an AT_END loan it is the due date; on a
   * WEEKLY loan, one week after the start, because a new loan has no paid weeks.
   *
   * Computed here rather than in the action so that the one rule deciding
   * Loan.nextDueOn lives beside the one deciding termDays — two answers about
   * the same pair of dates, from the same place.
   */
  nextDueOn: Date
  split: Split
  fundings: FundingTerms[]
}

/**
 * The rates a single funder's money runs at.
 *
 * THE ADMIN IS NOT A SPECIAL CASE. Their own capital earns the full borrower
 * rate and pays a cut of zero; a lender's earns the borrower rate less the cut.
 * Both come out of the same two lines, and both satisfy the invariant the split
 * checks — lenderRate + adminCut == borrowerRate — which is what makes the
 * shares add back up to the interest charged.
 */
function ratesFor(funder: FunderInput, borrowerRateBps: BasisPoints, adminCutBps: BasisPoints) {
  return {
    lenderRateBps: funder.isSelf ? borrowerRateBps : borrowerRateBps - adminCutBps,
    adminCutBps: funder.isSelf ? 0 : adminCutBps,
  }
}

/**
 * Every figure a loan needs, or the first thing wrong with it.
 *
 * The error is a sentence the admin can act on, not a code. A refusal here is
 * the app doing its job — a due date that is not a whole number of weeks would
 * change what a rate-charged borrower owes, so it is stopped rather than
 * rounded.
 */
export function loanTerms(input: LoanInput): Result<LoanTermsResult, string> {
  if (input.capital <= 0) return err('Enter a capital amount greater than zero.')
  if (input.funders.length === 0) return err('Say whose money is funding this loan.')

  return input.interest.basis === 'WEEKLY_RATE'
    ? weeklyRateTerms(input, input.interest)
    : fixedAmountTerms(input, input.interest)
}

function weeklyRateTerms(
  input: LoanInput,
  rates: Extract<InterestInput, { basis: 'WEEKLY_RATE' }>,
): Result<LoanTermsResult, string> {
  const { capital, startOn, dueOn, funders } = input
  const { borrowerRateBps, adminCutBps } = rates

  if (!Number.isInteger(borrowerRateBps) || borrowerRateBps <= 0) {
    return err('Enter a borrower rate greater than zero.')
  }
  if (!Number.isInteger(adminCutBps) || adminCutBps < 0) {
    return err('Enter a cut of zero or more.')
  }
  if (adminCutBps > borrowerRateBps) {
    return err('The Admin cut cannot be larger than what the borrower is charged.')
  }

  const weeks = weeksBetween(startOn, dueOn)
  if (!weeks.ok) return err(describeWeeksError(weeks.error))

  // A one-week loan collected weekly is a one-week loan. Its single instalment
  // would fall on the due date and carry the capital with it, which is the
  // ordinary loan the app already makes — so this is refused as a mistake
  // rather than accepted as a second way to spell the same thing.
  if (input.collection === 'WEEKLY' && weeks.value < MIN_WEEKLY_WEEKS) {
    return err('A loan collected weekly runs at least two weeks. This one is one week.')
  }

  const split = splitLoan({
    capital,
    borrowerRateBps,
    weeks: weeks.value,
    fundings: funders.map((funder) => ({
      lenderId: funder.lenderId,
      principal: funder.principal,
      ...ratesFor(funder, borrowerRateBps, adminCutBps),
    })),
  })
  if (!split.ok) return err(describeSplitError(split.error, capital))

  return ok(
    assemble(
      split.value,
      weeks.value * DAYS_PER_WEEK,
      funders,
      (funder) => ratesFor(funder, borrowerRateBps, adminCutBps),
      // A brand new weekly loan owes its first week one week after it started.
      // Nothing is paid yet, so there is no schedule to consult.
      input.collection === 'WEEKLY' ? addDays(startOn, DAYS_PER_WEEK) : dueOn,
    ),
  )
}

function fixedAmountTerms(
  input: LoanInput,
  amounts: Extract<InterestInput, { basis: 'FIXED_AMOUNT' }>,
): Result<LoanTermsResult, string> {
  const { capital, startOn, dueOn, funders } = input

  // FEATURES.md section 5: only a weekly-rate loan can be weekly-collected. A
  // fixed amount has no week count to instal against, and the whole-weeks rule
  // that guarantees the schedule divides evenly does not apply to it.
  if (input.collection === 'WEEKLY') {
    return err('A loan charging a fixed amount of interest cannot be collected weekly.')
  }

  const termDays = termDaysBetween(startOn, dueOn)
  if (!termDays.ok) return err(describeTermError(termDays.error))

  const split = splitFixed({
    capital,
    interest: amounts.interest,
    lenderInterest: amounts.lenderInterest,
    fundings: funders.map((funder) => ({
      lenderId: funder.lenderId,
      principal: funder.principal,
      isSelf: funder.isSelf,
    })),
  })
  if (!split.ok) return err(describeFixedError(split.error, capital))

  // No rate was used, so none is recorded. See InterestInput for why this is
  // null rather than zero.
  return ok(
    assemble(split.value, termDays.value, funders, () => ({ lenderRateBps: null, adminCutBps: null }), dueOn),
  )
}

/**
 * Put the split back together with the funders it came from.
 *
 * Shared by both bases because from here on there is no difference between
 * them: a row has a principal, what it earned, and the cut taken on it.
 */
function assemble(
  split: Split,
  termDays: number,
  funders: FunderInput[],
  ratesOf: (funder: FunderInput) => { lenderRateBps: BasisPoints | null; adminCutBps: BasisPoints | null },
  nextDueOn: Date,
): LoanTermsResult {
  const byLender = new Map(split.lenders.map((share) => [share.lenderId, share]))

  return {
    termDays,
    interest: split.totalInterest,
    total: split.borrowerTotal,
    nextDueOn,
    split,
    fundings: funders.map((funder) => {
      const share = byLender.get(funder.lenderId)
      if (!share) throw new Error(`The split returned no share for funder ${funder.lenderId}`)
      return {
        lenderId: funder.lenderId,
        principal: funder.principal,
        ...ratesOf(funder),
        earnings: share.earnings,
        adminCut: share.adminCut,
      }
    }),
  }
}

/** The funding problems both bases share, in words the admin can act on. */
function describeFundingError(error: FundingError, capital: Centavos): string {
  switch (error.kind) {
    case 'no-fundings':
      return 'Say whose money is funding this loan.'
    case 'fundings-do-not-match-capital': {
      const short = capital - error.funded
      return short > 0
        ? `The funding is ${parsePesosLabel(short)} short of the capital.`
        : `The funding is ${parsePesosLabel(-short)} more than the capital.`
    }
    case 'duplicate-lender':
      return 'The same lender is listed twice. Put their whole contribution on one line.'
    case 'non-positive-principal':
      return 'Every funder needs an amount greater than zero.'
  }
}

function describeSplitError(
  error: Extract<ReturnType<typeof splitLoan>, { ok: false }>['error'],
  capital: Centavos,
): string {
  if (error.kind === 'rates-do-not-match-borrower-rate') {
    return 'The lender rate and the Admin cut must add up to the borrower rate.'
  }
  return describeFundingError(error, capital)
}

function describeFixedError(error: FixedSplitError, capital: Centavos): string {
  switch (error.kind) {
    case 'non-positive-interest':
      return 'Enter the interest in pesos, greater than zero.'
    case 'lender-share-exceeds-interest':
      return "The lenders' share cannot be more than the whole interest."
    case 'lender-share-without-lenders':
      return "Every peso of this loan is the Admin pot, so leave the lenders' share empty."
    default:
      return describeFundingError(error, capital)
  }
}

function parsePesosLabel(centavosValue: number): string {
  const whole = Math.floor(Math.abs(centavosValue) / 100).toLocaleString('en-PH')
  const fraction = String(Math.abs(centavosValue) % 100).padStart(2, '0')
  return `₱${whole}.${fraction}`
}

/** A percentage the admin typed — "7", "7.5", "2" — as basis points. */
export function parseRate(input: string): Result<BasisPoints, string> {
  const cleaned = input.replace(/[%\s]/g, '')
  if (cleaned === '') return err('Enter a rate.')
  // Percentages and pesos are both "a decimal with two places", so the peso
  // parser already knows how to refuse everything this needs to refuse.
  const parsed = parsePesos(cleaned)
  if (!parsed.ok) return err('Enter a rate like 7 or 7.5.')
  return ok(parsed.value)
}
