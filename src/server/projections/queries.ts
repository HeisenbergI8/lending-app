import { type BasisPoints, type Centavos, centavos } from '../../lib/money/centavos.ts'
import {
  type DueRecord,
  capitalShares,
  dueRecords,
  historyDefaults,
  historyWindowStart,
  lateDelayDays,
  onTimeRate,
  relendHabits,
  returnEvents,
} from '../../lib/money/forecast-history.ts'
import { type ForecastInput, type Plan, type RealRow } from '../../lib/money/forecast.ts'
import { calendarDate, storedCalendarDate } from '../../lib/money/weeks.ts'
import { db } from '../db.ts'
import { listLenders } from '../lenders/queries.ts'
import { DEFAULT_ADMIN_CUT_BPS, DEFAULT_BORROWER_RATE_BPS } from '../loans/terms.ts'

/**
 * Everything the Projections page projects FROM, read once per page view and
 * shared by every plan on it — a comparison of four plans is one set of reads.
 *
 * lenders     listLenders: the same Floating figure the lenders list shows, so
 *             the projection starts from the number on that screen.
 * realRows    every LoanFunding row on an ACTIVE, non-deleted loan; weeks count
 *             as paid only on a LIVE payment (an undone one is archived).
 * history     loans due, or paid, since historyWindowStart: the split, the on-time
 *             rate, the defaults and each lender's re-lending habit.
 *             See lib/money/forecast-history.ts and plan §1.3–1.4.
 */
export type ProjectionContext = {
  today: Date
  lenders: { id: string; name: string; isSelf: boolean; floatingNow: Centavos }[]
  realRows: RealRow[]
  shares: ForecastInput['shares']
  onTime: ReturnType<typeof onTimeRate>
  lateDelayDays: number | null
  defaults: ReturnType<typeof historyDefaults>
  habits: ReturnType<typeof relendHabits>
}

