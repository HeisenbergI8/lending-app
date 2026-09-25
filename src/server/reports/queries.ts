import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { type ReportRange, inRange, rangeFilter } from '../../lib/report-range.ts'
import { type TrackRecord, trackRecord } from '../../lib/track-record.ts'
import { type LenderPosition } from '../../lib/money/floating.ts'
import { adminTakeOnLoan } from '../../lib/money/split.ts'
import { db } from '../db.ts'
import { adminShareOf, weeksCollectedIn } from '../payments/collected.ts'
import { adminTakeIn, cashIn, lenderTakeIn, paymentsReceivedIn } from '../payments/received.ts'
import { SETTLING, settledOn, settlingPayment } from '../payments/settled.ts'
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

/** One month of a report's period, for the columns on the preview. */
export type ReportMonth = { label: string; capital: Centavos; interest: Centavos }

/**
 * The three figures every report boils down to, and their shape over the period.
 *
 * This is what the admin sees BEFORE the PDF is made. It is not a fifth report:
 * every figure in it is taken from the rows the report itself already carries,
 * so a preview can never say something the file it precedes does not.
 */
export type ReportPreview = {
  capital: Centavos
  interest: Centavos
  total: Centavos
  /** Oldest first, at most the last twelve months of the range. */
  months: ReportMonth[]
  /**
   * True when the range held more than twelve months and earlier ones were cut.
   * The figures above the chart cover the WHOLE range, so without this the two
   * disagree with nothing on the page to say why — a 2025-06 month worth
   * ₱20,000 vanished from the columns while the total still counted it.
   */
  monthsTruncated: boolean
}

export type OverdueRow = {
  borrowerName: string
  total: Centavos
  /**
   * THE DATE THAT MADE IT LATE, which on a weekly loan is the missed WEEK and
   * not the day the capital is due. Printing the capital date here gave Rico
   * Mendoza "Jan 19, 2027 · 116 days late" on a report — a date in the future
   * beside a negative count, on a document somebody reads.
   */
  dueOn: Date
  /** Days past `dueOn` above. Never negative: an overdue loan is late by definition. */
  daysLate: number
  /** True when the date above is a missed week rather than the loan's own due date. */
  dueIsWeekly: boolean
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
  preview: ReportPreview
}

/**
 * One loan on the Admin's cut report — the loans list, with the Admin's own
 * share of it added.
 *
 * `adminCut` is adminTakeOnLoan over the loan's funding rows: the cut charged
 * on the other funders' capital PLUS what the Admin's own capital earned, if
 * any went in. It is the same figure the loan screen shows as "Admin interest",
 * from the same function, so the report and the screen cannot disagree.
 *
 * It is NOT a percentage of anything on this row. On a fixed-amount loan there
 * is no rate at all, and even on a weekly one the cut is decided per funder.
 */
export type AdminCutLoanRow = {
  loanId: string
  borrowerName: string
  capital: Centavos
  interest: Centavos
  total: Centavos
  startOn: Date
  dueOn: Date
  paidOn: Date | null
  state: LoanState
  /** Whose money funded it, the Admin's own pot shown as "Admin". */
  funders: string[]
  adminCut: Centavos
}

export type AdminCutReport = {
  kind: 'admin-cut'
  header: ReportHeader
  /** Loans that STARTED in the period. The cut on these was agreed, not received. */
  started: AdminCutLoanRow[]
  /** Loans REPAID in the period. The cut on these has actually arrived. */
  repaid: AdminCutLoanRow[]
  /** The cut across `started` — money the Admin is owed as of the day those loans were made. */
  agreed: Centavos
  /** The cut across `repaid` — money that reached the Admin pot in this period. */
  collected: Centavos
  /** As of today, across every running loan whenever it started. */
  outstandingToday: Centavos
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
  /**
   * Weeks of interest collected during the period, on loans still running.
   * Empty unless the reader's money is in a loan that collects weekly.
   */
  weeksPaid: WeekPaidRow[]
  earnedInPeriod: Centavos
  /**
   * The slice of `earnedInPeriod` that is the admin's 2% cut on OTHER funders'
   * principal. Always 0 on a plain lender's statement, and 0 on the admin pot's
   * own statement until the pot lends alongside somebody else.
   */
  adminCutInPeriod: Centavos
  putIn: Centavos
  tookOut: Centavos
  preview: ReportPreview
}

