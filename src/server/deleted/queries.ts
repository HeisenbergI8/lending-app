import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { PAGE_SIZE, type PageWindow } from '../../lib/pagination.ts'
import { db } from '../db.ts'

/**
 * Everything the admin has deleted and can still get back.
 *
 * Deleting in this app sets `deletedAt` and the default queries stop returning
 * the row. This is the only screen that asks for the opposite, so it is the only
 * place a `{ not: null }` filter belongs.
 *
 * Newest first, because the row somebody wants back is almost always the one
 * they just deleted by mistake.
 *
 * The deleted DATE comes back with every row: the countdown to the thirty-day
 * purge is half of what this screen is for, and a countdown cannot be drawn
 * without it. Prisma types the column nullable, so the rows are narrowed on the
 * way out rather than leaving every caller to re-check something the WHERE
 * clause already guaranteed.
 */

export type DeletedRow = {
  id: string
  /** When it was deleted. Never null here — the filter saw to that. */
  deletedAt: Date
}

export type DeletedPerson = DeletedRow & {
  firstName: string
  lastName: string
  /**
   * Live records still point at them, so the purge will pass over them.
   *
   * A borrower with loans and a lender with funding rows cannot be destroyed
   * without taking real money history down with them. The screen says so rather
   * than showing a countdown that is never going to reach zero.
   */
  held: boolean
}

export type DeletedLoan = DeletedRow & {
  borrowerName: string
  capital: Centavos
  total: Centavos
  dueOn: Date
}

export type DeletedTransaction = DeletedRow & {
  lenderName: string
  type: 'DEPOSIT' | 'WITHDRAWAL'
  amount: Centavos
  occurredOn: Date
}

/** The four independent lists on this screen. Each one pages on its own. */
export type DeletedSection = 'lenders' | 'borrowers' | 'loans' | 'transactions'

export const DELETED_SECTIONS: DeletedSection[] = ['lenders', 'borrowers', 'loans', 'transactions']

export type Deleted = {
  lenders: DeletedPerson[]
  borrowers: DeletedPerson[]
  loans: DeletedLoan[]
  transactions: DeletedTransaction[]
  /**
   * How many there are in each section, across every page.
   *
   * The headings count what was deleted, not what is rendered — a "Loans 3"
   * beside a page showing twenty of forty-three would be false twice over.
   */
  counts: Record<DeletedSection, number>
}

/**
 * True when there is nothing deleted at all — the screen's empty state.
 *
 * Counted from `counts`, never from the rendered arrays: on page 2 of a list
 * that just shrank, every array is empty while the bin is not, and telling
 * somebody their bin is empty when it is not is the one mistake this screen
 * must never make.
 */
export function isEmpty(deleted: Deleted): boolean {
  return DELETED_SECTIONS.every((section) => deleted.counts[section] === 0)
}

/**
 * The WHERE clause said deletedAt is not null; the type does not know that.
 *
 * One place asserts it, right where the guarantee is made, instead of a `?? new
 * Date()` at every call site quietly inventing a deletion date that would then
 * be counted down from.
 */
function deletedOn(value: Date | null): Date {
  if (value === null) throw new Error('A row on Recently Deleted came back with no deletedAt.')
  return value
}

/**
 * The counts for all four groups, and one page of rows for ONE of them.
 *
 * The screen shows a single group at a time behind a row of tabs, so three of
 * the four lists are not on screen and are not fetched. Before tabs it rendered
 * all four stacked, which at ten rows each is forty cards of things that have
 * been DELETED — a very long page about nothing you are looking for.
 *
 * The counts are always all four, because they label the tabs. They are `count`
 * queries rather than the length of anything, so a tab still says 26 while ten
 * are on screen.
 */
export async function listDeleted(
  userId: string,
  section: DeletedSection = 'loans',
  window: PageWindow = { page: 1, skip: 0, take: PAGE_SIZE },
): Promise<Deleted> {
  const deleted = { deletedAt: { not: null } } as const
  // `id` breaks ties — see the note in loans/queries.ts. Anything deleted in
  // one go shares a timestamp, which is precisely the tied case.
  const newestFirst = [{ deletedAt: 'desc' as const }, { id: 'asc' as const }]

  const where = { userId, ...deleted }
  /** Skip the query entirely for the three groups that are not on screen. */
  const only = (wanted: DeletedSection): { skip: number; take: number } =>
    section === wanted ? { skip: window.skip, take: window.take } : { skip: 0, take: 0 }

  const [lenders, borrowers, loans, transactions, counts] = await Promise.all([
    db.lender.findMany({
      where,
      orderBy: newestFirst,
      ...only('lenders'),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        deletedAt: true,
        // Funding rows are onDelete: Restrict — one is enough to hold them.
        // Only rows that SURVIVE the purge hold: a funding row on a loan that is
        // itself in the bin dies in the same run, so counting it would promise a
        // hold that does not exist and suppress the countdown.
        _count: { select: { fundings: { where: { loan: { deletedAt: null } } } } },
      },
    }),
    db.borrower.findMany({
      where,
      orderBy: newestFirst,
      ...only('borrowers'),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        deletedAt: true,
        // Deleted loans do not hold a deleted borrower — the purge destroys the
        // loans first, then re-counts and destroys the borrower in the same run.
        // Counting them showed "Kept while there are still loans of theirs" on
        // somebody who was about to be wiped without any countdown.
        _count: { select: { loans: { where: { deletedAt: null } } } },
      },
    }),
    db.loan.findMany({
      where,
      orderBy: newestFirst,
      ...only('loans'),
      select: {
        id: true,
        capitalCentavos: true,
        totalCentavos: true,
        dueOn: true,
        deletedAt: true,
        borrower: { select: { firstName: true, lastName: true } },
      },
    }),
    db.lenderTransaction.findMany({
      where,
      orderBy: newestFirst,
      ...only('transactions'),
      select: {
        id: true,
        type: true,
        amountCentavos: true,
        occurredOn: true,
        deletedAt: true,
        lender: { select: { firstName: true, lastName: true } },
      },
    }),
    // Four counts in one round trip each, all served by the userId+deletedAt
    // indexes. They are what the headings and the pagers print.
    Promise.all([
      db.lender.count({ where }),
      db.borrower.count({ where }),
      db.loan.count({ where }),
      db.lenderTransaction.count({ where }),
    ]).then(([lenders, borrowers, loans, transactions]) => ({
      lenders,
      borrowers,
      loans,
      transactions,
    })),
  ])

  return {
    counts,
    lenders: lenders.map((lender) => ({
      id: lender.id,
      firstName: lender.firstName,
      lastName: lender.lastName,
      deletedAt: deletedOn(lender.deletedAt),
      held: lender._count.fundings > 0,
    })),
    borrowers: borrowers.map((borrower) => ({
      id: borrower.id,
      firstName: borrower.firstName,
      lastName: borrower.lastName,
      deletedAt: deletedOn(borrower.deletedAt),
      held: borrower._count.loans > 0,
    })),
    loans: loans.map((loan) => ({
      id: loan.id,
      borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`,
      capital: centavos(loan.capitalCentavos),
      total: centavos(loan.totalCentavos),
      dueOn: loan.dueOn,
      deletedAt: deletedOn(loan.deletedAt),
    })),
    transactions: transactions.map((entry) => ({
      id: entry.id,
      lenderName: `${entry.lender.firstName} ${entry.lender.lastName}`,
      type: entry.type,
      amount: centavos(entry.amountCentavos),
      occurredOn: entry.occurredOn,
      deletedAt: deletedOn(entry.deletedAt),
    })),
  }
}
