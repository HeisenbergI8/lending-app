import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { type ReportRange, inRange, rangeFilter } from '../../lib/report-range.ts'
import { type TrackRecord, trackRecord } from '../../lib/track-record.ts'
import { type LenderPosition } from '../../lib/money/floating.ts'
import { adminTakeOnLoan } from '../../lib/money/split.ts'
import { db } from '../db.ts'
import { getLender, listLenders } from '../lenders/queries.ts'

/**
 * Gathering what a report says.
 *
 * Nothing here computes money that the app already computes elsewhere. A
 * lender's position comes from `listLenders`, a borrower's record from
 * `trackRecord`, every loan figure straight out of the row it was stored in.
 * A report that did its own arithmetic would be a second opinion about the same
 * pesos, and the admin would have no way to tell which one to believe when they
 * disagreed.
 *
 * Two kinds of figure appear side by side and are labelled apart everywhere they
 * are shown:
 *
 *   IN THIS PERIOD — events whose own date falls in the range: loans by the day
 *   they started, payments by the day they arrived, a lender's money in or out
 *   by the day it moved.
 *
 *   AS OF TODAY — floating funds, what is still out, what a borrower owes. The
 *   ledger stores movements rather than nightly balances, so these cannot be
 *   rewound to an earlier date without inventing the answer.
 *
 * Every query filters on userId. The demo account a recruiter opens must never
 * be able to render a report about a real borrower.
 */

export type ReportHeader = {
  title: string
  subject: string | null
  range: ReportRange
  generatedAt: Date
}

export type OverdueRow = {
  borrowerName: string
  total: Centavos
  dueOn: Date
  daysLate: number
}

export type SummaryReport = {
  kind: 'summary'
  header: ReportHeader
  /** Capital handed to borrowers in the period. */
  lentOut: Centavos
  /** Repayments received in the period, at their full total. */
  collected: Centavos
  /** What the admin kept on loans repaid in the period: their cut plus their own capital's earnings. */
  earned: Centavos
  loansMade: number
  loansPaid: number
  /** As of today. */
  outOnLoan: Centavos
  /** As of today. */
  floating: Centavos
  /** As of today, worst first. */
  overdue: OverdueRow[]
}

export type LenderLoanRow = {
  borrowerName: string
  principal: Centavos
  earnings: Centavos
  startOn: Date
  dueOn: Date
  state: LoanState
}

/** Where a lender's money is today. There is no start date on this one — the question is where it IS. */
export type LenderOutRow = {
  borrowerName: string
  principal: Centavos
  earnings: Centavos
  dueOn: Date
  state: LoanState
}

export type LenderMoveRow = {
  occurredOn: Date
  type: 'DEPOSIT' | 'WITHDRAWAL'
  amount: Centavos
  note: string | null
}

export type LenderReport = {
  kind: 'lender'
  header: ReportHeader
  position: LenderPosition
  moves: LenderMoveRow[]
  /** Where their money is TODAY, whenever those loans started. */
  outWith: LenderOutRow[]
  /** Loans their money went into during the period. */
  funded: LenderLoanRow[]
  /** Loans of theirs repaid during the period, and what those earned them. */
  repaid: LenderLoanRow[]
  earnedInPeriod: Centavos
  putIn: Centavos
  tookOut: Centavos
}

export type ProofRow = {
  /** The file's name in the bucket. The file itself lives in Supabase, never in a report. */
  reference: string
  mimeType: string
  sizeBytes: number
  uploadedAt: Date
}

export type BorrowerLoanRow = {
  capital: Centavos
  interest: Centavos
  total: Centavos
  weeks: number
  startOn: Date
  dueOn: Date
  state: LoanState
  paidOn: Date | null
  funders: string[]
  /** Only gathered for the full file. */
  proofs: ProofRow[]
  /** True when a payment was recorded with nothing attached. Flagged, never blocked. */
  missingProof: boolean
}

export type BorrowerReport = {
  kind: 'borrower' | 'borrower-file'
  header: ReportHeader
  label: 'GOOD' | 'OKAY' | 'BAD' | null
  record: TrackRecord
  loans: BorrowerLoanRow[]
  borrowedInPeriod: Centavos
  paidInPeriod: Centavos
  /** As of today, across every loan — not only the ones in this range. */
  owedToday: Centavos
}

export type Report = SummaryReport | LenderReport | BorrowerReport

const sum = (amounts: number[]): Centavos => centavos(amounts.reduce((total, n) => total + n, 0))