export type ProofRow = {
  /** The file's name in the bucket. The file itself lives in Supabase, never in a report. */
  reference: string
  mimeType: string
  sizeBytes: number
  uploadedAt: Date
}

/**
 * One week of interest collected, on a statement.
 *
 * Both the lender's statement and the borrower's list these now, because a
 * weekly loan is twenty events rather than one and a statement showing a single
 * repayment would describe five months of collections as nothing having
 * happened. FEATURES.md section 5.
 */
export type WeekPaidRow = {
  borrowerName: string
  week: number
  paidOn: Date
  /** The whole week's interest on a borrower's statement; the reader's share on a lender's. */
  amount: Centavos
  /**
   * The proof attached to this week, on the full borrower FILE only. Empty
   * everywhere else, and empty on a week collected with nothing attached.
   *
   * The file is the artefact handed over as evidence, so a weekly loan's twenty
   * weeks of screenshots have to be in it. Listing only the settling payment's
   * proof would hand somebody a file that looks like five months of unevidenced
   * collections.
   */
  proofs: ProofRow[]
  /** A collected week with nothing attached. Flagged on the file, never blocked. */
  missingProof: boolean
}

export type BorrowerLoanRow = {
  capital: Centavos
  interest: Centavos
  total: Centavos
  /** The term in days. Say it with describeTerm — "4 weeks" or "3 days". */
  termDays: number
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
  /** Weeks of interest this borrower handed over during the period. */
  weeksPaid: WeekPaidRow[]
  borrowedInPeriod: Centavos
  paidInPeriod: Centavos
  /** As of today, across every loan — not only the ones in this range. */
  owedToday: Centavos
  preview: ReportPreview
}

export type Report = SummaryReport | AdminCutReport | LenderReport | BorrowerReport

const sum = (amounts: number[]): Centavos => centavos(amounts.reduce((total, n) => total + n, 0))

