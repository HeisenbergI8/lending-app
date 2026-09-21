import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { db } from '../db.ts'

/**
 * Reading loans.
 *
 * Every figure on a loan — weeks, interest, total, each funder's earnings — was
 * computed once when it was created and stored. Nothing here recalculates any of
 * it. A later change to a default rate must not silently rewrite what a borrower
 * already owes.
 *
 * The one thing that IS derived is the state: overdue is ACTIVE with a due date
 * in the past, a fact about today rather than a flag someone has to remember to
 * set.
 */

export type LoanFunder = {
  lenderId: string
  name: string
  isSelf: boolean
  principal: Centavos
  earnings: Centavos
  adminCut: Centavos
  lenderRateBps: number
  adminCutBps: number
}

export type LoanRow = {
  id: string
  borrowerId: string
  borrowerName: string
  capital: Centavos
  total: Centavos
  dueOn: Date
  state: LoanState
}

export type LoanDetail = LoanRow & {
  interest: Centavos
  weeks: number
  startOn: Date
  borrowerRateBps: number
  paidOn: Date | null
  missingProof: boolean
  funders: LoanFunder[]
  /** The admin's cut across the whole loan, plus what their own capital earned. */
  adminEarnings: Centavos
}

const funderName = (lender: { firstName: string; lastName: string; isSelf: boolean }) =>
  lender.isSelf ? 'You' : `${lender.firstName} ${lender.lastName}`

/** Every loan, soonest due first. Paid ones last — they need no chasing. */
export async function listLoans(userId: string): Promise<LoanRow[]> {
  const loans = await db.loan.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ status: 'asc' }, { dueOn: 'asc' }],
    select: {
      id: true,
      borrowerId: true,
      capitalCentavos: true,
      totalCentavos: true,
      dueOn: true,
      status: true,
      borrower: { select: { firstName: true, lastName: true } },
    },
  })

  return loans.map((loan) => ({
    id: loan.id,
    borrowerId: loan.borrowerId,
    borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`,
    capital: centavos(loan.capitalCentavos),
    total: centavos(loan.totalCentavos),
    dueOn: loan.dueOn,
    state: loanState(loan.status, loan.dueOn),
  }))
}

export async function getLoan(userId: string, loanId: string): Promise<LoanDetail | null> {
  const loan = await db.loan.findFirst({
    where: { id: loanId, userId },
    select: {
      id: true,
      borrowerId: true,
      capitalCentavos: true,
      interestCentavos: true,
      totalCentavos: true,
      borrowerRateBps: true,
      weeks: true,
      startOn: true,
      dueOn: true,
      status: true,
      borrower: { select: { firstName: true, lastName: true } },
      payment: { select: { paidOn: true, proofFiles: { where: { archivedAt: null }, select: { id: true } } } },
      fundings: {
        select: {
          lenderId: true,
          principalCentavos: true,
          earningsCentavos: true,
          adminCutCentavos: true,
          lenderRateBps: true,
          adminCutBps: true,
          lender: { select: { firstName: true, lastName: true, isSelf: true } },
        },
      },
    },
  })
  if (!loan) return null

  const funders: LoanFunder[] = loan.fundings.map((funding) => ({
    lenderId: funding.lenderId,
    name: funderName(funding.lender),
    isSelf: funding.lender.isSelf,
    principal: centavos(funding.principalCentavos),
    earnings: centavos(funding.earningsCentavos),
    adminCut: centavos(funding.adminCutCentavos),
    lenderRateBps: funding.lenderRateBps,
    adminCutBps: funding.adminCutBps,
  }))

  const cuts = funders.reduce((sum, funder) => sum + funder.adminCut, 0)
  const ownCapitalEarnings = funders
    .filter((funder) => funder.isSelf)
    .reduce((sum, funder) => sum + funder.earnings, 0)

  return {
    id: loan.id,
    borrowerId: loan.borrowerId,
    borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`,
    capital: centavos(loan.capitalCentavos),
    interest: centavos(loan.interestCentavos),
    total: centavos(loan.totalCentavos),
    weeks: loan.weeks,
    startOn: loan.startOn,
    dueOn: loan.dueOn,
    borrowerRateBps: loan.borrowerRateBps,
    state: loanState(loan.status, loan.dueOn),
    paidOn: loan.payment?.paidOn ?? null,
    missingProof: loan.payment !== null && loan.payment.proofFiles.length === 0,
    funders,
    // What the admin actually takes home on this loan: their cut on other
    // people's money, plus what their own capital earned as a funder.
    adminEarnings: centavos(cuts + ownCapitalEarnings),
  }
}

/** The people and pots a loan form needs to offer. */
export async function loanFormOptions(userId: string) {
  const [borrowers, lenders] = await Promise.all([
    db.borrower.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    db.lender.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isSelf: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, isSelf: true },
    }),
  ])

  return {
    borrowers: borrowers.map((b) => ({ id: b.id, name: `${b.firstName} ${b.lastName}` })),
    lenders: lenders.map((l) => ({ id: l.id, name: funderName(l), isSelf: l.isSelf })),
  }
}
