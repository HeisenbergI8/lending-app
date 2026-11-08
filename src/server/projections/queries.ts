import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type HistoryRow, type RunningRow, type SimpleInput } from '../../lib/money/simple-forecast.ts'
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
 * history      funding rows of every non-deleted loan started on or before
 *              today, whatever its status: the forecast spreads each one's
 *              interest across the days it ran, as the lender page's "Interest
 *              earned" does. Continuation loans (made by an "interest paid now"
 *              extension) are IN: each earns over its own days, so spreading
 *              counts no interest twice.
 * firstLoanOn  the earliest non-deleted loan: if it is inside the window, the
 *              average runs from its month, not over empty months before it.
 */
export type ProjectionContext = {
  today: Date
  lenders: { id: string; name: string; isSelf: boolean; floatingNow: Centavos }[]
  running: RunningRow[]
  history: HistoryRow[]
  /** The first loan ever recorded: a book younger than the window averages from here. */
  firstLoanOn: Date | null
}

/** The simple projection's input, built once from the context. */
export function simpleInput(
  ctx: ProjectionContext,
  months: number,
  moves: Pick<SimpleInput, 'monthlyIn' | 'monthlyOut' | 'pace' | 'extraBorrowers'> = {},
): SimpleInput {
  const capitalNow = new Map(ctx.lenders.map((l) => [l.id, l.floatingNow as number]))
  for (const row of ctx.running) capitalNow.set(row.lenderId, (capitalNow.get(row.lenderId) ?? 0) + row.principal)
  return {
    today: ctx.today,
    months,
    adminId: ctx.lenders.find((l) => l.isSelf)?.id ?? null,
    capitalNow: new Map([...capitalNow].map(([k, v]) => [k, centavos(v)])),
    running: ctx.running,
    history: ctx.history,
    firstLoanOn: ctx.firstLoanOn,
    ...moves,
  }
}

export async function projectionContext(
  userId: string,
  /** The dashboard's own listLenders result, so the heavy ledger read is not run twice. */
  known?: Awaited<ReturnType<typeof listLenders>>,
): Promise<ProjectionContext> {
  const today = calendarDate(new Date())

  const [lenders, running, started, first] = await Promise.all([
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
      where: { userId, deletedAt: null, startOn: { lte: today } },
      select: {
        id: true,
        borrowerId: true,
        startOn: true,
        termDays: true,
        fundings: { select: { lenderId: true, earningsCentavos: true, adminCutCentavos: true } },
      },
    }),
    db.loan.findFirst({ where: { userId, deletedAt: null }, orderBy: { startOn: 'asc' }, select: { startOn: true } }),
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
    history: started.flatMap((loan) =>
      loan.fundings.map((f) => ({
        loanId: loan.id,
        borrowerId: loan.borrowerId,
        lenderId: f.lenderId,
        startOn: storedCalendarDate(loan.startOn),
        termDays: loan.termDays,
        earnings: centavos(f.earningsCentavos),
        adminCut: centavos(f.adminCutCentavos),
      })),
    ),
    firstLoanOn: first ? storedCalendarDate(first.startOn) : null,
  }
}
