import { type BasisPoints, type Centavos, centavos } from '../../lib/money/centavos.ts'
import {
  type DueRecord,
  autoPlan,
  capitalShares,
  dueRecords,
  historyDefaults,
  historyWindowStart,
  lateDelayDays,
  onTimeRate,
  relendHabits,
  returnEvents,
} from '../../lib/money/forecast-history.ts'
import { type ForecastInput, type RealRow } from '../../lib/money/forecast.ts'
import { type HistoryRow, type SimpleInput } from '../../lib/money/simple-forecast.ts'
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
  /** "Carry on lending the way you have been": the plan the page uses until the Admin customizes one. */
  auto: ReturnType<typeof autoPlan>
  /** Funding rows of NEW loans (continuations left out) — the "usual pace" in simple-forecast.ts. */
  newLending: HistoryRow[]
}

/** The simple projection's input, built once from the context. */
export function simpleInput(ctx: ProjectionContext, months: number): SimpleInput {
  const capitalNow = new Map(ctx.lenders.map((l) => [l.id, l.floatingNow as number]))
  for (const row of ctx.realRows) capitalNow.set(row.lenderId, (capitalNow.get(row.lenderId) ?? 0) + row.principal)
  return {
    today: ctx.today,
    months,
    adminId: ctx.lenders.find((l) => l.isSelf)?.id ?? null,
    capitalNow: new Map([...capitalNow].map(([k, v]) => [k, centavos(v)])),
    running: ctx.realRows,
    history: ctx.newLending,
  }
}

export async function projectionContext(
  userId: string,
  /** The dashboard's own listLenders result, so the heavy ledger read is not run twice. */
  known?: Awaited<ReturnType<typeof listLenders>>,
): Promise<ProjectionContext> {
  const today = calendarDate(new Date())
  const from = historyWindowStart(today)

  const [lenders, running, history] = await Promise.all([
    known ?? listLenders(userId),
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
        capitalCentavos: true,
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
    newLending: history
      .filter((loan) => loan.continuedFrom.length === 0)
      .flatMap((loan) =>
        loan.fundings.map((f) => ({
          lenderId: f.lenderId,
          startOn: storedCalendarDate(loan.startOn),
          earnings: centavos(f.earningsCentavos),
          adminCut: centavos(f.adminCutCentavos),
        })),
      ),
    auto: autoPlan(
      history.map((loan) => ({
        startOn: storedCalendarDate(loan.startOn),
        capital: centavos(loan.capitalCentavos),
        termDays: loan.termDays,
        continuation: loan.continuedFrom.length > 0,
      })),
      today,
    ),
  }
}