const fullName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`

const DAY_MS = 86_400_000

const MONTH_LABEL = new Intl.DateTimeFormat('en-PH', { month: 'short' })

/**
 * Boil a report down to capital, interest and a shape over time.
 *
 * Fed the rows the report is already built from, never a fresh query — so the
 * preview cannot disagree with the PDF that follows it.
 *
 * Every month in the range gets a column, empty ones included: a gap where
 * nothing happened is part of the picture, and dropping it would make two busy
 * months either side look consecutive. A range longer than a year is cut to its
 * last twelve columns, because past that they are too thin to read.
 */
function buildPreview(
  rows: { on: Date; capital: number; interest: number }[],
  range: ReportRange,
): ReportPreview {
  const buckets = new Map<string, ReportMonth>()
  const cursor = new Date(range.from.getFullYear(), range.from.getMonth(), 1)
  const last = new Date(range.to.getFullYear(), range.to.getMonth(), 1)

  while (cursor <= last) {
    buckets.set(`${cursor.getFullYear()}-${cursor.getMonth()}`, {
      label: MONTH_LABEL.format(cursor),
      capital: centavos(0),
      interest: centavos(0),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  for (const row of rows) {
    const bucket = buckets.get(`${row.on.getFullYear()}-${row.on.getMonth()}`)
    if (!bucket) continue
    bucket.capital = centavos(bucket.capital + row.capital)
    bucket.interest = centavos(bucket.interest + row.interest)
  }

  const capital = sum(rows.map((row) => row.capital))
  const interest = sum(rows.map((row) => row.interest))

  return {
    capital,
    interest,
    total: centavos(capital + interest),
    months: [...buckets.values()].slice(-12),
    // The cap is deliberate — past twelve the columns are too thin to read — so
    // the honest form is to PRINT the bound, not to drop it. See the chart title.
    monthsTruncated: buckets.size > 12,
  }
}

/** Everything the admin needs to see the month at a glance. */
export async function summaryReport(userId: string, range: ReportRange): Promise<SummaryReport> {
  const period = rangeFilter(range)
  const now = new Date()

  const [made, paid, active, lenders, received] = await Promise.all([
    db.loan.findMany({
      where: { userId, deletedAt: null, startOn: period },
      select: { capitalCentavos: true, interestCentavos: true, startOn: true },
    }),
    // Loans repaid in the period, with the funding rows that say who earned what.
    db.loan.findMany({
      where: {
        userId,
        deletedAt: null,
        status: 'PAID',
        // payments/some, NOT payment. weekNumber: null is load-bearing: without
        // it, a loan whose week 3 was collected in March reads as REPAID in
        // March. The partial unique index means at most one row matches, so
        // `some` and the old to-one ask the same question.
        payments: { some: { weekNumber: null, deletedAt: null, paidOn: period } },
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
      where: { userId, deletedAt: null, status: 'ACTIVE' },
      select: {
        totalCentavos: true,
        dueOn: true,
        nextDueOn: true,
        interestCollection: true,
        borrower: { select: { firstName: true, lastName: true } },
      },
      orderBy: { dueOn: 'asc' },
    }),
    listLenders(userId),
    // EVERY PAYMENT RECEIVED IN THE PERIOD — collected weeks and settlements
    // alike. Not "loans repaid in the period", which on a weekly loan counts
    // nineteen weeks that were handed over months earlier and, if they also fell
    // in this period, counts them twice. See payments/received.ts.
    paymentsReceivedIn(userId, period),
  ])

  const overdue: OverdueRow[] = active
    .filter((loan) => loanState('ACTIVE', loan.nextDueOn, now) === 'overdue')
    .map((loan) => ({
      borrowerName: fullName(loan.borrower),
      total: centavos(loan.totalCentavos),
      // nextDueOn, the date this loan is actually late on. The filter above
      // already reads it; printing loan.dueOn beside it is what produced a
      // future date and a negative day count on the same row.
      dueOn: loan.nextDueOn,
      dueIsWeekly: loan.interestCollection === 'WEEKLY',
      daysLate: Math.round(
        (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
          new Date(
            loan.nextDueOn.getFullYear(),
            loan.nextDueOn.getMonth(),
            loan.nextDueOn.getDate(),
          ).getTime()) /
          DAY_MS,
      ),
    }))
    .sort((a, b) => b.daysLate - a.daysLate)

  return {
    kind: 'summary',
    header: { title: 'Overall summary', subject: null, range, generatedAt: now },
    lentOut: sum(made.map((loan) => loan.capitalCentavos)),
    // WHAT CAME IN, read off the payments themselves. One figure, one source,
    // no arithmetic about which loans happen to be repaid.
    collected: cashIn(received),
    // The Admin's share of those same payments: their cut inside each, plus what
    // their own capital earned inside each.
    earned: adminTakeIn(received),
    loansMade: made.length,
    loansPaid: paid.length,
    outOnLoan: sum(lenders.map((lender) => lender.position.outOnLoan)),
    floating: sum(lenders.map((lender) => lender.position.floating)),
    overdue,
    preview: buildPreview(
      made.map((loan) => ({
        on: loan.startOn,
        capital: loan.capitalCentavos,
        interest: loan.interestCentavos,
      })),
      range,
    ),
  }
}

/**
 * Where the Admin's own money came from, loan by loan.
 *
 * TWO SECTIONS, BECAUSE THE TWO ARE NOT THE SAME MONEY. A loan that started in
 * March promises the Admin a cut; a loan repaid in March hands one over. Rolled
 * into one figure they read as a month's profit, and a month of heavy lending
 * with nothing collected would report a fortune that has not arrived.
 *
 * A loan that both started and was repaid in the period appears in both, and
 * that is correct: it was made in the period AND it paid in the period. The two
 * totals are never added together and the report never prints a sum of them.
 *
 * Every figure comes off the stored funding rows through adminTakeOnLoan — the
 * same function the loan screen and the overall summary use. Nothing here is a
 * second opinion about a peso.
 */
export async function adminCutReport(userId: string, range: ReportRange): Promise<AdminCutReport> {
  const period = rangeFilter(range)
  const now = new Date()

  const [inPeriod, running, received, releasedOnRunning] = await Promise.all([
    db.loan.findMany({
      where: {
        userId,
        deletedAt: null,
        // Started in the period, or repaid in it. One query for both, so a loan
        // that did both is fetched once and appears in both lists from one row.
        OR: [
          { startOn: period },
          // weekNumber: null — see the note at the summary report's where clause.
          { payments: { some: { weekNumber: null, deletedAt: null, paidOn: period } } },
        ],
      },
      select: {
        id: true,
        capitalCentavos: true,
        interestCentavos: true,
        totalCentavos: true,
        startOn: true,
        dueOn: true,
        nextDueOn: true,
        status: true,
        borrower: { select: { firstName: true, lastName: true } },
        payments: { where: SETTLING, select: { paidOn: true, deletedAt: true, weekNumber: true } },
        fundings: {
          select: {
            earningsCentavos: true,
            adminCutCentavos: true,
            lender: { select: { firstName: true, lastName: true, isSelf: true } },
          },
        },
      },
      orderBy: { startOn: 'asc' },
    }),
    // AS OF TODAY, and deliberately not ranged: "still to come" is a fact about
    // now. Every running loan, whenever it started — including ones that began
    // long before this period and will pay long after it.
    db.loan.findMany({
      where: { userId, deletedAt: null, status: 'ACTIVE' },
      select: {
        fundings: {
          select: {
            earningsCentavos: true,
            adminCutCentavos: true,
            lender: { select: { isSelf: true } },
          },
        },
      },
    }),
    // Every payment received in the period, for what the Admin took from them.
    paymentsReceivedIn(userId, period),
    // What the collected weeks have ALREADY put in the pot, on loans STILL
    // RUNNING. Subtracted from "still to come" below. ACTIVE-only matters: a
    // repaid loan's weeks belong to no figure here, and subtracting them
    // understated what is still owed.
    weeksCollectedIn(userId, undefined, 'ACTIVE'),
  ])

  const cutOf = (fundings: { earningsCentavos: number; adminCutCentavos: number; lender: { isSelf: boolean } }[]) =>
    adminTakeOnLoan(
      fundings.map((funding) => ({
        adminCut: centavos(funding.adminCutCentavos),
        earnings: centavos(funding.earningsCentavos),
        isSelf: funding.lender.isSelf,
      })),
    )

  // An undone payment is soft-deleted, not destroyed, so it is still attached to
  // its loan and would otherwise read as a repayment that happened.
  const livePaidOn = (loan: (typeof inPeriod)[number]) =>
    settledOn(loan.payments)

  const rows: AdminCutLoanRow[] = inPeriod.map((loan) => ({
    loanId: loan.id,
    borrowerName: fullName(loan.borrower),
    capital: centavos(loan.capitalCentavos),
    interest: centavos(loan.interestCentavos),
    total: centavos(loan.totalCentavos),
    startOn: loan.startOn,
    dueOn: loan.dueOn,
    paidOn: livePaidOn(loan),
    state: loanState(loan.status, loan.nextDueOn, now),
    funders: loan.fundings.map((funding) =>
      funding.lender.isSelf ? 'Admin' : fullName(funding.lender),
    ),
    adminCut: cutOf(loan.fundings),
  }))

  const started = rows.filter((row) => inRange(row.startOn, range))
  const repaid = rows
    .filter((row) => inRange(row.paidOn, range))
    .sort((a, b) => (a.paidOn?.getTime() ?? 0) - (b.paidOn?.getTime() ?? 0))

  return {
    kind: 'admin-cut',
    header: { title: "Admin's cut", subject: null, range, generatedAt: now },
    started,
    repaid,
    agreed: sum(started.map((row) => row.adminCut)),
    // What the Admin actually took in the period, read off the payments. Not
    // "the cut on loans repaid here", which on a weekly loan is nineteen weeks
    // of cut that arrived earlier.
    collected: adminTakeIn(received),
    // Still to come, MINUS what the running loans' collected weeks have already
    // handed over. Both sides are ACTIVE-only, so nothing is subtracted from a
    // loan that is not in the first sum.
    outstandingToday: centavos(
      sum(running.map((loan) => cutOf(loan.fundings))) - adminShareOf(releasedOnRunning),
    ),
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
  // it finds a deleted lender too — somebody who has just been deleted is
  // exactly who needs a closing statement.
  const [lender, fundings, received] = await Promise.all([
    getLender(userId, lenderId),
    db.loanFunding.findMany({
      where: {
        userId,
        lenderId,
        loan: {
          deletedAt: null,
          // Either the loan started in the period, or it was repaid in it. One
          // query for both, so a loan that did both is fetched once.
          OR: [
            { startOn: period },
            // weekNumber: null — see the note at the summary report's where clause.
            { payments: { some: { weekNumber: null, deletedAt: null, paidOn: period } } },
          ],
        },
      },
      select: {
        principalCentavos: true,
        earningsCentavos: true,
        loan: {
          select: {
            startOn: true,
            dueOn: true,
            nextDueOn: true,
            status: true,
            payments: { where: SETTLING, select: { paidOn: true, deletedAt: true, weekNumber: true } },
            borrower: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { loan: { startOn: 'asc' } },
    }),
    paymentsReceivedIn(userId, period),
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
    state: loanState(funding.loan.status, funding.loan.nextDueOn),
  })

  // An undone payment is soft-deleted, not destroyed, so it is dropped rather than
  // read as a repayment — the loan is running again.
  const paidOn = (funding: (typeof fundings)[number]) =>
    settledOn(funding.loan.payments)

  const repaid = fundings.filter((funding) => inRange(paidOn(funding), range))
  const funded = fundings.filter((funding) => inRange(funding.loan.startOn, range)).map(row)

  // WEEKS COLLECTED IN THE PERIOD, on loans still running. Without these a
  // statement covering five months of a weekly loan paying every single week
  // reports that the reader earned nothing, because no loan was repaid.
  //
  // The reader's own share, not the whole week: on a lender's statement the
  // interest IS their earnings. The Admin pot's statement adds the cut, which is
  // handled by adminCutInPeriod below for the same reason it always was.
  const weeksMine = received.filter(
    (payment) =>
      payment.week !== null &&
      payment.lenders.some((share) => share.lenderId === lenderId && share.earnings > 0),
  )
  const weeksPaid: WeekPaidRow[] = weeksMine
    .map((payment) => ({
      borrowerName: payment.borrowerName,
      week: payment.week as number,
      paidOn: payment.paidOn,
      amount: lenderTakeIn([payment], lenderId),
      // A lender's statement has never listed proof of payment and does not
      // start now: the screenshots are the Admin's record of the borrower, and
      // the borrower FILE is where they belong.
      proofs: [],
      missingProof: false,
    }))
    // By date, then by WEEK. Several weeks are often recorded in one sitting, and
    // on equal dates a raw date sort leaves them in whatever order the rows came
    // back — which printed "2, 1, 4, 3, 5" down a statement.
    .sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime() || a.week - b.week)

  // The cut belongs to the admin pot and to nobody else. `adminCutCentavos` is
  // already 0 on the admin's own funding rows, so this never double-counts the
  // loans the pot funded itself.
  // The Admin's cut inside every payment received in the period — collected
  // weeks and settlements alike. Read off the payments rather than off "loans
  // repaid here", which on a weekly loan is nineteen weeks of cut that arrived
  // earlier and would be counted again beside the weeks below.
  const adminCutInPeriod = lender.isSelf
    ? centavos(received.reduce((total, payment) => total + payment.adminCut, 0))
    : centavos(0)

  return {
    kind: 'lender',
    header: {
      title: lender.isSelf ? 'Admin pot' : 'Lender statement',
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
    funded,
    repaid: repaid.map(row),
    weeksPaid,
    // "Earned on loans repaid in this period" is everything the pot took from
    // those repayments. For the admin that is their own earnings PLUS their cut
    // on the other funders' share, and the cut is the larger half whenever the
    // pot's own capital was not in the loan. Summing only this lender's funding
    // rows reported a statement short by exactly SUM("adminCutCentavos"), with
    // no line anywhere admitting the gap.
    // Their own capital's earnings inside every payment received in the period,
    // plus the cut when this is the Admin pot. One source, no overlap: a weekly
    // loan's earlier weeks are their own payments and its settlement carries only
    // the final one.
    earnedInPeriod: centavos(lenderTakeIn(received, lenderId) + adminCutInPeriod),
    adminCutInPeriod,
    putIn: sum(moves.filter((move) => move.type === 'DEPOSIT').map((move) => move.amount)),
    tookOut: sum(moves.filter((move) => move.type === 'WITHDRAWAL').map((move) => move.amount)),
    // On a lender's statement the interest IS their earnings: their share of
    // what the borrower paid on the capital they put up.
    preview: buildPreview(
      funded.map((loan) => ({ on: loan.startOn, capital: loan.principal, interest: loan.earnings })),
      range,
    ),
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
  const [borrower, receivedEver, weeksOnRunning] = await Promise.all([
    db.borrower.findFirst({
    where: { id: borrowerId, userId },
    select: {
      firstName: true,
      lastName: true,
      manualLabel: true,
      loans: {
        where: { deletedAt: null },
        orderBy: { startOn: 'asc' },
        select: {
          capitalCentavos: true,
          interestCentavos: true,
          totalCentavos: true,
          termDays: true,
          startOn: true,
          dueOn: true,
          nextDueOn: true,
          status: true,
          payments: {
            select: {
              weekNumber: true,
              paidOn: true,
              amountCentavos: true,
              deletedAt: true,
              proofFiles: {
                where: { deletedAt: null },
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
    }),
    // Every payment this borrower has ever made, for the list below.
    paymentsReceivedIn(userId),
    // The weeks already collected on their loans that are STILL RUNNING, which
    // is what "still owes today" subtracts. ACTIVE-only: a repaid loan's weeks
    // are not part of any debt, and subtracting them understated what the
    // borrower owes on a statement handed to them.
    weeksCollectedIn(userId, undefined, 'ACTIVE'),
  ])
  if (!borrower) return null

  const mine = receivedEver.filter((payment) => payment.borrowerId === borrowerId)
  const weeksPaid: WeekPaidRow[] = mine
    .filter((payment) => payment.week !== null && inRange(payment.paidOn, range))
    .map((week) => ({
      borrowerName: week.borrowerName,
      week: week.week as number,
      paidOn: week.paidOn,
      // The WHOLE week on a borrower's statement: what they handed over, not
      // anybody's share of it.
      amount: week.amount,
      // Only on the full FILE, the same rule the loans above follow — the plain
      // statement is for the borrower and lists what they paid, the file is the
      // Admin's own record and lists the evidence.
      proofs: withProof
        ? week.proofs.map((file) => ({
            reference: file.storagePath.split('/').pop() ?? file.storagePath,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            uploadedAt: file.uploadedAt,
          }))
        : [],
      missingProof: week.proofs.length === 0,
    }))
    // By date, then by WEEK. Several weeks are often recorded in one sitting, and
    // on equal dates a raw date sort leaves them in whatever order the rows came
    // back — which printed "2, 1, 4, 3, 5" down a statement.
    .sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime() || a.week - b.week)

  const livePayment = (loan: (typeof borrower.loans)[number]) =>
    settlingPayment(loan.payments)

  // The record and what is owed are counted across EVERY loan, not only the ones
  // in the range: a track record that changed with the dates on a report would
  // not be a track record.
  const record = trackRecord(
    borrower.loans.map((loan) => ({
      status: loan.status,
      // The next owed date, not the capital date — see BorrowerLoanRecord.
      dueOn: loan.nextDueOn,
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
        termDays: loan.termDays,
        startOn: loan.startOn,
        dueOn: loan.dueOn,
        state: loanState(loan.status, loan.nextDueOn),
        paidOn: payment?.paidOn ?? null,
        funders: loan.fundings.map((funding) =>
          funding.lender.isSelf ? 'Admin' : fullName(funding.lender),
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
    weeksPaid,
    borrowedInPeriod: sum(
      loans.filter((loan) => inRange(loan.startOn, range)).map((loan) => loan.capital),
    ),
    // WHAT THEY HANDED OVER IN THE PERIOD, read off their payments. Every
    // collected week and every settlement, each counted once.
    //
    // NOT "loans settled in the period, plus the weeks". On a weekly loan the
    // settling payment is the capital plus the FINAL week, while the loan's total
    // is the capital plus all twenty — so reading the total counted nineteen
    // weeks that were handed over earlier, and counted them twice when they fell
    // inside this period too.
    paidInPeriod: cashIn(mine.filter((payment) => inRange(payment.paidOn, range))),
    // What they still owe: the totals on their RUNNING loans, minus the weeks
    // already collected on those same running loans. Both sides are ACTIVE-only,
    // so nothing is subtracted from a loan that is not in the first sum.
    owedToday: centavos(
      sum(borrower.loans.filter((loan) => loan.status === 'ACTIVE').map((loan) => loan.totalCentavos)) -
        sum(
          weeksOnRunning
            .filter((week) => week.borrowerId === borrowerId)
            .map((week) => week.interest),
        ),
    ),
    // Only loans that STARTED in the range. A loan listed because it was repaid
    // in the range had its capital handed over earlier, and counting it here
    // would say the admin lent money in a month they did not.
    preview: buildPreview(
      loans
        .filter((loan) => inRange(loan.startOn, range))
        .map((loan) => ({ on: loan.startOn, capital: loan.capital, interest: loan.interest })),
      range,
    ),
  }
}
