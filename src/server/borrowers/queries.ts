import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { type TrackRecord, trackRecord } from '../../lib/track-record.ts'
import { PAGE_SIZE, type PageWindow } from '../../lib/pagination.ts'
import { type InterestCollection } from '../../lib/money/interest.ts'
import { db } from '../db.ts'
import { sumReleased } from '../payments/collected.ts'
import { settledOn, settlingPayment } from '../payments/settled.ts'

/**
 * Reading borrowers and their history.
 *
 * A borrower record holds a first and last name and nothing else — no phone, no
 * address. The value of the profile is the TRACK RECORD, and that is counted from
 * the loans every time it is read, never stored. The Good/Okay/Bad label beside
 * it IS stored, because it is the admin's judgement and no query can derive it.
 *
 * Paid loans stay on the profile forever. That history is the point.
 */

export type BorrowerLabel = 'GOOD' | 'OKAY' | 'BAD'

export type BorrowerSummary = {
  id: string
  firstName: string
  lastName: string
  label: BorrowerLabel | null
  record: TrackRecord
  /** Still owed on loans that are not yet paid. */
  outstanding: Centavos
  /**
   * The slice of `outstanding` that is on loans already past their due date.
   * Equal to `outstanding` when every unpaid loan is late, 0 when none is.
   * Kept apart so a caption cannot call a whole balance overdue on the strength
   * of one late loan — see the borrowers list.
   */
  overdueOutstanding: Centavos
}

export type BorrowerLoan = {
  id: string
  capital: Centavos
  total: Centavos
  interest: Centavos
  /** The term in days. Say it with describeTerm — "4 weeks" or "3 days". */
  termDays: number
  startOn: Date
  dueOn: Date
  state: LoanState
  paidOn: Date | null
  /** A payment recorded with no file attached. Flagged, never blocked. */
  missingProof: boolean
  funders: { lenderId: string; name: string; principal: Centavos }[]
}

export type BorrowerDetail = BorrowerSummary & { loans: BorrowerLoan[] }

/**
 * The columns a summary row is built from.
 *
 * The nested loans are what makes this row expensive, and paging is what makes
 * it affordable: it now runs for one page of borrowers rather than all of them.
 * The rule for what counts as on time lives in `trackRecord`, so the loans are
 * fetched and counted rather than re-expressed as SQL — a second implementation
 * of "paid late" is a second answer waiting to disagree with the PDF statement,
 * which uses the same function.
 */
const SUMMARY_ROW = {
  id: true,
  firstName: true,
  lastName: true,
  manualLabel: true,
  loans: {
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      dueOn: true,
      nextDueOn: true,
      termDays: true,
      interestCollection: true,
      totalCentavos: true,
      // deletedAt comes back so an UNDONE payment can be dropped: the loan is
      // running again, and it must not count as paid in the track record.
      // weekNumber narrows to the SETTLING payment: a collected week is a real
      // payment and does not mean the loan was repaid.
      payments: { select: { paidOn: true, deletedAt: true, weekNumber: true, amountCentavos: true } },
      // The stored split, for the weeks already collected on a weekly loan.
      // What a borrower still owes is their total MINUS those weeks, and the
      // figure comes from the funding rows for the reason collected.ts gives:
      // one rule behind every "collected" figure in the app.
      fundings: { select: { earningsCentavos: true, adminCutCentavos: true } },
    },
  },
} as const

type SummaryRow = {
  id: string
  firstName: string
  lastName: string
  manualLabel: BorrowerLabel | null
  loans: {
    id: string
    status: 'ACTIVE' | 'PAID'
    dueOn: Date
    /** The next day money is owed. Loan.dueOn at the end, the earliest unpaid week when weekly. */
    nextDueOn: Date
    termDays: number
    interestCollection: InterestCollection
    totalCentavos: number
    payments: { paidOn: Date; deletedAt: Date | null; weekNumber: number | null; amountCentavos: number }[]
    fundings: { earningsCentavos: number; adminCutCentavos: number }[]
  }[]
}

/**
 * What a borrower still owes across their running loans.
 *
 * The totals, minus the weeks already collected on the weekly ones. A loan
 * fifteen weeks in has had fifteen weeks of interest handed over, and counting
 * that as still to come would contradict the lender tiles that already spent it.
 */
