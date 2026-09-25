import { Prisma } from '@prisma/client'

import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { DAYS_PER_WEEK } from '../../lib/money/weeks.ts'
import { weeklySchedule } from '../../lib/money/weekly.ts'
import { db } from '../db.ts'

/**
 * MONEY THE BORROWER ACTUALLY HANDED OVER, and whose it was.
 *
 * THE ONE SOURCE FOR EVERY "COLLECTED IN THIS PERIOD" FIGURE ON EVERY REPORT.
 * It reads the Payment rows, because those are what record a handover — one per
 * collected week, plus the one that settles the loan.
 *
 * WHY THE REPORTS CANNOT ADD UP LOAN TOTALS INSTEAD, which is what they did
 * until 2026-09-25 and what made three of them wrong:
 *
 *   A weekly loan's settling payment is the capital plus the FINAL week, not the
 *   whole total. Reading `Loan.totalCentavos` for a loan repaid in the period
 *   therefore counts nineteen weeks that were handed over months earlier — and
 *   if those weeks also fell inside the period, counts them twice.
 *
 *   The same mistake in reverse made "still owed" and "still to come" subtract
 *   weeks belonging to loans that had already been repaid, understating a debt on
 *   a statement handed to the borrower.
 *
 * So every peso here comes off a row that says a payment happened, and the
 * interest inside each payment is split by the SAME weeklySchedule the loan page
 * and the lender ledgers use. Nothing is derived from a rate and nothing is
 * counted twice.
 */

/** One payment, with the interest inside it split between whoever earned it. */
export type ReceivedPayment = {
  loanId: string
  borrowerId: string
  borrowerName: string
  paidOn: Date
  /** What the borrower handed over. Capital is included on a settling payment. */
  amount: Centavos
  /** null on the payment that settles the loan; 1..N-1 on a collected week. */
  week: number | null
  /** The Admin's cut inside this payment. */
  adminCut: Centavos
  /** Each funder's earnings inside this payment. The Admin's own row is here too. */
  lenders: { lenderId: string; isSelf: boolean; earnings: Centavos }[]
  proofs: { storagePath: string; mimeType: string; sizeBytes: number; uploadedAt: Date }[]
}

export async function paymentsReceivedIn(
  userId: string,
  period?: Prisma.DateTimeFilter,
): Promise<ReceivedPayment[]> {
  const loans = await db.loan.findMany({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      borrowerId: true,
      termDays: true,
      interestCollection: true,
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
        where: { deletedAt: null, ...(period ? { paidOn: period } : {}) },
        select: {
          weekNumber: true,
          paidOn: true,
          amountCentavos: true,
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
    if (loan.payments.length === 0) return []

    const isSelf = new Map(loan.fundings.map((row) => [row.lenderId, row.lender.isSelf]))
    const weekly = loan.interestCollection === 'WEEKLY'
    const weeks = loan.termDays / DAYS_PER_WEEK
    const schedule = weekly
      ? weeklySchedule(
          loan.fundings.map((funding) => ({
            lenderId: funding.lenderId,
            earnings: centavos(funding.earningsCentavos),
            adminCut: centavos(funding.adminCutCentavos),
          })),
          weeks,
        )
      : null

    /**
     * The interest inside one payment, and whose it is.
     *
     * A collected week is that week's instalment. A settling payment carries the
     * WHOLE interest on a loan collected at the end, and only the FINAL week on a
     * weekly one — because every earlier week was handed over separately and is
     * its own row above.
     */
    const interestIn = (week: number | null) => {
      if (schedule) {
        const instalment = schedule[(week ?? weeks) - 1]
        return {
          adminCut: instalment.adminCut,
          lenders: instalment.lenders.map((share) => ({
            lenderId: share.lenderId,
            isSelf: isSelf.get(share.lenderId) ?? false,
            earnings: share.earnings,
          })),
        }
      }

      return {
        adminCut: centavos(loan.fundings.reduce((total, row) => total + row.adminCutCentavos, 0)),
        lenders: loan.fundings.map((funding) => ({
          lenderId: funding.lenderId,
          isSelf: funding.lender.isSelf,
          earnings: centavos(funding.earningsCentavos),
        })),
      }
    }

    return loan.payments.map((payment) => ({
      loanId: loan.id,
      borrowerId: loan.borrowerId,
      borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`,
      paidOn: payment.paidOn,
      amount: centavos(payment.amountCentavos),
      week: payment.weekNumber,
      ...interestIn(payment.weekNumber),
      proofs: payment.proofFiles,
    }))
  })
}

/** Everything the Admin took from these payments: their cut, plus their own capital's earnings. */
export function adminTakeIn(payments: ReceivedPayment[]): Centavos {
  return centavos(
    payments.reduce(
      (total, payment) =>
        total +
        payment.adminCut +
        payment.lenders.reduce((own, share) => own + (share.isSelf ? share.earnings : 0), 0),
      0,
    ),
  )
}

/** What one lender took from these payments. The Admin's cut is not in it. */
export function lenderTakeIn(payments: ReceivedPayment[], lenderId: string): Centavos {
  return centavos(
    payments.reduce(
      (total, payment) =>
        total +
        payment.lenders.reduce((own, share) => own + (share.lenderId === lenderId ? share.earnings : 0), 0),
      0,
    ),
  )
}

/** The cash the borrower handed over across these payments, capital included. */
export function cashIn(payments: ReceivedPayment[]): Centavos {
  return centavos(payments.reduce((total, payment) => total + payment.amount, 0))
}
