import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { adminTakeOnLoan } from '../../lib/money/split.ts'
import { type LoanFilter, NO_FILTER } from '../../lib/loan-filter.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { calendarDate } from '../../lib/money/weeks.ts'
import { PAGE_SIZE, type PageWindow } from '../../lib/pagination.ts'
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

/** A funder on the list, where only the name and the amount fit. */
export type LoanRowFunder = { lenderId: string; name: string; principal: Centavos }

export type LoanRow = {
  id: string
  borrowerId: string
  borrowerName: string
  capital: Centavos
  total: Centavos
  dueOn: Date
  state: LoanState
  /** Whose money this is, largest share first. */
  funders: LoanRowFunder[]
}

// The detail page carries a RICHER funder than the list does — rates, earnings,
// the admin's cut — so the list's leaner one is dropped rather than intersected
// with it. An intersection of the two arrays type-checks and then means neither.
export type LoanDetail = Omit<LoanRow, 'funders'> & {
  interest: Centavos
  weeks: number
  startOn: Date
  borrowerRateBps: number
  paidOn: Date | null
  missingProof: boolean
  funders: LoanFunder[]
  /** The admin's cut across the whole loan, plus what their own capital earned. */
  adminEarnings: Centavos
  /** What everyone ELSE earns — the interest that is not the admin's. The two always add up to `interest`. */
  lenderEarnings: Centavos
}

const funderName = (lender: { firstName: string; lastName: string; isSelf: boolean }) =>
  lender.isSelf ? 'Admin' : `${lender.firstName} ${lender.lastName}`

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
    deletedAt: null,
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

export type LoanListTotals = {
  /** Every loan the filter matches, however many pages that is. */
  all: number
  /** `status = ACTIVE`. Includes the overdue ones — an overdue loan is still unpaid. */
  active: number
  paid: number
  /** `status = ACTIVE AND dueOn < today`, so a SUBSET of `active`, not a fourth bucket. */
  overdue: number
  /** SUM of `totalCentavos` over the ACTIVE loans in the filter. */
  outstanding: Centavos
}

export type LoanList = {
  /** Only the rows for the page asked for. */
  rows: LoanRow[]
  /**
   * Computed across the WHOLE filter by Postgres, never by adding up `rows`.
   * The tiles say "still to collect", not "still to collect on this page", so
   * summing the page would make the words false the moment a second page exists.
   */
  totals: LoanListTotals
}

/**
 * One page of the loans a search matches, soonest due first. Paid ones last —
 * they need no chasing.
 *
 * THREE QUERIES, IN PARALLEL, AND NONE OF THEM READS THE WHOLE TABLE. The rows
 * come back one page at a time, and the two figure queries are aggregates that
 * Postgres answers from the `userId, status, deletedAt` and `dueOn` indexes
 * without handing any rows to Node. The previous version fetched every matching
 * loan WITH its funding rows and added them up here, which is the shape that
 * works at nine loans and stops working at nine thousand.
 *
 * A page past the end returns no rows and honest totals; the screen says so
 * rather than pretending the list is empty.
 */
