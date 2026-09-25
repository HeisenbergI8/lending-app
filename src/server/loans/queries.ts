import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type InterestBasis, type InterestCollection } from '../../lib/money/interest.ts'
import { type AdminStake, adminStakeInLoan, adminTakeOnLoan } from '../../lib/money/split.ts'
import { type LoanFilter, NO_FILTER } from '../../lib/loan-filter.ts'
import { type LoanState, storedLoanState } from '../../lib/loan-state.ts'
import { DAYS_PER_WEEK, calendarDate } from '../../lib/money/weeks.ts'
import {
  MIN_WEEKLY_WEEKS,
  nextUnpaidWeek,
  releasedOnFunding,
  weeklyDueDates,
  weeklySchedule,
} from '../../lib/money/weekly.ts'
import { PAGE_SIZE, type PageWindow } from '../../lib/pagination.ts'
import { db } from '../db.ts'
import { weeklyCollected } from '../payments/collected.ts'
import { settlingPayment } from '../payments/settled.ts'

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
  /** Per week. Null on a fixed-amount loan, where no rate was used. */
  lenderRateBps: number | null
  adminCutBps: number | null
}

/** A funder on the list, where only the name and the amount fit. */
export type LoanRowFunder = { lenderId: string; name: string; principal: Centavos }

export type LoanRow = {
  id: string
  borrowerId: string
  borrowerName: string
  capital: Centavos
  total: Centavos
  /**
   * THE NEXT DAY MONEY IS OWED, which is not always the loan's due date.
   *
   * On a loan collected at the end the two are the same. On one collecting its
   * interest weekly this is the earliest unpaid WEEK, and the capital date lives
   * on the loan page — the only screen that shows both. `dueIsWeekly` says
   * which of the two this is, because the words beside a date are the claim it
   * makes, and "due 3 Oct" on a weekly row claims the wrong one.
   */
  dueOn: Date
  /** True when `dueOn` above is a weekly instalment rather than the loan's own due date. */
  dueIsWeekly: boolean
  state: LoanState
  /** Whose money this is, largest share first. */
  funders: LoanRowFunder[]
  /**
   * The most recent note on this loan, or null when nothing has been written.
   *
   * THE LATEST ONE ONLY, and the card says so when there are more — see
   * `noteCount`. A page of loans cannot carry every note on every one of them,
   * and the newest is the one that answers "where did this get to".
   */
  latestNote: { body: string; createdAt: Date } | null
  /** How many notes the loan has. The bound on `latestNote`, printed rather than hidden. */
  noteCount: number
}

/** One of the Admin's own remarks on a loan. Holds no figure and is never summed. */
export type LoanNoteRow = {
  id: string
  body: string
  createdAt: Date
}

/** Money the Admin drew against this loan before the borrower repaid it. */
export type AdvanceRow = {
  id: string
  amount: Centavos
  occurredOn: Date
  note: string | null
}

// The detail page carries a RICHER funder than the list does — rates, earnings,
// the admin's cut — so the list's leaner one is dropped rather than intersected
// with it. An intersection of the two arrays type-checks and then means neither.
// `latestNote` / `noteCount` go with it: the detail page carries EVERY note in
// `notes` below, and a "latest" shortcut beside the full list is a second way to
// say the same thing that can only ever disagree with it.
export type LoanDetail = Omit<LoanRow, 'funders' | 'latestNote' | 'noteCount'> & {
  interest: Centavos
  /** The term in days. Say it with describeTerm — "4 weeks" or "3 days". */
  termDays: number
  startOn: Date
  interestBasis: InterestBasis
  interestCollection: InterestCollection
  /** The day the CAPITAL comes back. On a weekly loan this is NOT `dueOn` above. */
  capitalDueOn: Date
  /** Empty on a loan collected at the end. */
  weeks: LoanWeekRow[]
  /** Collected so far, added up from `weeks` so the two cannot disagree. */
  weeklyCollected: Centavos
  /** Still owed: the weeks not yet collected, plus the capital. */
  weeklyOutstanding: Centavos
  /**
   * The schedule this loan WOULD get if it were switched to weekly collection,
   * or null when it cannot be. Null on a loan that is already weekly, on a
   * fixed-amount loan, on a paid one, on one with a payment recorded, and on one
   * shorter than two weeks.
   *
   * Offered from here rather than worked out in the screen, because what a week
   * would come to is a peso decision and those do not live in components.
   */
  convertible: { weeks: number; weeklyInterest: Centavos; weekDates: Date[] } | null
  /** What the borrower pays per week. Null on a fixed-amount loan. */
  borrowerRateBps: number | null
  paidOn: Date | null
  missingProof: boolean
  funders: LoanFunder[]
  /** The admin's cut across the whole loan, plus what their own capital earned. */
  adminEarnings: Centavos
  /** What everyone ELSE earns — the interest that is not the admin's. The two always add up to `interest`. */
  lenderEarnings: Centavos
  /** The Admin's own remarks, newest first. */
  notes: LoanNoteRow[]
  /** Advances drawn against this loan, newest first. Live rows only — a deleted one is not one. */
  advances: AdvanceRow[]
  /**
   * What this loan returns to the Admin pot, what has been drawn early, and
   * what is left to draw. See adminStakeInLoan — the three are worked out
   * together so they cannot disagree on screen.
   */
  adminStake: AdminStake
}