export async function projectionContext(userId: string): Promise<ProjectionContext> {
  const today = calendarDate(new Date())
  const from = historyWindowStart(today)

  const [lenders, running, history] = await Promise.all([
    listLenders(userId),
    db.loanFunding.findMany({
      where: { userId, loan: { deletedAt: null, status: 'ACTIVE' } },
      select: {
        lenderId: true,
        principalCentavos: true,
        earningsCentavos: true,
        adminCutCentavos: true,
        loan: {
          select: {
            interestCollection: true,
            startOn: true,
            dueOn: true,
            termDays: true,
            payments: { where: { deletedAt: null, weekNumber: { not: null } }, select: { weekNumber: true } },
          },
        },
      },
    }),
    db.loan.findMany({
      where: {
        userId,
        deletedAt: null,
        // Due in the window, or paid in it (a loan due earlier but paid late
        // still handed money back inside the window, which the re-lend habit needs).
        OR: [{ dueOn: { gte: from } }, { payments: { some: { deletedAt: null, paidOn: { gte: from } } } }],
      },
      select: {
        startOn: true,
        dueOn: true,
        termDays: true,
        interestBasis: true,
        interestCollection: true,
        borrowerRateBps: true,
        fundings: {
          select: {
            lenderId: true, principalCentavos: true, earningsCentavos: true, adminCutCentavos: true, adminCutBps: true,
            lender: { select: { isSelf: true } },
          },
        },
        payments: { where: { deletedAt: null }, select: { weekNumber: true, paidOn: true } },
        // Only to know whether the loan was CLOSED by an extension. An extension's
        // dates are not read: on-time uses Loan.dueOn, the extended date (§1.3).
        extensions: { select: { continuedLoanId: true } },
        continuedFrom: { select: { id: true } },
      },
    }),
  ])

  const realRows: RealRow[] = running.map((row) => ({
    lenderId: row.lenderId,
    interestCollection: row.loan.interestCollection,
    startOn: storedCalendarDate(row.loan.startOn),
    dueOn: storedCalendarDate(row.loan.dueOn),
    termDays: row.loan.termDays,
    principal: centavos(row.principalCentavos),
    earnings: centavos(row.earningsCentavos),
    adminCut: centavos(row.adminCutCentavos),
    paidWeeks: new Set(row.loan.payments.flatMap((p) => (p.weekNumber === null ? [] : [p.weekNumber]))),
  }))

  const records: DueRecord[] = history.flatMap((loan) => {
    const settle = loan.payments.find((p) => p.weekNumber === null)
    return dueRecords({
      interestCollection: loan.interestCollection,
      startOn: storedCalendarDate(loan.startOn),
      dueOn: storedCalendarDate(loan.dueOn),
      termDays: loan.termDays,
      settledOn: settle ? storedCalendarDate(settle.paidOn) : null,
      weekPaidOn: new Map(loan.payments.flatMap((p) => (p.weekNumber === null ? [] : [[p.weekNumber, storedCalendarDate(p.paidOn)] as const]))),
      closedByExtension: loan.extensions.some((e) => e.continuedLoanId !== null),
    })
  })

  // A continuation loan (made by an "interest paid now" extension) moved no new
  // capital out of anyone's pot, so its funding would count the same money twice.
  const shareRows = history
    .filter((loan) => loan.continuedFrom.length === 0)
    .flatMap((loan) =>
      loan.fundings.map((f) => ({ lenderId: f.lenderId, principal: centavos(f.principalCentavos), startOn: storedCalendarDate(loan.startOn) })),
    )

  const adminId = lenders.find((l) => l.isSelf)?.id ?? null
  const returns = history.flatMap((loan) =>
    returnEvents(
      {
        rows: loan.fundings.map((f) => ({
          lenderId: f.lenderId,
          interestCollection: loan.interestCollection,
          startOn: storedCalendarDate(loan.startOn),
          dueOn: storedCalendarDate(loan.dueOn),
          termDays: loan.termDays,
          principal: centavos(f.principalCentavos),
          earnings: centavos(f.earningsCentavos),
          adminCut: centavos(f.adminCutCentavos),
          paidWeeks: new Set<number>(),
        })),
        payments: loan.payments.map((p) => ({ weekNumber: p.weekNumber, paidOn: storedCalendarDate(p.paidOn) })),
        closedByExtension: loan.extensions.some((e) => e.continuedLoanId !== null),
      },
      adminId,
    ),
  )
  const lends = shareRows.map((r) => ({ lenderId: r.lenderId, on: r.startOn, principal: r.principal }))

  const defaultsLoans = history.map((loan) => ({
    startOn: storedCalendarDate(loan.startOn),
    interestBasis: loan.interestBasis,
    interestCollection: loan.interestCollection,
    borrowerRateBps: loan.borrowerRateBps,
    cutBps: loan.fundings.filter((f) => !f.lender.isSelf && f.adminCutBps !== null).map((f) => f.adminCutBps as number),
  }))

  return {
    today,
    lenders: lenders.map((l) => ({
      id: l.id,
      name: l.isSelf ? 'Admin' : `${l.firstName} ${l.lastName}`,
      isSelf: l.isSelf,
      floatingNow: l.position.floating,
    })),
    realRows,
    shares: capitalShares(shareRows, today, new Set(lenders.map((l) => l.id))),
    onTime: onTimeRate(records, today),
    lateDelayDays: lateDelayDays(records, today),
    defaults: historyDefaults(defaultsLoans, today, {
      borrowerRateBps: DEFAULT_BORROWER_RATE_BPS as BasisPoints,
      adminCutBps: DEFAULT_ADMIN_CUT_BPS as BasisPoints,
    }),
    habits: relendHabits(returns, lends, today, lenders.map((l) => l.id)),
  }
}

/** Plan names and ids for the picker, newest first. */
export async function listPlans(userId: string) {
  return db.projectionPlan.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  })
}

/**
 * The saved plans asked for, each as the engine's Plan, in the order asked.
 * Moves on a deleted lender are dropped here (the row stays; see the schema).
 */
export async function plansById(userId: string, ids: string[]) {
  const rows = await db.projectionPlan.findMany({
    where: { userId, id: { in: ids } },
    include: { moves: { where: { lender: { deletedAt: null } }, orderBy: { fromMonth: 'asc' } } },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    const plan: Plan = {
      horizonMonths: row.horizonMonths,
      newLoansPerMonth: row.newLoansPerMonth,
      loanAmount: centavos(row.loanAmountCentavos),
      termWeeks: row.termWeeks,
      borrowerRateBps: row.borrowerRateBps,
      adminCutBps: row.adminCutBps,
      collection: row.interestCollection,
      relend: row.relend,
      moves: row.moves.map((m) => ({
        lenderId: m.lenderId,
        type: m.type,
        amount: centavos(m.amountCentavos),
        fromMonth: storedCalendarDate(m.fromMonth),
        everyMonth: m.everyMonth,
        untilMonth: m.untilMonth ? storedCalendarDate(m.untilMonth) : null,
      })),
    }
    return [{ id: row.id, name: row.name, plan, moves: row.moves }]
  })
}