export async function listLoans(
  userId: string,
  filter: LoanFilter = NO_FILTER,
  window: PageWindow = { page: 1, skip: 0, take: PAGE_SIZE },
): Promise<LoanList> {
  const where = loanWhere(userId, filter)
  const today = calendarDate(new Date())

  const [loans, byStatus, overdue] = await Promise.all([
    db.loan.findMany({
      // A TIEBREAKER, AND IT IS NOT OPTIONAL. `skip`/`take` ask Postgres for a
      // window into a sorted result, and if the sort does not decide every pair
      // of rows, equal rows may come back in a different order for page 1 than
      // for page 2 — so one loan appears twice and another is never shown. With
      // real data this showed up immediately: 86 loans, 85 distinct, because
      // several shared a due date. `id` is unique, so it makes the order total.
      where,
      orderBy: [{ status: 'asc' }, { dueOn: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
      select: {
        id: true,
        borrowerId: true,
        capitalCentavos: true,
        totalCentavos: true,
        dueOn: true,
        status: true,
        borrower: { select: { firstName: true, lastName: true } },
        // Whose money it was is on the card itself. Without it the list answers
        // "who owes what" and nothing about whose capital is at risk, which is
        // the other half of the question the admin opens this screen with.
        //
        // This is the join that made the old query expensive, and paging is what
        // makes it cheap: it now runs for twenty loans rather than all of them.
        fundings: {
          select: {
            lenderId: true,
            principalCentavos: true,
            lender: { select: { firstName: true, lastName: true, isSelf: true } },
          },
          orderBy: { principalCentavos: 'desc' },
        },
      },
    }),
    // One grouped pass gives the active/paid split AND the outstanding sum, so
    // the header counts and the money tile cannot disagree about the same rows.
    db.loan.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { totalCentavos: true },
    }),
    // Overdue is a fact about today, not a column — ACTIVE with a due date
    // before today, at local midday for the reason in money/weeks.ts. It is
    // counted separately because it cuts across the status grouping.
    //
    // AND, never a spread. Spreading `where` and then setting `status: 'ACTIVE'`
    // OVERRIDES the filter instead of narrowing it, and under the Paid chip that
    // made the Overdue tile report an active loan that was not in the list at
    // all. Intersecting gives the only honest answer — a filter pinned to PAID
    // and a count pinned to ACTIVE can share no rows, so it returns 0.
    db.loan.count({ where: { AND: [where, { status: 'ACTIVE', dueOn: { lt: today } }] } }),
  ])

  const active = byStatus.find((group) => group.status === 'ACTIVE')
  const paid = byStatus.find((group) => group.status === 'PAID')

  return {
    rows: loans.map((loan) => ({
      id: loan.id,
      borrowerId: loan.borrowerId,
      borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`,
      capital: centavos(loan.capitalCentavos),
      total: centavos(loan.totalCentavos),
      dueOn: loan.dueOn,
      state: loanState(loan.status, loan.dueOn),
      funders: loan.fundings.map((funding) => ({
        lenderId: funding.lenderId,
        name: funderName(funding.lender),
        principal: centavos(funding.principalCentavos),
      })),
    })),
    totals: {
      all: (active?._count._all ?? 0) + (paid?._count._all ?? 0),
      active: active?._count._all ?? 0,
      paid: paid?._count._all ?? 0,
      overdue,
      outstanding: centavos(active?._sum.totalCentavos ?? 0),
    },
  }
}

/**
 * The overdue figures for the dashboard, and nothing else.
 *
 * The dashboard used to ask `listLoans` for every overdue loan and add them up
 * in JavaScript, although it renders none of them — it shows a count, a sum and
 * how many PEOPLE are late. All three are aggregates, so all three are done in
 * Postgres and no loan row travels.
 *
 * People, not loans: one borrower late on two loans is one person to chase.
 */
export async function overdueSummary(
  userId: string,
): Promise<{ loans: number; borrowers: number; total: Centavos }> {
  const where = loanWhere(userId, { ...NO_FILTER, status: 'overdue' })

  const [totals, people] = await Promise.all([
    db.loan.aggregate({ where, _count: { _all: true }, _sum: { totalCentavos: true } }),
    db.loan.groupBy({ by: ['borrowerId'], where }),
  ])

  return {
    loans: totals._count._all,
    borrowers: people.length,
    total: centavos(totals._sum.totalCentavos ?? 0),
  }
}

export async function getLoan(userId: string, loanId: string): Promise<LoanDetail | null> {
  const loan = await db.loan.findFirst({
    // A deleted loan is gone from every list, so it must be gone from its own
    // page too. Without this it renders live and payable to anyone who kept the
    // link or pressed Back after deleting it.
    where: { id: loanId, userId, deletedAt: null },
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
          deletedAt: true,
          proofFiles: { where: { deletedAt: null }, select: { id: true } },
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
  // dropped here instead. Undoing soft-deletes the row rather than destroying it, so
  // the row is still attached to the loan and would otherwise read as paid.
  const payment = loan.payment?.deletedAt === null ? loan.payment : null

  // What the admin actually takes home on this loan: their cut on other
  // people's money, plus what their own capital earned as a funder.
  const adminEarnings = adminTakeOnLoan(funders)

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
    adminEarnings,
    // Taken OUT of the total rather than added up from the rows. The split
    // already guaranteed the parts sum to the interest charged, so subtracting
    // is the one way these two figures cannot drift a centavo apart from it.
    lenderEarnings: centavos(loan.interestCentavos - adminEarnings),
  }
}

/** The people and pots a loan form needs to offer. */
export async function loanFormOptions(userId: string) {
  const [borrowers, lenders] = await Promise.all([
    db.borrower.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    db.lender.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isSelf: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, isSelf: true },
    }),
  ])

  return {
    borrowers: borrowers.map((b) => ({ id: b.id, name: `${b.firstName} ${b.lastName}` })),
    lenders: lenders.map((l) => ({ id: l.id, name: funderName(l), isSelf: l.isSelf })),
  }
}
