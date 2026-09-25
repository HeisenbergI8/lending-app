import { Prisma } from '@prisma/client'

import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { DAYS_PER_WEEK } from '../../lib/money/weeks.ts'
import { collectedInstalments, releasedOnFunding } from '../../lib/money/weekly.ts'
import { db } from '../db.ts'

/**
 * How much interest has already been collected on the weekly loans still running.
 *
 * ONE QUESTION, ASKED FROM THREE SCREENS — the dashboard's interest tile, the
 * loans list's "still to collect", and a borrower's outstanding figure. It is a
 * function rather than three queries because all three have to give the same
 * answer: a dashboard saying ₱63,000 has been collected beside a list saying the
 * whole ₱144,000 is still to come describes two different loan books.
 *
 * IT READS THE FUNDING ROWS, NOT Payment.amountCentavos. Both would agree today.
 * That is the danger rather than the reassurance: two routes to the same pesos
 * is what CONVENTIONS.md says must not exist, and they would part company the
 * first time a loan was edited after a week had been collected. This is the
 * same releasedOnFunding the lender ledgers use, so every figure in the app that
 * says "collected" descends from one rule.
 *
 * Only ACTIVE loans. A loan that has settled is PAID and its whole interest is
 * counted by the caller as settled, so including it here would count it twice.
 */
export async function weeklyCollected(
  userId: string,
  loanWhere: Prisma.LoanWhereInput = {},
): Promise<Centavos> {
  const weekly: Prisma.LoanWhereInput = {
    AND: [loanWhere, { deletedAt: null, status: 'ACTIVE', interestCollection: 'WEEKLY' }],
  }

  const [fundings, weeksPaid] = await Promise.all([
    db.loanFunding.findMany({
      where: { userId, loan: weekly },
      select: {
        earningsCentavos: true,
        adminCutCentavos: true,
        loan: { select: { id: true, termDays: true } },
      },
    }),
    db.payment.findMany({
      where: { userId, deletedAt: null, weekNumber: { not: null }, loan: weekly },
      select: { loanId: true, weekNumber: true },
    }),
  ])

  return sumReleased(fundings, weeksPaid)
}

type FundingRow = {
  earningsCentavos: number
  adminCutCentavos: number
  loan: { id: string; termDays: number }
}

/** The week numbers collected, per loan. Exported because two callers already have the rows. */
export function weeksByLoan(rows: { loanId: string; weekNumber: number | null }[]): Map<string, Set<number>> {
  const byLoan = new Map<string, Set<number>>()
  for (const row of rows) {
    if (row.weekNumber === null) continue
    const weeks = byLoan.get(row.loanId) ?? new Set<number>()
    weeks.add(row.weekNumber)
    byLoan.set(row.loanId, weeks)
  }
  return byLoan
}

/** Interest released across a set of funding rows, given which weeks are collected. */
export function sumReleased(
  fundings: FundingRow[],
  weeksPaid: { loanId: string; weekNumber: number | null }[],
): Centavos {
  const paidByLoan = weeksByLoan(weeksPaid)

  return centavos(
    fundings.reduce((total, row) => {
      const released = releasedOnFunding(
        { earnings: centavos(row.earningsCentavos), adminCut: centavos(row.adminCutCentavos) },
        row.loan.termDays / DAYS_PER_WEEK,
        paidByLoan.get(row.loan.id) ?? new Set(),
      )
      return total + released.earnings + released.adminCut
    }, 0),
  )
}

/** One week of interest that was actually handed over, with whose money it was. */
export type CollectedWeek = {
  loanId: string
  borrowerId: string
  borrowerName: string
  week: number
  paidOn: Date
  interest: Centavos
  /** The Admin's cut on this week. */
  adminCut: Centavos
  /** Each funder's share of this week. The Admin's own row is in here too. */
  lenders: { lenderId: string; isSelf: boolean; earnings: Centavos }[]
  /**
   * The proof attached to this week. The borrower FILE lists it; nothing else
   * does. Empty on a week collected with nothing attached, which the conversion
   * flow produces by design.
   */
  proofs: { storagePath: string; mimeType: string; sizeBytes: number; uploadedAt: Date }[]
}

