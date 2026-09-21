import { type BasisPoints, type Centavos, parsePesos } from '../../lib/money/centavos.ts'
import { type Split, type Funding, splitLoan } from '../../lib/money/split.ts'
import { type Result, ok, err } from '../../lib/money/result.ts'
import { describeWeeksError, weeksBetween } from '../../lib/money/weeks.ts'

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

export type LoanInput = {
  capital: Centavos
  startOn: Date
  dueOn: Date
  borrowerRateBps: BasisPoints
  adminCutBps: BasisPoints
  funders: FunderInput[]
}

export type LoanTermsResult = {
  weeks: number
  interest: Centavos
  total: Centavos
  split: Split
  fundings: (Funding & { earnings: Centavos; adminCut: Centavos })[]
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
 * change what the borrower owes, so it is stopped rather than rounded.
 */
export function loanTerms(input: LoanInput): Result<LoanTermsResult, string> {
  const { capital, startOn, dueOn, borrowerRateBps, adminCutBps, funders } = input

  if (capital <= 0) return err('Enter a capital amount greater than zero.')

  if (!Number.isInteger(borrowerRateBps) || borrowerRateBps <= 0) {
    return err('Enter a borrower rate greater than zero.')
  }
  if (!Number.isInteger(adminCutBps) || adminCutBps < 0) {
    return err('Enter a cut of zero or more.')
  }
  if (adminCutBps > borrowerRateBps) {
    return err('Your cut cannot be larger than what the borrower is charged.')
  }

  const weeks = weeksBetween(startOn, dueOn)
  if (!weeks.ok) return err(describeWeeksError(weeks.error))

  if (funders.length === 0) return err('Say whose money is funding this loan.')

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

  const byLender = new Map(split.value.lenders.map((share) => [share.lenderId, share]))

  return ok({
    weeks: weeks.value,
    interest: split.value.totalInterest,
    total: split.value.borrowerTotal,
    split: split.value,
    fundings: funders.map((funder) => {
      const share = byLender.get(funder.lenderId)
      if (!share) throw new Error(`The split returned no share for funder ${funder.lenderId}`)
      return {
        lenderId: funder.lenderId,
        principal: funder.principal,
        ...ratesFor(funder, borrowerRateBps, adminCutBps),
        earnings: share.earnings,
        adminCut: share.adminCut,
      }
    }),
  })
}

function describeSplitError(
  error: Extract<ReturnType<typeof splitLoan>, { ok: false }>['error'],
  capital: Centavos,
): string {
  const pesos = (value: number) => parsePesosLabel(value)
  switch (error.kind) {
    case 'no-fundings':
      return 'Say whose money is funding this loan.'
    case 'fundings-do-not-match-capital': {
      const short = capital - error.funded
      return short > 0
        ? `The funding is ${pesos(short)} short of the capital.`
        : `The funding is ${pesos(-short)} more than the capital.`
    }
    case 'duplicate-lender':
      return 'The same lender is listed twice. Put their whole contribution on one line.'
    case 'non-positive-principal':
      return 'Every funder needs an amount greater than zero.'
    case 'rates-do-not-match-borrower-rate':
      return 'The lender rate and your cut must add up to the borrower rate.'
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