function stillOwed(loans: SummaryRow['loans']): Centavos {
  const active = loans.filter((loan) => loan.status === 'ACTIVE')
  const totals = active.reduce((sum, loan) => sum + loan.totalCentavos, 0)

  const weekly = active.filter((loan) => loan.interestCollection === 'WEEKLY')
  const collected = sumReleased(
    weekly.flatMap((loan) =>
      loan.fundings.map((funding) => ({ ...funding, loan: { id: loan.id, termDays: loan.termDays } })),
    ),
    weekly.flatMap((loan) =>
      loan.payments
        .filter((payment) => payment.deletedAt === null)
        .map((payment) => ({ loanId: loan.id, weekNumber: payment.weekNumber })),
    ),
  )

  return centavos(totals - collected)
}

function toSummary(borrower: SummaryRow): BorrowerSummary {
  const loans = borrower.loans.map((loan) => ({
    status: loan.status,
    // The next owed date, not the capital date — see BorrowerLoanRecord.
    dueOn: loan.nextDueOn,
    paidOn: settledOn(loan.payments),
  }))

  return {
    id: borrower.id,
    firstName: borrower.firstName,
    lastName: borrower.lastName,
    label: borrower.manualLabel,
    record: trackRecord(loans),
    outstanding: stillOwed(borrower.loans),
    // Overdue is ACTIVE with dueOn before today — derived here from the rows
    // already fetched rather than by a second query. `trackRecord` counts the
    // same loans; this sums what they are worth.
    overdueOutstanding: centavos(
      borrower.loans
        .filter((loan) => loanState(loan.status, loan.nextDueOn) === 'overdue')
        .reduce((sum, loan) => sum + loan.totalCentavos, 0),
    ),
  }
}

export type BorrowerList = {
  rows: BorrowerSummary[]
  /** Across everyone, not the page — the heading counts people, not rows on screen. */
  totals: {
    all: number
    /** People with at least one unpaid loan. A COUNT of PEOPLE, not of loans and not of pesos. */
    owing: number
  }
}

/**
 * How many borrowers there are, and how many of them owe.
 *
 * Two counts, no rows. The borrowers list and the dashboard both print these,
 * and they share this function so the two screens cannot report different
 * numbers of the same people.
 */
export async function borrowerCounts(userId: string): Promise<BorrowerList['totals']> {
  const where = { userId, deletedAt: null }

  const [all, owing] = await Promise.all([
    db.borrower.count({ where }),
    // "Owing" asks a question about EXISTENCE, not about a sum: has this person
    // any live unpaid loan. Postgres answers it with a semi-join and no summing,
    // where the screens previously added up every loan of every borrower to
    // discover the same thing.
    db.borrower.count({ where: { ...where, loans: { some: { deletedAt: null, status: 'ACTIVE' } } } }),
  ])

  return { all, owing }
}

/** One page of borrowers with their counted record, alphabetical. */
export async function listBorrowers(
  userId: string,
  window: PageWindow = { page: 1, skip: 0, take: PAGE_SIZE },
): Promise<BorrowerList> {
  const [borrowers, totals] = await Promise.all([
    db.borrower.findMany({
      where: { userId, deletedAt: null },
      // `id` breaks ties — see the note in loans/queries.ts. Two people can
      // share a name, and without it they can swap between pages.
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
      select: SUMMARY_ROW,
    }),
    borrowerCounts(userId),
  ])

  return { rows: borrowers.map(toSummary), totals }
}

/**
 * The few borrowers who owe the most, for the dashboard.
 *
 * Ordering by `outstanding` is the awkward part: it is a SUM of a borrower's
 * active loans, not a column, so it cannot be an `orderBy` on the borrower
 * table. The dashboard used to get it by loading EVERY borrower with EVERY loan
 * and sorting in JavaScript to keep six of them — the most expensive query in
 * the app, on the screen that opens most often.
 *
 * So the order is asked of the loans instead: group the live unpaid ones by
 * borrower, sum, take the top few. That is one indexed aggregate returning at
 * most `limit` rows.
 *
 * The top-up afterwards preserves the old screen exactly. A borrower who owes
 * nothing sorted last under the JavaScript sort but still appeared while there
 * was room, so they still do — filling from the alphabetical list, which is the
 * order the old stable sort left them in.
 */