/**
 * Every week of interest collected in a date range, with its per-funder split.
 *
 * THE FIVE REPORTS ALL NEED THIS AND NONE OF THEM CAN DERIVE IT. A statement
 * covering March has to know which weeks landed in March and whose money each
 * one was; `weeklyCollected` above answers "how much by now", which has no dates
 * in it. Both come off the same stored funding rows, so they cannot disagree.
 *
 * `period` is a Prisma date filter, the same shape the reports already build.
 * Passing nothing returns every week ever collected.
 */
export async function weeksCollectedIn(
  userId: string,
  period?: Prisma.DateTimeFilter,
  /**
   * Narrow to loans in this state. Pass 'ACTIVE' whenever the figure is about
   * what is STILL owed: a repaid loan's weeks belong to no such figure, and
   * subtracting them understates the debt.
   */
  status?: 'ACTIVE' | 'PAID',
): Promise<CollectedWeek[]> {
  const loans = await db.loan.findMany({
    where: {
      userId,
      deletedAt: null,
      interestCollection: 'WEEKLY',
      ...(status ? { status } : {}),
    },
    select: {
      id: true,
      borrowerId: true,
      termDays: true,
      borrower: { select: { firstName: true, lastName: true } },
      fundings: {
        select: {
          lenderId: true,
          earningsCentavos: true,
          adminCutCentavos: true,
          lender: { select: { isSelf: true } },
        },
      },
      payments: {
        where: { deletedAt: null, weekNumber: { not: null }, ...(period ? { paidOn: period } : {}) },
        select: {
          weekNumber: true,
          paidOn: true,
          proofFiles: {
            where: { deletedAt: null },
            orderBy: { uploadedAt: 'asc' },
            select: { storagePath: true, mimeType: true, sizeBytes: true, uploadedAt: true },
          },
        },
      },
    },
  })

  return loans.flatMap((loan) => {
    const isSelf = new Map(loan.fundings.map((funding) => [funding.lenderId, funding.lender.isSelf]))

    const proofsByWeek = new Map(
      loan.payments.map((payment) => [payment.weekNumber as number, payment.proofFiles]),
    )

    return collectedInstalments(
      loan.fundings.map((funding) => ({
        lenderId: funding.lenderId,
        earnings: centavos(funding.earningsCentavos),
        adminCut: centavos(funding.adminCutCentavos),
      })),
      loan.termDays / DAYS_PER_WEEK,
      loan.payments.map((payment) => ({
        week: payment.weekNumber as number,
        paidOn: payment.paidOn,
      })),
    ).map((instalment) => ({
      loanId: loan.id,
      borrowerId: loan.borrowerId,
      borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`,
      week: instalment.week,
      paidOn: instalment.paidOn,
      interest: instalment.interest,
      adminCut: instalment.adminCut,
      lenders: instalment.lenders.map((share) => ({
        lenderId: share.lenderId,
        isSelf: isSelf.get(share.lenderId) ?? false,
        earnings: share.earnings,
      })),
      proofs: proofsByWeek.get(instalment.week) ?? [],
    }))
  })
}

/** What a set of collected weeks gave the Admin: their cut, plus their own capital's earnings. */
export function adminShareOf(weeks: CollectedWeek[]): Centavos {
  return centavos(
    weeks.reduce(
      (total, week) =>
        total +
        week.adminCut +
        week.lenders.reduce((own, share) => own + (share.isSelf ? share.earnings : 0), 0),
      0,
    ),
  )
}

/** What a set of collected weeks gave one lender. The Admin's cut is not in it. */
export function lenderShareOf(weeks: CollectedWeek[], lenderId: string): Centavos {
  return centavos(
    weeks.reduce(
      (total, week) =>
        total + week.lenders.reduce((own, share) => own + (share.lenderId === lenderId ? share.earnings : 0), 0),
      0,
    ),
  )
}
