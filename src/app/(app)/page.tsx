import { db } from '@/server/db.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { formatPesos, centavos } from '@/lib/money/centavos.ts'

export const metadata = { title: 'Dashboard · Lending App' }

/**
 * Placeholder dashboard. Real one arrives at step 8; this exists so step 4 can be
 * checked end to end — signing in has to land somewhere that proves the session
 * works and that queries are scoped to the signed-in user.
 */
export default async function DashboardPage() {
  const user = await requireUser()

  const [lenders, borrowers, activeLoans, overdueLoans, outstanding] = await Promise.all([
    db.lender.count({ where: { userId: user.id, archivedAt: null } }),
    db.borrower.count({ where: { userId: user.id, archivedAt: null } }),
    db.loan.count({ where: { userId: user.id, status: 'ACTIVE', archivedAt: null } }),
    db.loan.count({
      where: { userId: user.id, status: 'ACTIVE', archivedAt: null, dueOn: { lt: new Date() } },
    }),
    db.loan.aggregate({
      where: { userId: user.id, status: 'ACTIVE', archivedAt: null },
      _sum: { totalCentavos: true },
    }),
  ])

  const stats = [
    { label: 'Lenders', value: String(lenders) },
    { label: 'Borrowers', value: String(borrowers) },
    { label: 'Active loans', value: String(activeLoans) },
    { label: 'Overdue', value: String(overdueLoans), alert: overdueLoans > 0 },
    { label: 'Owed to you', value: formatPesos(centavos(outstanding._sum.totalCentavos ?? 0)) },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Signed in as {user.username}.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border p-4">
            <div className="text-muted-foreground text-xs">{stat.label}</div>
            <div
              className={`mt-1 text-xl font-semibold tabular-nums ${
                stat.alert ? 'text-destructive' : ''
              }`}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        Lenders, borrowers and loans arrive in steps 5 and 6. This page exists to prove the
        session works and that every query is scoped to the signed-in account.
      </p>
    </div>
  )
}
