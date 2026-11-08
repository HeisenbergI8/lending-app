import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type HistoryRow, type RunningRow, type SimpleInput, historyWindowStart } from '../../lib/money/simple-forecast.ts'
import { calendarDate, storedCalendarDate } from '../../lib/money/weeks.ts'
import { db } from '../db.ts'
import { listLenders } from '../lenders/queries.ts'

/**
 * Everything the projection is read FROM — the Projections page, the lender
 * page's card and the dashboard card. See lib/money/simple-forecast.ts.
 *
 * lenders      listLenders: the same Floating figure the lenders list shows, so
 *              the pot starts from the number on that screen.
 * running      every LoanFunding row on an ACTIVE, non-deleted loan; weeks count
 *              as paid only on a LIVE payment (an undone one is archived).
 * newLending   funding rows of loans STARTED since historyWindowStart, on
 *              non-deleted loans. Continuation loans (made by an "interest paid
 *              now" extension) are left out: they carry on the same money, and
 *              would count the same lending twice.
 */
export type ProjectionContext = {
  today: Date
  lenders: { id: string; name: string; isSelf: boolean; floatingNow: Centavos }[]
  running: RunningRow[]
  newLending: HistoryRow[]
  /** New loans behind `newLending`, for the "based on N loans" line. */
  newLoans: number
}

/** The simple projection's input, built once from the context. */
export function simpleInput(
  ctx: ProjectionContext,
  months: number,
  moves: Pick<SimpleInput, 'monthlyIn' | 'monthlyOut' | 'pace'> = {},
): SimpleInput {
  const capitalNow = new Map(ctx.lenders.map((l) => [l.id, l.floatingNow as number]))
  for (const row of ctx.running) capitalNow.set(row.lenderId, (capitalNow.get(row.lenderId) ?? 0) + row.principal)
  return {
    today: ctx.today,
    months,
    adminId: ctx.lenders.find((l) => l.isSelf)?.id ?? null,
    capitalNow: new Map([...capitalNow].map(([k, v]) => [k, centavos(v)])),
    running: ctx.running,
    history: ctx.newLending,
    ...moves,
  }
}

export async function projectionContext(
  userId: string,
  /** The dashboard's own listLenders result, so the heavy ledger read is not run twice. */
  known?: Awaited<ReturnType<typeof listLenders>>,
): Promise<ProjectionContext> {
  const today = calendarDate(new Date())
  const from = historyWindowStart(today)

  const [lenders, running, started] = await Promise.all([
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
      where: { userId, deletedAt: null, startOn: { gte: from, lte: today }, continuedFrom: { none: {} } },
      select: {
        startOn: true,
        fundings: { select: { lenderId: true, earningsCentavos: true, adminCutCentavos: true } },
      },
    }),
  ])

  return {
    today,
    lenders: lenders.map((l) => ({
      id: l.id,
      name: l.isSelf ? 'Admin' : `${l.firstName} ${l.lastName}`,
      isSelf: l.isSelf,
      floatingNow: l.position.floating,
    })),
    running: running.map((row) => ({
      lenderId: row.lenderId,
      interestCollection: row.loan.interestCollection,
      startOn: storedCalendarDate(row.loan.startOn),
      dueOn: storedCalendarDate(row.loan.dueOn),
      termDays: row.loan.termDays,
      principal: centavos(row.principalCentavos),
      earnings: centavos(row.earningsCentavos),
      adminCut: centavos(row.adminCutCentavos),
      paidWeeks: new Set(row.loan.payments.flatMap((p) => (p.weekNumber === null ? [] : [p.weekNumber]))),
    })),
    newLending: started.flatMap((loan) =>
      loan.fundings.map((f) => ({
        lenderId: f.lenderId,
        startOn: storedCalendarDate(loan.startOn),
        earnings: centavos(f.earningsCentavos),
        adminCut: centavos(f.adminCutCentavos),
      })),
    ),
    newLoans: started.length,
  }
}
