import { AlertTriangle, HandCoins, Users, Wallet } from 'lucide-react'

import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { loanState } from '@/lib/loan-state.ts'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { db } from '@/server/db.ts'

export const metadata = { title: 'Dashboard · Lending App' }

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short' })

export default async function DashboardPage() {
  const user = await requireUser()
  const scope = { userId: user.id, archivedAt: null }

  const [outstanding, overdue, lenders, borrowers, dueSoon] = await Promise.all([
    db.loan.aggregate({
      where: { ...scope, status: 'ACTIVE' },
      _sum: { totalCentavos: true },
      _count: true,
    }),
    db.loan.aggregate({
      where: { ...scope, status: 'ACTIVE', dueOn: { lt: new Date() } },
      _sum: { totalCentavos: true },
      _count: true,
    }),
    db.lender.count({ where: scope }),
    db.borrower.count({ where: scope }),
    db.loan.findMany({
      where: { ...scope, status: 'ACTIVE' },
      include: { borrower: { select: { firstName: true, lastName: true } } },
      orderBy: { dueOn: 'asc' },
      take: 6,
    }),
  ])

  const empty = outstanding._count === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Signed in as {user.username}.</p>
      </div>

      {/* Exactly ONE hero. More than one and the eye has nowhere to land, which
          is the whole job of a headline number. It sits above the row rather
          than inside it — see StatRow. */}
      <StatTile
        hero
        label="Owed to you"
        value={<Money amount={centavos(outstanding._sum.totalCentavos ?? 0)} variant="display" />}
        note={
          outstanding._count === 1
            ? 'across 1 active loan'
            : `across ${outstanding._count} active loans`
        }
      />

      <StatRow>
        <StatTile
          label="Overdue"
          icon={AlertTriangle}
          tone={overdue._count > 0 ? 'critical' : undefined}
          value={String(overdue._count)}
          note={
            overdue._count > 0
              ? `${((overdue._sum.totalCentavos ?? 0) / 100).toLocaleString('en-PH', {
                  style: 'currency',
                  currency: 'PHP',
                  maximumFractionDigits: 0,
                })} unpaid`
              : 'nothing late'
          }
        />
        <StatTile label="Lenders" icon={Wallet} value={String(lenders)} />
        <StatTile label="Borrowers" icon={Users} value={String(borrowers)} />
      </StatRow>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Due next</h2>

        {empty ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <HandCoins className="text-muted-foreground mx-auto size-7" aria-hidden />
            <p className="mt-3 text-sm font-medium">No active loans yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
              Once you record a loan it will appear here, soonest due first.
            </p>
          </div>
        ) : (
          <>
            {/* PHONE: cards. Calm, tappable, nothing squeezed into a column. */}
            <ul className="space-y-2 md:hidden">
              {dueSoon.map((loan) => (
                <li key={loan.id} className="bg-card flex items-center gap-3 rounded-xl border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {loan.borrower.firstName} {loan.borrower.lastName}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      due {dateFormat.format(loan.dueOn)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money amount={centavos(loan.totalCentavos)} variant="display" className="text-sm font-semibold" />
                    <LoanStatusBadge state={loanState(loan.status, loan.dueOn)} />
                  </div>
                </li>
              ))}
            </ul>

            {/* LAPTOP: a table. Dense, aligned, scannable — figures in a column
                get tabular-nums so the decimal points stack. */}
            <div className="hidden overflow-hidden rounded-xl border md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-medium">
                    <th>Borrower</th>
                    <th>Due</th>
                    <th className="!text-right">Capital</th>
                    <th className="!text-right">Total</th>
                    <th className="!text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dueSoon.map((loan) => (
                    <tr key={loan.id} className="hover:bg-muted/40 [&>td]:px-4 [&>td]:py-2.5">
                      <td className="font-medium">
                        {loan.borrower.firstName} {loan.borrower.lastName}
                      </td>
                      <td className="text-muted-foreground">{dateFormat.format(loan.dueOn)}</td>
                      <td>
                        <Money amount={centavos(loan.capitalCentavos)} muted className="block" />
                      </td>
                      <td>
                        <Money amount={centavos(loan.totalCentavos)} className="block font-medium" />
                      </td>
                      <td className="text-right">
                        <LoanStatusBadge state={loanState(loan.status, loan.dueOn)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
