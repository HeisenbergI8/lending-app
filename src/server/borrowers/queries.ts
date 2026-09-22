import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { type TrackRecord, trackRecord } from '../../lib/track-record.ts'
import { PAGE_SIZE, type PageWindow } from '../../lib/pagination.ts'
import { db } from '../db.ts'

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
      status: true,
      dueOn: true,
      totalCentavos: true,
      // deletedAt comes back so an UNDONE payment can be dropped: the loan is
      // running again, and it must not count as paid in the track record.
      payment: { select: { paidOn: true, deletedAt: true } },
    },
  },
} as const

type SummaryRow = {
  id: string
  firstName: string
  lastName: string
  manualLabel: BorrowerLabel | null
  loans: {
    status: 'ACTIVE' | 'PAID'
    dueOn: Date
    totalCentavos: number
    payment: { paidOn: Date; deletedAt: Date | null } | null
  }[]
}

function toSummary(borrower: SummaryRow): BorrowerSummary {
  const loans = borrower.loans.map((loan) => ({
    status: loan.status,
    dueOn: loan.dueOn,
    paidOn: loan.payment?.deletedAt === null ? loan.payment.paidOn : null,
  }))

  return {
    id: borrower.id,
    firstName: borrower.firstName,
    lastName: borrower.lastName,
    label: borrower.manualLabel,
    record: trackRecord(loans),
    outstanding: centavos(
      borrower.loans
        .filter((loan) => loan.status === 'ACTIVE')
        .reduce((sum, loan) => sum + loan.totalCentavos, 0),
    ),
    // Overdue is ACTIVE with dueOn before today — derived here from the rows
    // already fetched rather than by a second query. `trackRecord` counts the
    // same loans; this sums what they are worth.
    overdueOutstanding: centavos(
      borrower.loans
        .filter((loan) => loanState(loan.status, loan.dueOn) === 'overdue')
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
          startOn: true,
          dueOn: true,
          status: true,
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
              lender: { select: { firstName: true, lastName: true, isSelf: true } },
            },
          },
        },
      },
    },
  })
  if (!borrower) return null

  // An undone payment is soft-deleted rather than destroyed, and Prisma cannot
  // filter a to-one relation in a select — so it is dropped here.
  const livePayment = <T extends { deletedAt: Date | null }>(loan: { payment: T | null }): T | null =>
    loan.payment?.deletedAt === null ? loan.payment : null

  const loans: BorrowerLoan[] = borrower.loans.map((loan) => ({
    id: loan.id,
    capital: centavos(loan.capitalCentavos),
    total: centavos(loan.totalCentavos),
    interest: centavos(loan.interestCentavos),
    termDays: loan.termDays,
    startOn: loan.startOn,
    dueOn: loan.dueOn,
    state: loanState(loan.status, loan.dueOn),
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
        dueOn: loan.dueOn,
        paidOn: livePayment(loan)?.paidOn ?? null,
      })),
    ),
    outstanding: centavos(
      borrower.loans
        .filter((loan) => loan.status === 'ACTIVE')
        .reduce((sum, loan) => sum + loan.totalCentavos, 0),
    ),
    // Same split as the list: `loans` above already carries each loan's state,
    // so this reuses that rather than re-deriving overdue from the dates twice.
    overdueOutstanding: centavos(
      loans.filter((loan) => loan.state === 'overdue').reduce((sum, loan) => sum + loan.total, 0),
    ),
    loans,
  }
}
