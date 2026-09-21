import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Pencil } from 'lucide-react'

import { ActionForm } from '@/components/forms.tsx'
import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { requireUser } from '@/server/auth/guard.ts'
import { archiveLoan } from '@/server/loans/actions.ts'
import { getLoan } from '@/server/loans/queries.ts'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
const percent = (bps: number) => `${(bps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}%`

export async function generateMetadata({ params }: PageProps<'/loans/[id]'>) {
  const user = await requireUser()
  const loan = await getLoan(user.id, (await params).id)
  return { title: loan ? `${loan.borrowerName}'s loan · Lending App` : 'Loan · Lending App' }
}

/**
 * One loan, and where every peso of it goes.
 *
 * Nothing on this page is recalculated. Each figure was decided the day the loan
 * was created and written down, so what is shown here is what was agreed — not
 * what today's default rates would produce.
 */
export default async function LoanPage({ params }: PageProps<'/loans/[id]'>) {
  const user = await requireUser()
  const loan = await getLoan(user.id, (await params).id)
  if (!loan) notFound()

  const paid = loan.state === 'paid'

  return (
    <div className="space-y-6">
      <div>
        <Link href="/loans" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" aria-hidden />
          Loans
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                <Link href={`/borrowers/${loan.borrowerId}`} className="hover:underline">
                  {loan.borrowerName}
                </Link>
              </h1>
              <LoanStatusBadge state={loan.state} />
            </div>
            <p className="text-muted-foreground text-sm">
              {dateFormat.format(loan.startOn)} → {dateFormat.format(loan.dueOn)} ·{' '}
              {loan.weeks === 1 ? '1 week' : `${loan.weeks} weeks`} at {percent(loan.borrowerRateBps)} a week
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* A paid loan is not editable: its payment records a total that was
                agreed and handed over, and changing one without the other would
                leave the two disagreeing with nothing to say which is right. */}
            {paid ? null : (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/loans/${loan.id}/edit`}>
                  <Pencil className="size-4" aria-hidden />
                  Edit
                </Link>
              </Button>
            )}
            <ActionForm action={archiveLoan} values={{ loanId: loan.id }} variant="ghost" size="sm" pendingLabel="Undoing…">
              Undo loan
            </ActionForm>
          </div>
        </div>
      </div>

      <StatTile
        hero
        label={paid ? 'Repaid' : 'They repay'}
        value={<Money amount={loan.total} variant="display" />}
        note={
          paid && loan.paidOn
            ? `paid ${dateFormat.format(loan.paidOn)}`
            : `${loan.weeks === 1 ? '1 week' : `${loan.weeks} weeks`} at ${percent(loan.borrowerRateBps)}`
        }
        tone={loan.state === 'overdue' ? 'critical' : undefined}
      />

      <StatRow>
        <StatTile label="Capital" value={<Money amount={loan.capital} variant="display" />} />
        <StatTile label="Interest" value={<Money amount={loan.interest} variant="display" />} />
        <StatTile label="You earn" value={<Money amount={loan.adminEarnings} variant="display" />} />
      </StatRow>

      {loan.missingProof ? (
        <p className="text-status-warning inline-flex items-center gap-1.5 text-sm font-medium">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Marked paid with no proof attached
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Whose money, and what it earns</h2>

        <ul className="space-y-2">
          {loan.funders.map((funder) => (
            <li key={funder.lenderId} className="bg-card rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <Link href={`/lenders/${funder.lenderId}`} className="text-sm font-medium hover:underline">
                  {funder.name}
                </Link>
                <Money amount={funder.principal} variant="display" className="text-sm font-semibold" />
              </div>

              <dl className="text-muted-foreground mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <dt>Earns {percent(funder.lenderRateBps)}/wk</dt>
                  <dd className="text-foreground font-medium">
                    <Money amount={funder.earnings} variant="display" />
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Zero on the admin's own money — they charge themselves nothing. */}
                  <dt>Your cut {percent(funder.adminCutBps)}/wk</dt>
                  <dd className="text-foreground font-medium">
                    <Money amount={funder.adminCut} variant="display" muted={funder.adminCut === 0} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">
          Every share was fixed when the loan was created and is never recalculated.
        </p>
      </section>
    </div>
  )
}