const fullName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`

const DAY_MS = 86_400_000

/** Everything the admin needs to see the month at a glance. */
export async function summaryReport(userId: string, range: ReportRange): Promise<SummaryReport> {
  const period = rangeFilter(range)
  const now = new Date()

  const [made, paid, active, lenders] = await Promise.all([
    db.loan.findMany({
      where: { userId, archivedAt: null, startOn: period },
      select: { capitalCentavos: true },
    }),
    // Loans repaid in the period, with the funding rows that say who earned what.
    db.loan.findMany({
      where: {
        userId,
        archivedAt: null,
        status: 'PAID',
        payment: { archivedAt: null, paidOn: period },
      },
      select: {
        totalCentavos: true,
        fundings: {
          select: {
            earningsCentavos: true,
            adminCutCentavos: true,
            lender: { select: { isSelf: true } },
          },
        },
      },
    }),
    db.loan.findMany({
      where: { userId, archivedAt: null, status: 'ACTIVE' },
      select: {
        totalCentavos: true,
        dueOn: true,
        borrower: { select: { firstName: true, lastName: true } },
      },
      orderBy: { dueOn: 'asc' },
    }),
    listLenders(userId),
  ])

  // The admin's take on a repaid loan comes from the same rule the loan screen
  // uses — see adminTakeOnLoan. A report must not be a second opinion.
  const earned = sum(
    paid.map((loan) =>
      adminTakeOnLoan(
        loan.fundings.map((funding) => ({
          adminCut: centavos(funding.adminCutCentavos),
          earnings: centavos(funding.earningsCentavos),
          isSelf: funding.lender.isSelf,
        })),
      ),
    ),
  )

  const overdue: OverdueRow[] = active
    .filter((loan) => loanState('ACTIVE', loan.dueOn, now) === 'overdue')
    .map((loan) => ({
      borrowerName: fullName(loan.borrower),
      total: centavos(loan.totalCentavos),
      dueOn: loan.dueOn,
      daysLate: Math.round(
        (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
          new Date(loan.dueOn.getFullYear(), loan.dueOn.getMonth(), loan.dueOn.getDate()).getTime()) /
          DAY_MS,
      ),
    }))
    .sort((a, b) => b.daysLate - a.daysLate)

  return {
    kind: 'summary',
    header: { title: 'Overall summary', subject: null, range, generatedAt: now },
    lentOut: sum(made.map((loan) => loan.capitalCentavos)),
    collected: sum(paid.map((loan) => loan.totalCentavos)),
    earned,
    loansMade: made.length,
    loansPaid: paid.length,
    outOnLoan: sum(lenders.map((lender) => lender.position.outOnLoan)),
    floating: sum(lenders.map((lender) => lender.position.floating)),
    overdue,
  }
}

/** A statement to hand a lender: what they put in, where it went, what it earned. */
export async function lenderReport(
  userId: string,
  lenderId: string,
  range: ReportRange,
): Promise<LenderReport | null> {
  const period = rangeFilter(range)

  // getLender rather than listLenders: it carries where the money is TODAY, and
  // it finds an archived lender too — somebody who has been archived is exactly
  // who needs a closing statement.
  const [lender, fundings] = await Promise.all([
    getLender(userId, lenderId),
    db.loanFunding.findMany({
      where: {
        userId,
        lenderId,
        loan: {
          archivedAt: null,
          // Either the loan started in the period, or it was repaid in it. One
          // query for both, so a loan that did both is fetched once.
          OR: [{ startOn: period }, { payment: { archivedAt: null, paidOn: period } }],
        },
      },
      select: {
        principalCentavos: true,
        earningsCentavos: true,
        loan: {
          select: {
            startOn: true,
            dueOn: true,
            status: true,
            payment: { select: { paidOn: true, archivedAt: true } },
            borrower: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { loan: { startOn: 'asc' } },
    }),
  ])
  if (!lender) return null

  // Their money in and out, narrowed to the period. getLender already fetched
  // every one of them; a lender has tens of these, not thousands.
  const moves = lender.transactions
    .filter((move) => inRange(move.occurredOn, range))
    .sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime())

  const row = (funding: (typeof fundings)[number]): LenderLoanRow => ({
    borrowerName: fullName(funding.loan.borrower),
    principal: centavos(funding.principalCentavos),
    earnings: centavos(funding.earningsCentavos),
    startOn: funding.loan.startOn,
    dueOn: funding.loan.dueOn,
    state: loanState(funding.loan.status, funding.loan.dueOn),
  })

  // An undone payment is archived, not destroyed, so it is dropped rather than
  // read as a repayment — the loan is running again.
  const paidOn = (funding: (typeof fundings)[number]) =>
    funding.loan.payment?.archivedAt === null ? funding.loan.payment.paidOn : null

  const repaid = fundings.filter((funding) => inRange(paidOn(funding), range))

  return {
    kind: 'lender',
    header: {
      title: lender.isSelf ? 'Your own pot' : 'Lender statement',
      subject: fullName(lender),
      range,
      generatedAt: new Date(),
    },
    position: lender.position,
    moves: moves.map((move) => ({
      occurredOn: move.occurredOn,
      type: move.type,
      amount: move.amount,
      note: move.note,
    })),
    // The figure above says how much is still out; this says where it is. A
    // statement that gives the first without the second cannot be reconciled by
    // the person holding it, and the loan it is in may well predate the range.
    outWith: lender.fundings.map((funding) => ({
      borrowerName: funding.borrowerName,
      principal: funding.principal,
      earnings: funding.earnings,
      dueOn: funding.dueOn,
      state: funding.state,
    })),
    funded: fundings.filter((funding) => inRange(funding.loan.startOn, range)).map(row),
    repaid: repaid.map(row),
    earnedInPeriod: sum(repaid.map((funding) => funding.earningsCentavos)),
    putIn: sum(moves.filter((move) => move.type === 'DEPOSIT').map((move) => move.amount)),
    tookOut: sum(moves.filter((move) => move.type === 'WITHDRAWAL').map((move) => move.amount)),
  }
}

/**
 * A borrower's statement, or their whole file.
 *
 * One function for both: the full file is the same report with every payment's
 * proof listed under it. Two functions would be two places to fix the day a
 * figure is wrong.
 */
export async function borrowerReport(
  userId: string,
  borrowerId: string,
  range: ReportRange,
  { withProof }: { withProof: boolean },
): Promise<BorrowerReport | null> {
  // No range filter in the query: a borrower's file is a handful of rows, and
  // the record and what they owe are counted across ALL of them. The range
  // decides which loans are LISTED, further down.
  const borrower = await db.borrower.findFirst({
    where: { id: borrowerId, userId },
    select: {
      firstName: true,
      lastName: true,
      manualLabel: true,
      loans: {
        where: { archivedAt: null },
        orderBy: { startOn: 'asc' },
        select: {
          capitalCentavos: true,
          interestCentavos: true,
          totalCentavos: true,
          weeks: true,
          startOn: true,
          dueOn: true,
          status: true,
          payment: {
            select: {
              paidOn: true,
              archivedAt: true,
              proofFiles: {
                where: { archivedAt: null },
                orderBy: { uploadedAt: 'asc' },
                select: { storagePath: true, mimeType: true, sizeBytes: true, uploadedAt: true },
              },
            },
          },
          fundings: {
            select: { lender: { select: { firstName: true, lastName: true, isSelf: true } } },
          },
        },
      },
    },
  })
  if (!borrower) return null

  const livePayment = (loan: (typeof borrower.loans)[number]) =>
    loan.payment?.archivedAt === null ? loan.payment : null

  // The record and what is owed are counted across EVERY loan, not only the ones
  // in the range: a track record that changed with the dates on a report would
  // not be a track record.
  const record = trackRecord(
    borrower.loans.map((loan) => ({
      status: loan.status,
      dueOn: loan.dueOn,
      paidOn: livePayment(loan)?.paidOn ?? null,
    })),
  )

  const loans: BorrowerLoanRow[] = borrower.loans
    .filter((loan) => inRange(loan.startOn, range) || inRange(livePayment(loan)?.paidOn, range))
    .map((loan) => {
      const payment = livePayment(loan)
      return {
        capital: centavos(loan.capitalCentavos),
        interest: centavos(loan.interestCentavos),
        total: centavos(loan.totalCentavos),
        weeks: loan.weeks,
        startOn: loan.startOn,
        dueOn: loan.dueOn,
        state: loanState(loan.status, loan.dueOn),
        paidOn: payment?.paidOn ?? null,
        funders: loan.fundings.map((funding) =>
          funding.lender.isSelf ? 'You' : fullName(funding.lender),
        ),
        proofs:
          withProof && payment
            ? payment.proofFiles.map((file) => ({
                reference: file.storagePath.split('/').pop() ?? file.storagePath,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                uploadedAt: file.uploadedAt,
              }))
            : [],
        missingProof: payment !== null && payment.proofFiles.length === 0,
      }
    })

  return {
    kind: withProof ? 'borrower-file' : 'borrower',
    header: {
      title: withProof ? 'Borrower file' : 'Borrower statement',
      subject: fullName(borrower),
      range,
      generatedAt: new Date(),
    },
    label: borrower.manualLabel,
    record,
    loans,
    borrowedInPeriod: sum(
      loans.filter((loan) => inRange(loan.startOn, range)).map((loan) => loan.capital),
    ),
    paidInPeriod: sum(loans.filter((loan) => inRange(loan.paidOn, range)).map((loan) => loan.total)),
    owedToday: sum(
      borrower.loans.filter((loan) => loan.status === 'ACTIVE').map((loan) => loan.totalCentavos),
    ),
  }
}