/** One week of a weekly loan, as the loan page lists it. */
export type LoanWeekRow = {
  week: number
  dueOn: Date
  interest: Centavos
  /** The day it was collected, or null while it is still owed. */
  paidOn: Date | null
  /** The payment row, so proof can be attached to THIS week. Null while unpaid. */
  paymentId: string | null
  /** A collected week with nothing attached. Flagged, never blocked. */
  missingProof: boolean
  /**
   * True for the last week, which is handed over WITH the capital in one
   * payment and so is never collected on its own. The row says so rather than
   * offering a button the server would refuse.
   */
  withCapital: boolean
  /** The earliest unpaid week — the only one that carries a button. */
  isNext: boolean
}

type WeeklyLoanRow = {
  startOn: Date
  termDays: number
  interestCollection: InterestCollection
  totalCentavos: number
  fundings: {
    lenderId: string
    earningsCentavos: number
    adminCutCentavos: number
    lender: { isSelf: boolean }
  }[]
  payments: {
    id: string
    weekNumber: number | null
    paidOn: Date
    deletedAt: Date | null
    proofFiles: { id: string }[]
  }[]
}

/**
 * What this loan's weekly schedule WOULD be, or null when it cannot have one.
 *
 * The refusals mirror convertToWeekly exactly, so the button is not offered on a
 * loan the server would turn down. Keeping them in step matters more than
 * keeping them in one place: this one decides whether a screen appears, and that
 * one decides whether money is written.
 */
function convertibleToWeekly(loan: WeeklyLoanRow & {
  status: 'ACTIVE' | 'PAID'
  interestBasis: InterestBasis
  dueOn: Date
}): { weeks: number; weeklyInterest: Centavos; weekDates: Date[] } | null {
  if (loan.interestCollection === 'WEEKLY') return null
  if (loan.interestBasis !== 'WEEKLY_RATE') return null
  if (loan.status === 'PAID') return null
  if (loan.payments.some((payment) => payment.deletedAt === null)) return null

  const weeks = loan.termDays / DAYS_PER_WEEK
  if (!Number.isInteger(weeks) || weeks < MIN_WEEKLY_WEEKS) return null

  const schedule = weeklySchedule(
    loan.fundings.map((funding) => ({
      lenderId: funding.lenderId,
      earnings: centavos(funding.earningsCentavos),
      adminCut: centavos(funding.adminCutCentavos),
    })),
    weeks,
  )

  return {
    weeks,
    // Week one, which every week but the last is equal to. The last carries the
    // remainder and is handed over with the capital.
    weeklyInterest: schedule[0].interest,
    weekDates: weeklyDueDates(loan.startOn, weeks),
  }
}

/**
 * The week by week schedule a loan page shows, and the figures beside it.
 *
 * Built in the server layer from rows the query already fetched, because the
 * rule in CONVENTIONS.md is that every peso decision lives in src/lib/money/ and
 * the screen renders what it is handed. The UI does no arithmetic.
 *
 * Empty on a loan collected at the end, which is the shape the page checks.
 */
