import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { adminTakeOnLoan } from '../../lib/money/split.ts'
import { type LoanFilter, NO_FILTER } from '../../lib/loan-filter.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { calendarDate } from '../../lib/money/weeks.ts'
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

const INSENSITIVE = { mode: 'insensitive' } as const

/**
 * Turn a search into a `where` clause.
 *
 * Every part of it narrows the same query rather than filtering rows in JS: a
 * search that reads the whole table to throw most of it away would work today at
 * a few hundred loans and quietly stop working later, and the indexes on
 * userId+status and dueOn are already there to serve it.
 *
 * The three status filters are the loan STATES, not a second vocabulary — and
 * overdue is not a column, so it is expressed the way it is defined: active,
 * with a due date before today. Today is a calendar day at midday, for the
 * reason in money/weeks.ts.
 */
export function loanWhere(userId: string, filter: LoanFilter) {
  const today = calendarDate(new Date())

  const dueOn = {
    ...(filter.from ? { gte: filter.from } : {}),
    ...(filter.to ? { lte: filter.to } : {}),
    ...(filter.status === 'overdue' ? { lt: today } : {}),
    // An active loan is one not yet due, so the range's own `gte` is tightened to
    // today rather than replaced — both bounds have to hold, and the later of the
    // two is the one that does the work.
    ...(filter.status === 'active' ? { gte: filter.from && filter.from > today ? filter.from : today } : {}),
  }

  return {
    userId,
    archivedAt: null,
    ...(filter.status === 'paid' ? { status: 'PAID' as const } : {}),
    ...(filter.status === 'active' || filter.status === 'overdue' ? { status: 'ACTIVE' as const } : {}),
    ...(Object.keys(dueOn).length > 0 ? { dueOn } : {}),
    // An amount matches either figure, because the admin remembers a loan by the
    // money that changed hands OR by what is owed back on it.
    ...(filter.amount !== null
      ? { OR: [{ capitalCentavos: filter.amount }, { totalCentavos: filter.amount }] }
      : {}),
    // Every word must match somewhere, so "Angel Cruz" finds Angel Cruz rather
    // than everyone called Angel and everyone called Cruz.
    ...(filter.terms.length > 0
      ? {
          AND: filter.terms.map((term) => ({
            OR: [
              { borrower: { firstName: { contains: term, ...INSENSITIVE } } },
              { borrower: { lastName: { contains: term, ...INSENSITIVE } } },
              { fundings: { some: { lender: { firstName: { contains: term, ...INSENSITIVE } } } } },
              { fundings: { some: { lender: { lastName: { contains: term, ...INSENSITIVE } } } } },
            ],
          })),
        }
      : {}),
  }
}

/** Every loan the search matches, soonest due first. Paid ones last — they need no chasing. */
export async function listLoans(userId: string, filter: LoanFilter = NO_FILTER): Promise<LoanRow[]> {
  const loans = await db.loan.findMany({
    where: loanWhere(userId, filter),
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
      payment: {
        select: {
          paidOn: true,
          archivedAt: true,
          proofFiles: { where: { archivedAt: null }, select: { id: true } },
        },
      },
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

  // Prisma cannot filter a to-one relation in a select, so an undone payment is
  // dropped here instead. Undoing archives the row rather than destroying it, so
  // the row is still attached to the loan and would otherwise read as paid.
  const payment = loan.payment?.archivedAt === null ? loan.payment : null

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
    paidOn: payment?.paidOn ?? null,
    missingProof: payment !== null && payment.proofFiles.length === 0,
    funders,
    // What the admin actually takes home on this loan: their cut on other
    // people's money, plus what their own capital earned as a funder.
    adminEarnings: adminTakeOnLoan(funders),
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
