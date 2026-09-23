import { type BasisPoints, type Centavos, centavos } from '../../lib/money/centavos.ts'
import { computeInterest } from '../../lib/money/interest.ts'
import { DAYS_PER_WEEK } from '../../lib/money/weeks.ts'
import { type PageWindow } from '../../lib/pagination.ts'
import { db } from '../db.ts'

/**
 * Reading loan requests — people who have asked to borrow, with nobody's money
 * behind them yet.
 *
 * THE INTEREST AND THE TOTAL ARE COMPUTED HERE, ON EVERY READ. That is the one
 * place this module deliberately behaves unlike loans, where the same two
 * figures are stored once and never touched again. A loan's total was agreed
 * and handed over; a request has agreed nothing, so correcting its rate or its
 * length must move the figures with it.
 *
 * They go through computeInterest — the same function the loan form previews
 * with and the same one server/loans/terms.ts stores from. A request converted
 * unchanged therefore becomes a loan showing the same total it showed here,
 * because one function produced both.
 */

export type PendingLoanRow = {
  id: string
  firstName: string
  lastName: string
  /** What they asked for. Capital only — no interest in this figure. */
  capital: Centavos
  rateBps: BasisPoints
  termDays: number
  /** Null unless the Admin already knows when the money changes hands. */
  startOn: Date | null
  /** capital x rate x weeks, at today's stored rate. Nothing is fixed yet. */
  interest: Centavos
  /** capital + interest. What they would hand back on these terms. */
  total: Centavos
}

export type PendingTotals = {
  /** Every request on this account, not the page. */
  all: number
  /** SUM("capitalCentavos") over every request. Capital only, interest excluded. */
  askedFor: Centavos
}

/**
 * What a request would cost, from the three columns that decide it.
 *
 * Exported so the promise the screen makes can be tested without a database:
 * the words beside these two figures are "would owe", and this is the whole of
 * what produces them. It is the loan arithmetic exactly — computeInterest is
 * the same function server/loans/terms.ts stores from — which is what makes a
 * request convert into a loan showing the same numbers.
 *
 * termDays is always a multiple of seven, enforced when the request is written,
 * so the division is exact.
 */
export function requestFigures(row: {
  capitalCentavos: number
  borrowerRateBps: number
  termDays: number
}): { capital: Centavos; interest: Centavos; total: Centavos } {
  const capital = centavos(row.capitalCentavos)
  const interest = computeInterest({
    capital,
    rateBps: row.borrowerRateBps,
    weeks: row.termDays / DAYS_PER_WEEK,
  })

  return { capital, interest, total: centavos(capital + interest) }
}

function withFigures(row: {
  id: string
  firstName: string
  lastName: string
  capitalCentavos: number
  borrowerRateBps: number
  termDays: number
  startOn: Date | null
}): PendingLoanRow {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    rateBps: row.borrowerRateBps,
    termDays: row.termDays,
    startOn: row.startOn,
    ...requestFigures(row),
  }
}

/**
 * One page of requests, newest first — a queue, so the one that came in last is
 * the one still to be dealt with.
 *
 * There is no deletedAt on this table, so there is no soft-delete filter to
 * forget: every row here is a live request. `userId` still scopes every query,
 * because the demo account's fictional people share these tables with the real
 * ones.
 */
export async function listPendingLoans(
  userId: string,
  paging: PageWindow,
): Promise<{ rows: PendingLoanRow[]; totals: PendingTotals }> {
  const [found, all, sum] = await Promise.all([
    db.pendingLoan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: paging.skip,
      take: paging.take,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        capitalCentavos: true,
        borrowerRateBps: true,
        termDays: true,
        startOn: true,
      },
    }),
    db.pendingLoan.count({ where: { userId } }),
    db.pendingLoan.aggregate({ where: { userId }, _sum: { capitalCentavos: true } }),
  ])

  return {
    rows: found.map(withFigures),
    totals: { all, askedFor: centavos(sum._sum.capitalCentavos ?? 0) },
  }
}

/** One request, for pre-filling the loan form with it. Null when it is not this user's. */
export async function pendingLoan(userId: string, id: string): Promise<PendingLoanRow | null> {
  const found = await db.pendingLoan.findFirst({
    where: { id, userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      capitalCentavos: true,
      borrowerRateBps: true,
      termDays: true,
      startOn: true,
    },
  })

  return found ? withFigures(found) : null
}