export async function topBorrowers(userId: string, limit: number): Promise<BorrowerSummary[]> {
  const owed = await db.loan.groupBy({
    by: ['borrowerId'],
    where: { userId, deletedAt: null, status: 'ACTIVE', borrower: { deletedAt: null } },
    _sum: { totalCentavos: true },
    orderBy: { _sum: { totalCentavos: 'desc' } },
    take: limit,
  })

  const ranked = owed.map((group) => group.borrowerId)

  const [owing, rest] = await Promise.all([
    ranked.length > 0
      ? db.borrower.findMany({ where: { userId, deletedAt: null, id: { in: ranked } }, select: SUMMARY_ROW })
      : [],
    ranked.length < limit
      ? db.borrower.findMany({
          where: { userId, deletedAt: null, id: { notIn: ranked } },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          take: limit - ranked.length,
          select: SUMMARY_ROW,
        })
      : [],
  ])

  // `in` does not preserve the order it was given, so the ranking is reapplied.
  const byId = new Map(owing.map((borrower) => [borrower.id, borrower]))
  const inRank = ranked.map((id) => byId.get(id)).filter((row) => row !== undefined)

  return [...inRank, ...rest].map(toSummary)
}

/**
 * Just the names, for a picker.
 *
 * The reports screen needs a borrower dropdown and nothing else, and it used to
 * build one from `listBorrowers` — every borrower WITH every loan and payment,
 * to render a list of names. Three columns per row instead.
 *
 * Deliberately NOT paged: a `<select>` has to offer everyone or it cannot pick
 * everyone. It stays cheap because the row is three short columns; if the day
 * comes that the dropdown itself is too long, the fix is a search field, not a
 * page button.
 */
export async function listBorrowerNames(
  userId: string,
): Promise<{ id: string; firstName: string; lastName: string }[]> {
  return db.borrower.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  })
}

/** One borrower, with every loan they have ever taken. */
export async function getBorrower(userId: string, borrowerId: string): Promise<BorrowerDetail | null> {
  const borrower = await db.borrower.findFirst({
    // Same rule as getLoan: deleted means gone from the list AND from the
    // profile. The loans below were already filtered; the person was not.
    where: { id: borrowerId, userId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      manualLabel: true,
      loans: {
        where: { deletedAt: null },
        orderBy: { startOn: 'desc' },
        select: {
          id: true,
          capitalCentavos: true,
          totalCentavos: true,
          interestCentavos: true,
          termDays: true,
          interestCollection: true,
          startOn: true,
          dueOn: true,
          nextDueOn: true,
          status: true,
          payments: {
            select: {
              id: true,
              weekNumber: true,
              paidOn: true,
              deletedAt: true,
              amountCentavos: true,
              proofFiles: { where: { deletedAt: null }, select: { id: true } },
            },
          },
          fundings: {
            select: {
              lenderId: true,
              principalCentavos: true,
              // The stored split, for the weeks already collected — see stillOwed.
              earningsCentavos: true,
              adminCutCentavos: true,
              lender: { select: { firstName: true, lastName: true, isSelf: true } },
            },
          },
        },
      },
    },
  })
  if (!borrower) return null

  // The settling payment, live only. An undone payment is soft-deleted rather
  // than destroyed, so it is still attached to its loan; and on a weekly loan
  // the array also carries collected weeks, which are not the repayment.
  const livePayment = <T extends { deletedAt: Date | null; weekNumber: number | null }>(loan: {
    payments: T[]
  }): T | null => settlingPayment(loan.payments)

  const loans: BorrowerLoan[] = borrower.loans.map((loan) => ({
    id: loan.id,
    capital: centavos(loan.capitalCentavos),
    total: centavos(loan.totalCentavos),
    interest: centavos(loan.interestCentavos),
    termDays: loan.termDays,
    startOn: loan.startOn,
    dueOn: loan.dueOn,
    state: loanState(loan.status, loan.nextDueOn),
    paidOn: livePayment(loan)?.paidOn ?? null,
    missingProof: livePayment(loan) !== null && livePayment(loan)!.proofFiles.length === 0,
    funders: loan.fundings.map((funding) => ({
      lenderId: funding.lenderId,
      name: funding.lender.isSelf ? 'Admin' : `${funding.lender.firstName} ${funding.lender.lastName}`,
      principal: centavos(funding.principalCentavos),
    })),
  }))

  return {
    id: borrower.id,
    firstName: borrower.firstName,
    lastName: borrower.lastName,
    label: borrower.manualLabel,
    record: trackRecord(
      borrower.loans.map((loan) => ({
        status: loan.status,
        // The next owed date, not the capital date — see BorrowerLoanRecord.
        dueOn: loan.nextDueOn,
        paidOn: livePayment(loan)?.paidOn ?? null,
      })),
    ),
    outstanding: stillOwed(borrower.loans),
    // Same split as the list: `loans` above already carries each loan's state,
    // so this reuses that rather than re-deriving overdue from the dates twice.
    overdueOutstanding: centavos(
      loans.filter((loan) => loan.state === 'overdue').reduce((sum, loan) => sum + loan.total, 0),
    ),
    loans,
  }
}
