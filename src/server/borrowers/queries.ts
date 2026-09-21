import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { type TrackRecord, trackRecord } from '../../lib/track-record.ts'
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
}

export type BorrowerLoan = {
  id: string
  capital: Centavos
  total: Centavos
  interest: Centavos
  weeks: number
  startOn: Date
  dueOn: Date
  state: LoanState
  paidOn: Date | null
  /** A payment recorded with no file attached. Flagged, never blocked. */
  missingProof: boolean
  funders: { lenderId: string; name: string; principal: Centavos }[]
}

export type BorrowerDetail = BorrowerSummary & { loans: BorrowerLoan[] }

/** Every borrower with their counted record, worst standing first. */
export async function listBorrowers(userId: string): Promise<BorrowerSummary[]> {
  const borrowers = await db.borrower.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      manualLabel: true,
      loans: {
        where: { archivedAt: null },
        select: {
          status: true,
          dueOn: true,
          totalCentavos: true,
          payment: { select: { paidOn: true } },
        },
      },
    },
  })

  return borrowers.map((borrower) => {
    const loans = borrower.loans.map((loan) => ({
      status: loan.status,
      dueOn: loan.dueOn,
      paidOn: loan.payment?.paidOn ?? null,
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
    }
  })
}

/** One borrower, with every loan they have ever taken. */
export async function getBorrower(userId: string, borrowerId: string): Promise<BorrowerDetail | null> {
  const borrower = await db.borrower.findFirst({
    where: { id: borrowerId, userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      manualLabel: true,
      loans: {
        where: { archivedAt: null },
        orderBy: { startOn: 'desc' },
        select: {
          id: true,
          capitalCentavos: true,
          totalCentavos: true,
          interestCentavos: true,
          weeks: true,
          startOn: true,
          dueOn: true,
          status: true,
          payment: { select: { paidOn: true, proofFiles: { where: { archivedAt: null }, select: { id: true } } } },
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

  const loans: BorrowerLoan[] = borrower.loans.map((loan) => ({
    id: loan.id,
    capital: centavos(loan.capitalCentavos),
    total: centavos(loan.totalCentavos),
    interest: centavos(loan.interestCentavos),
    weeks: loan.weeks,
    startOn: loan.startOn,
    dueOn: loan.dueOn,
    state: loanState(loan.status, loan.dueOn),
    paidOn: loan.payment?.paidOn ?? null,
    missingProof: loan.payment !== null && loan.payment.proofFiles.length === 0,
    funders: loan.fundings.map((funding) => ({
      lenderId: funding.lenderId,
      name: funding.lender.isSelf ? 'You' : `${funding.lender.firstName} ${funding.lender.lastName}`,
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
        paidOn: loan.payment?.paidOn ?? null,
      })),
    ),
    outstanding: centavos(
      borrower.loans
        .filter((loan) => loan.status === 'ACTIVE')
        .reduce((sum, loan) => sum + loan.totalCentavos, 0),
    ),
    loans,
  }
}
