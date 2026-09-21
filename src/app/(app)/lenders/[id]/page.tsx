import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, HandCoins } from 'lucide-react'

import { ActionForm } from '@/components/forms.tsx'
import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { requireUser } from '@/server/auth/guard.ts'
import { archiveTransaction } from '@/server/lenders/actions.ts'
import { getLender } from '@/server/lenders/queries.ts'

import { LenderSettings } from './lender-settings.tsx'
import { TransactionForm } from './transaction-form.tsx'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/** "2026-09-21" for <input type="date">, in the admin's own timezone. */
function todayForInput(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export async function generateMetadata({ params }: PageProps<'/lenders/[id]'>) {
  const user = await requireUser()
  const lender = await getLender(user.id, (await params).id)
  if (!lender) return { title: 'Lender · Lending App' }
  return { title: `${lender.firstName} ${lender.lastName} · Lending App` }
}

/**
 * One lender's pot.
 *
 * The screen exists to answer one question without opening every loan: where is
 * this person's money right now? So "Out with" comes before the transaction
 * history — the history explains the figures, but the figures are what was asked.
 *
 * Every number here is derived on this read. Nothing on this page is stored as a
 * balance, which is why none of it can drift away from the rows that produced it.
 */
export default async function LenderPage({ params }: PageProps<'/lenders/[id]'>) {
  const user = await requireUser()
  const lender = await getLender(user.id, (await params).id)
  if (!lender) notFound()

  const { position } = lender

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/lenders"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Lenders
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {lender.firstName} {lender.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">
              {lender.isSelf
                ? 'Your own pot — this money earns the full borrower rate.'
                : 'Earns 5% a week on their own capital.'}
            </p>
          </div>
          <LenderSettings
            lenderId={lender.id}
            firstName={lender.firstName}
            lastName={lender.lastName}
            isSelf={lender.isSelf}
          />
        </div>
      </div>

      <StatTile
        hero
        label="Floating"
        value={<Money amount={position.floating} variant="display" />}
        note={position.floating < 0 ? 'more is out on loan than was ever put in' : 'idle, ready to lend'}
        tone={position.floating < 0 ? 'critical' : undefined}
      />

      <StatRow>
        <StatTile label="Out on loan" value={<Money amount={position.outOnLoan} variant="display" />} />
        <StatTile label="Earned" value={<Money amount={position.earned} variant="display" />} />
        {/* Pending is deliberately separate from Earned. It is owed, not received,
            and folding it into floating would let the admin lend money that has
            not come back yet. */}
        <StatTile
          label="Still to earn"
          value={<Money amount={position.pending} variant="display" />}
          note="on loans running"
        />
      </StatRow>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Out with</h2>

        {lender.fundings.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            None of this money is out on loan right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {lender.fundings.map((funding) => (
              <li key={funding.loanId}>
                <Link
                  href={`/borrowers/${funding.borrowerId}`}
                  className="bg-card hover:bg-muted/40 flex items-center gap-3 rounded-xl border p-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{funding.borrowerName}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      due {dateFormat.format(funding.dueOn)} · earns{' '}
                      <Money amount={funding.earnings} variant="display" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money amount={funding.principal} variant="display" className="text-sm font-semibold" />
                    <LoanStatusBadge state={funding.state} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Money in and out</h2>
        </div>

        <TransactionForm lenderId={lender.id} today={todayForInput()} />

        {lender.transactions.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <HandCoins className="text-muted-foreground mx-auto size-7" aria-hidden />
            <p className="mt-3 text-sm font-medium">Nothing recorded yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
              Record the cash this lender handed over, and anything they take back.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {lender.transactions.map((entry) => {
              const isDeposit = entry.type === 'DEPOSIT'
              const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight
              return (
                <li key={entry.id} className="flex items-center gap-3 p-3">
                  <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{isDeposit ? 'Money in' : 'Money out'}</div>
                    <div className="text-muted-foreground mt-0.5 truncate text-xs">
                      {dateFormat.format(entry.occurredOn)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </div>
                  </div>
                  <Money
                    amount={entry.amount}
                    variant="display"
                    className="text-sm font-semibold"
                    muted={!isDeposit}
                  />
                  <ActionForm
                    action={archiveTransaction}
                    values={{ transactionId: entry.id }}
                    variant="ghost"
                    size="sm"
                    pendingLabel="Undoing…"
                  >
                    Undo
                  </ActionForm>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
