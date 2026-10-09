import { type BasisPoints, type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type InterestBasis, type InterestCollection } from '../../lib/money/interest.ts'
import { type Result, err, ok } from '../../lib/money/result.ts'
import { nextUnpaidWeek } from '../../lib/money/weekly.ts'
import { DAYS_PER_WEEK, addDays } from '../../lib/money/weeks.ts'
import { type FunderInput, type InterestInput, type LoanTermsResult, loanTerms } from './terms.ts'

/**
 * What extending a loan does to its numbers. Pure, like loanTerms, which it is
 * built on: an extension is a loan's own terms run again over a longer period,
 * so the arithmetic, the split between funders and the refusals are the same
 * ones a new loan gets, not a second copy of them.
 *
 * TWO WAYS (see LoanExtension in schema.prisma):
 *
 *   later — nothing is paid now. The SAME loan runs `weeks` longer: its terms
 *           are recomputed from its own start date to the new due date, on its
 *           own rates and funders. The extra interest is the difference.
 *
 *   now   — the interest due so far is paid today. The loan closes as paid with
 *           exactly its interest, and the same capital carries on as a new loan
 *           from the OLD due date for `weeks`, on the same rates and funders.
 *           Starting from the old due date, not today, so days the borrower was
 *           late are not days the money ran for free. Loans collected at the end
 *           only: a weekly loan already pays its interest as it goes.
 *
 * A fixed-amount loan has no rate to run longer, so the Admin types the extra
 * interest and the lenders' share of it, the same two figures the loan form asks.
 */

export const MAX_EXTENSION_WEEKS = 52

export type ExtendableLoan = {
  capital: Centavos
  /** Calendar days at local midday (storedCalendarDate), never the raw column. */
  startOn: Date
  dueOn: Date
  interestBasis: InterestBasis
  interestCollection: InterestCollection
  borrowerRateBps: BasisPoints | null
  interest: Centavos
  fundings: {
    lenderId: string
    isSelf: boolean
    principal: Centavos
    adminCutBps: BasisPoints | null
    earnings: Centavos
  }[]
  /** Weeks collected by live payments. Empty on a loan collected at the end. */
  paidWeeks: ReadonlySet<number>
}

export type ExtensionRequest = {
  weeks: number
  mode: 'later' | 'now'
  /** Fixed-amount loans only: the extra interest, and the lenders' share of it. */
  fixed?: { interest: Centavos; lenderInterest: Centavos }
}

export type ExtensionPlan =
  | {
      mode: 'later'
      fromDueOn: Date
      toDueOn: Date
      addedDays: number
      addedInterest: Centavos
      addedLenderInterest: Centavos
      nextDueOn: Date
      terms: LoanTermsResult
    }
  | {
      mode: 'now'
      fromDueOn: Date
      toDueOn: Date
      addedDays: number
      /** What the borrower hands over today: the closed loan's whole interest. */
      interestPaid: Centavos
      addedInterest: Centavos
      addedLenderInterest: Centavos
      continuation: { startOn: Date; dueOn: Date; terms: LoanTermsResult }
    }

/** The Admin cut a weekly-rate loan was made at: the same reading the edit page uses. */
function adminCutOf(loan: ExtendableLoan): BasisPoints {
  return loan.fundings.find((funding) => !funding.isSelf)?.adminCutBps ?? 0
}

function lenderShareOf(loan: ExtendableLoan): Centavos {
  return centavos(loan.fundings.filter((f) => !f.isSelf).reduce((sum, f) => sum + f.earnings, 0))
}

export function planExtension(loan: ExtendableLoan, request: ExtensionRequest): Result<ExtensionPlan, string> {
  const { weeks, mode } = request
  if (!Number.isInteger(weeks) || weeks < 1) return err('Choose how many weeks to extend by.')
  if (weeks > MAX_EXTENSION_WEEKS) return err(`That is more than ${MAX_EXTENSION_WEEKS} weeks. Check the number.`)

  const fixed = loan.interestBasis === 'FIXED_AMOUNT'
  if (fixed && !request.fixed) return err('Enter the extra interest for the added time.')
  if (fixed && request.fixed && request.fixed.interest <= 0) return err('Enter the extra interest, greater than zero.')

  const funders: FunderInput[] = loan.fundings.map((f) => ({ lenderId: f.lenderId, isSelf: f.isSelf, principal: f.principal }))
  const addedDays = weeks * DAYS_PER_WEEK
  const toDueOn = addDays(loan.dueOn, addedDays)

  if (mode === 'later') {
    const interest: InterestInput = fixed
      ? {
          basis: 'FIXED_AMOUNT',
          interest: centavos(loan.interest + request.fixed!.interest),
          lenderInterest: centavos(lenderShareOf(loan) + request.fixed!.lenderInterest),
        }
      : { basis: 'WEEKLY_RATE', borrowerRateBps: loan.borrowerRateBps!, adminCutBps: adminCutOf(loan) }

    const terms = loanTerms({
      capital: loan.capital,
      startOn: loan.startOn,
      dueOn: toDueOn,
      interest,
      collection: loan.interestCollection,
      funders,
    })
    if (!terms.ok) return err(terms.error)

    // A weekly loan is chased from its earliest unpaid week, which an extension
    // does not move; only the end of the schedule moves.
    const nextDueOn =
      loan.interestCollection === 'WEEKLY'
        ? (nextUnpaidWeek(loan.startOn, terms.value.termDays / DAYS_PER_WEEK, loan.paidWeeks)?.dueOn ?? toDueOn)
        : toDueOn

    const lenderAfter = terms.value.fundings
      .filter((f) => !funders.find((x) => x.lenderId === f.lenderId)?.isSelf)
      .reduce((sum, f) => sum + f.earnings, 0)

    return ok({
      mode,
      fromDueOn: loan.dueOn,
      toDueOn,
      addedDays,
      addedInterest: centavos(terms.value.interest - loan.interest),
      addedLenderInterest: centavos(lenderAfter - lenderShareOf(loan)),
      nextDueOn,
      terms: terms.value,
    })
  }

  if (loan.interestCollection === 'WEEKLY') {
    return err(
      'This loan already collects its interest every week, so there is nothing to pay now. Extend it with nothing paid now; the extra weeks are added to its schedule.',
    )
  }

  const interest: InterestInput = fixed
    ? { basis: 'FIXED_AMOUNT', interest: request.fixed!.interest, lenderInterest: request.fixed!.lenderInterest }
    : { basis: 'WEEKLY_RATE', borrowerRateBps: loan.borrowerRateBps!, adminCutBps: adminCutOf(loan) }

  const terms = loanTerms({
    capital: loan.capital,
    startOn: loan.dueOn,
    dueOn: toDueOn,
    interest,
    collection: 'AT_END',
    funders,
  })
  if (!terms.ok) return err(terms.error)

  const lenderAfter = terms.value.fundings
    .filter((f) => !funders.find((x) => x.lenderId === f.lenderId)?.isSelf)
    .reduce((sum, f) => sum + f.earnings, 0)

  return ok({
    mode,
    fromDueOn: loan.dueOn,
    toDueOn,
    addedDays,
    interestPaid: loan.interest,
    addedInterest: terms.value.interest,
    addedLenderInterest: centavos(lenderAfter),
    continuation: { startOn: loan.dueOn, dueOn: toDueOn, terms: terms.value },
  })
}