function weeklyDetail(loan: WeeklyLoanRow): {
  weeks: LoanWeekRow[]
  collected: Centavos
  outstanding: Centavos
  releasedToAdmin: Centavos
} {
  if (loan.interestCollection !== 'WEEKLY') {
    return {
      weeks: [],
      collected: centavos(0),
      outstanding: centavos(loan.totalCentavos),
      releasedToAdmin: centavos(0),
    }
  }

  const weeks = loan.termDays / DAYS_PER_WEEK
  const schedule = weeklySchedule(
    loan.fundings.map((funding) => ({
      lenderId: funding.lenderId,
      earnings: centavos(funding.earningsCentavos),
      adminCut: centavos(funding.adminCutCentavos),
    })),
    weeks,
  )
  const dates = weeklyDueDates(loan.startOn, weeks)

  const live = new Map(
    loan.payments
      .filter((payment) => payment.weekNumber !== null && payment.deletedAt === null)
      .map((payment) => [payment.weekNumber as number, payment]),
  )
  const next = nextUnpaidWeek(loan.startOn, weeks, new Set(live.keys()))

  const rows: LoanWeekRow[] = schedule.map((instalment, index) => {
    const payment = live.get(instalment.week) ?? null
    return {
      week: instalment.week,
      dueOn: dates[index],
      interest: instalment.interest,
      paidOn: payment?.paidOn ?? null,
      paymentId: payment?.id ?? null,
      missingProof: payment !== null && payment.proofFiles.length === 0,
      withCapital: instalment.week === weeks,
      isNext: next?.week === instalment.week,
    }
  })

  // EVERY PESO FIGURE ON THIS PAGE GOES THROUGH releasedOnFunding, including the
  // one that could obviously be added up from the rows above.
  //
  // Adding up the rows is what this did until 2026-09-25 and it was the wrong
  // call, not a harmless shortcut: it gave the loan page its own second opinion
  // about how much had been collected, and on a loan with a skipped week that
  // opinion differed from the loans list, the dashboard and the borrower's
  // balance by whole weeks. The rows and the tile still agree, because both are
  // now slices of the same stored split.
  const released = loan.fundings.map((funding) => ({
    isSelf: funding.lender.isSelf,
    ...releasedOnFunding(
      { earnings: centavos(funding.earningsCentavos), adminCut: centavos(funding.adminCutCentavos) },
      weeks,
      new Set(live.keys()),
    ),
  }))

  const collected = released.reduce((total, row) => total + row.earnings + row.adminCut, 0)

  // What the collected weeks have already put in the Admin's pot: their cut on
  // every row, plus what their own capital earned on the rows they funded.
  const releasedToAdmin = released.reduce(
    (total, row) => total + row.adminCut + (row.isSelf ? row.earnings : 0),
    0,
  )

  return {
    weeks: rows,
    collected: centavos(collected),
    outstanding: centavos(loan.totalCentavos - collected),
    releasedToAdmin: centavos(releasedToAdmin),
  }
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

  // THE DATE RANGE AND THE STATUS FILTER ASK DIFFERENT QUESTIONS, and on a
  // weekly loan they stop having the same answer.
  //
  //   "due between these dates" means the loan's own due date — the day the
  //   capital comes back, which is what the Admin typed and remembers.
  //
  //   "overdue" and "active" mean the next day money is owed, which on a weekly
  //   loan is the earliest unpaid week and may be four months earlier.
  //
  // Filtering both on one column made a weekly loan three weeks behind read as
  // Active, because its capital date is in February. They are separate keys on
  // the same `where`, so both bounds still have to hold.
  const dueOn = {
    ...(filter.from ? { gte: filter.from } : {}),
    ...(filter.to ? { lte: filter.to } : {}),
  }

  const nextDueOn = {
    ...(filter.status === 'overdue' ? { lt: today } : {}),
    // An active loan is one not yet due. The range's own `gte` above still
    // applies to the capital date, so a from-date later than today keeps
    // narrowing the result — it just narrows the right column now.
    ...(filter.status === 'active' ? { gte: today } : {}),
  }

  return {
    userId,
    deletedAt: null,
    ...(filter.status === 'paid' ? { status: 'PAID' as const } : {}),
    ...(filter.status === 'active' || filter.status === 'overdue' ? { status: 'ACTIVE' as const } : {}),
    ...(Object.keys(dueOn).length > 0 ? { dueOn } : {}),
    ...(Object.keys(nextDueOn).length > 0 ? { nextDueOn } : {}),
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
  /**
   * What is STILL TO COLLECT on the ACTIVE loans in the filter: the SUM of
   * their `totalCentavos`, MINUS the weeks already collected on the weekly ones.
   *
   * Not simply the sum of the totals. A weekly loan fifteen weeks in has had
   * fifteen weeks of interest handed over, and counting it as still to come
   * would contradict the Floating tile that already spent it.
   */
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

  const [loans, byStatus, overdue, collectedWeeks] = await Promise.all([
    db.loan.findMany({
      // A TIEBREAKER, AND IT IS NOT OPTIONAL. `skip`/`take` ask Postgres for a
      // window into a sorted result, and if the sort does not decide every pair
      // of rows, equal rows may come back in a different order for page 1 than
      // for page 2 — so one loan appears twice and another is never shown. With
      // real data this showed up immediately: 86 loans, 85 distinct, because
      // several shared a due date. `id` is unique, so it makes the order total.
      where,
      // Soonest MONEY first, not soonest capital. A weekly loan three weeks
      // behind belongs at the top of the list, not down in February.
      orderBy: [{ status: 'asc' }, { nextDueOn: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
      select: {
        id: true,
        borrowerId: true,
        capitalCentavos: true,
        totalCentavos: true,
        dueOn: true,
        nextDueOn: true,
        interestCollection: true,
        status: true,
        borrower: { select: { firstName: true, lastName: true } },
        // Whose money it was is on the card itself. Without it the list answers
        // "who owes what" and nothing about whose capital is at risk, which is
        // the other half of the question the admin opens this screen with.
        //
        // This is the join that made the old query expensive, and paging is what
        // makes it cheap: it now runs for one page of loans rather than all of
        // them — PAGE_SIZE of them, which is ten today.
        fundings: {
          select: {
            lenderId: true,
            principalCentavos: true,
            lender: { select: { firstName: true, lastName: true, isSelf: true } },
          },
          orderBy: { principalCentavos: 'desc' },
        },
        // The one line on the card that says what was last agreed with this
        // borrower.
        //
        // `take: 1` IS NOT A LIMIT IN THE SQL. Prisma fetches every note
        // belonging to the page's loan ids in one statement and slices to the
        // newest here, so the cost is the number of notes on those ten loans,
        // not ten rows. Measured on 2026-09-22: one `WHERE "loanId" IN (...)`
        // per page, not one per loan — the shape that matters is unchanged.
        //
        // The bound is therefore how many notes ONE loan collects, and nothing
        // caps it. At the handful a person types while chasing a borrower this
        // is free. If a loan ever carries hundreds, this select is where it
        // will show, and the fix is a raw DISTINCT ON rather than a bigger
        // `take`.
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true },
        },
        _count: { select: { notes: true } },
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
    // nextDueOn for the same reason the filter above uses it: a weekly loan is
    // late on a missed week, months before its capital date.
    db.loan.count({ where: { AND: [where, { status: 'ACTIVE', nextDueOn: { lt: today } }] } }),
    // The weeks already in hand on the weekly loans this filter matches. What
    // is STILL to collect is the total minus these, and without the subtraction
    // this tile and the Floating tile describe the same pesos differently.
    weeklyCollected(userId, where),
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
      // THE NEXT DATE MONEY IS OWED, not the capital date. On a weekly loan
      // three weeks behind, the capital date is in February and printing it
      // here would put the loan at the bottom of a list it belongs at the top
      // of. FEATURES.md section 5.
      dueOn: loan.nextDueOn,
      dueIsWeekly: loan.interestCollection === 'WEEKLY',
      state: storedLoanState(loan.status, loan.nextDueOn),
      latestNote: loan.notes[0] ?? null,
      noteCount: loan._count.notes,
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
      // What is STILL to collect, which on a weekly loan is not the loan's
      // total: the weeks already collected have been collected. Subtracting
      // them is what makes this figure and the Floating tile describe the same
      // pesos.
      outstanding: centavos((active?._sum.totalCentavos ?? 0) - collectedWeeks),
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

/**
 * Every peso of interest this account has ever charged, and how much of it is in.
 *
 * MEASURED, not assumed, on 2026-09-22 against the demo account: SUM over
 * Loan.interestCentavos for non-deleted loans came to exactly the same figure as
 * SUM(LoanFunding.earningsCentavos) + SUM(LoanFunding.adminCutCentavos) over the
 * same loans. That is the invariant in the schema — lenderRateBps + adminCutBps
 * equals borrowerRateBps on every funding row — holding in the live data, and it
 * is why this reads the loan rather than adding up the split. One number, one
 * source.
 *
 * `charged` is every loan on record, running or repaid. `collected` is the part
 * on loans marked PAID. Undoing a payment sets the loan back to ACTIVE, so a
 * repayment that was handed back stops counting as collected — checked in
 * payments/actions.ts rather than assumed from the Payment row, which stays
 * attached to the loan after an undo.
 *
 * Deleted loans are excluded, like everywhere but Recently Deleted. Interest on
 * a loan the admin deleted is not interest she charged anybody.
 *
 * NOT date-filtered, deliberately. This is a to-date total, and the dashboard
 * says so; a range belongs on the reports screen, which has the dates to do it.
 */
export async function interestSummary(
  userId: string,
): Promise<{ charged: Centavos; collected: Centavos; pending: Centavos }> {
  const where = { userId, deletedAt: null }

  const [all, paid, collectedWeeks] = await Promise.all([
    db.loan.aggregate({ where, _sum: { interestCentavos: true } }),
    db.loan.aggregate({
      where: { ...where, status: 'PAID' as const },
      _sum: { interestCentavos: true },
    }),
    // THE WEEKS ALREADY COLLECTED ON LOANS THAT ARE STILL RUNNING. Their
    // interest is in the Admin's and the lenders' hands, so counting it as
    // pending would tell the Admin money is still to come that has already
    // arrived — and the Floating tile, which now includes it, would disagree
    // with the interest tile on the same screen.
    weeklyCollected(userId),
  ])

  const charged = all._sum.interestCentavos ?? 0
  // Loans settled in full, plus the weeks collected on loans still running. The
  // two cannot overlap: the weekly figure is restricted to ACTIVE loans, and a
  // loan that has settled is PAID.
  const collected = (paid._sum.interestCentavos ?? 0) + collectedWeeks

  return {
    charged: centavos(charged),
    collected: centavos(collected),
    pending: centavos(charged - collected),
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
      interestBasis: true,
      borrowerRateBps: true,
      termDays: true,
      startOn: true,
      dueOn: true,
      nextDueOn: true,
      interestCollection: true,
      status: true,
      borrower: { select: { firstName: true, lastName: true } },
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
          earningsCentavos: true,
          adminCutCentavos: true,
          lenderRateBps: true,
          adminCutBps: true,
          lender: { select: { firstName: true, lastName: true, isSelf: true } },
        },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, body: true, createdAt: true },
      },
      // Money drawn against this loan early. WITHDRAWAL only: the action never
      // writes anything else against a loan, and filtering rather than trusting
      // that means a deposit attached by hand could never read as an advance
      // and quietly raise the ceiling on the next one.
      advances: {
        where: { deletedAt: null, type: 'WITHDRAWAL' },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, amountCentavos: true, occurredOn: true, note: true },
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

  // The SETTLING payment, live only. Undoing soft-deletes the row rather than
  // destroying it, so an undone payment is still attached to the loan and would
  // otherwise read as paid — and on a weekly loan the array also carries the
  // collected weeks, which are payments but are not this one.
  const payment = settlingPayment(loan.payments)

  // What the admin actually takes home on this loan: their cut on other
  // people's money, plus what their own capital earned as a funder.
  const adminEarnings = adminTakeOnLoan(funders)

  const weekly = weeklyDetail(loan)

  return {
    id: loan.id,
    borrowerId: loan.borrowerId,
    borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`,
    capital: centavos(loan.capitalCentavos),
    interest: centavos(loan.interestCentavos),
    total: centavos(loan.totalCentavos),
    termDays: loan.termDays,
    startOn: loan.startOn,
    // The NEXT owed date, so LoanRow.dueOn means one thing everywhere. The
    // capital date is capitalDueOn below, and this page shows both.
    dueOn: loan.nextDueOn,
    dueIsWeekly: loan.interestCollection === 'WEEKLY',
    interestBasis: loan.interestBasis,
    interestCollection: loan.interestCollection,
    // THE CAPITAL DATE, which the loans list does NOT show on a weekly loan.
    // This page is the one screen that shows both. FEATURES.md section 5.
    capitalDueOn: loan.dueOn,
    weeks: weekly.weeks,
    weeklyCollected: weekly.collected,
    weeklyOutstanding: weekly.outstanding,
    convertible: convertibleToWeekly(loan),
    borrowerRateBps: loan.borrowerRateBps,
    state: storedLoanState(loan.status, loan.nextDueOn),
    paidOn: payment?.paidOn ?? null,
    missingProof: payment !== null && payment.proofFiles.length === 0,
    funders,
    adminEarnings,
    notes: loan.notes,
    advances: loan.advances.map((row) => ({
      id: row.id,
      amount: centavos(row.amountCentavos),
      occurredOn: row.occurredOn,
      note: row.note,
    })),
    // The ceiling on the next advance. `advanced` is SUM("amountCentavos") over
    // the live WITHDRAWAL rows naming this loan — restoring one from Recently
    // Deleted puts it straight back into the sum, which is the point of adding
    // rows up rather than storing a running figure.
    adminStake: adminStakeInLoan(
      funders,
      centavos(loan.advances.reduce((total, row) => total + row.amountCentavos, 0)),
      // What the collected weeks have ALREADY put into the Admin pot. Without
      // it the ceiling counts that money twice: once as floating it can spend
      // directly, and once as headroom for an advance against the same loan.
      weekly.releasedToAdmin,
    ),
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
