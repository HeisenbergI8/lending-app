import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, HandCoins, Trash2, TrendingUp, Wallet } from 'lucide-react'

import { ActionForm } from '@/components/forms.tsx'
import { StackedColumns } from '@/components/chart.tsx'
import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Avatar } from '@/components/avatar.tsx'
import { Money } from '@/components/money.tsx'
import { IconChip, StatRow, StatTile } from '@/components/stat-tile.tsx'
import { centavos, formatPesos } from '@/lib/money/centavos.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { deleteTransaction } from '@/server/lenders/actions.ts'
import { type LenderDetail, getLender } from '@/server/lenders/queries.ts'

import { LenderSettings } from './lender-settings.tsx'
import { TransactionForm } from './transaction-form.tsx'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
const percent = (bps: number) => `${(bps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}%`

/**
 * What this pot earns, in the lender's own words.
 *
 * Built from the rates on their funding rows, never from the default. The rate
 * is decided per loan, so a fixed "earns 5% a week" here would be a claim the
 * screen cannot back up — and the first loan written at another rate would make
 * it false without anything appearing to change.
 */
function describeRates(rates: number[], isSelf: boolean): string {
  const owner = isSelf ? 'The Admin pot' : null

  if (rates.length === 0) {
    return owner ? `${owner}. Nothing lent out yet.` : 'Nothing of theirs is lent out yet.'
  }

  const span =
    rates.length === 1
      ? `${percent(rates[0])} a week`
      : `${percent(rates[0])} to ${percent(rates[rates.length - 1])} a week, depending on the loan`

  return owner
    ? `${owner}. This money earns ${span}, the whole of what the borrower pays.`
    : `Earns ${span} on their own capital.`
}

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
  if (!lender) return { title: 'Lender · Consignment Kush' }
  return { title: `${lender.firstName} ${lender.lastName} · Consignment Kush` }
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
  const deposits = lender.transactions.filter((entry) => entry.type === 'DEPOSIT')
  const withdrawals = lender.transactions.filter((entry) => entry.type === 'WITHDRAWAL')
  const settledEarnings = centavos(lender.settled.reduce((total, row) => total + row.earnings, 0))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/lenders"
          className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Lenders
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[1.75rem] font-semibold tracking-tight">
              {lender.firstName} {lender.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">
              {describeRates(lender.rates, lender.isSelf)}
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
        icon={Wallet}
        label="Floating"
        value={<Money amount={position.floating} variant="display" />}
        note={position.floating < 0 ? 'more is out on loan than was ever put in' : 'idle, ready to lend'}
        tone={position.floating < 0 ? 'critical' : undefined}
      />

      {/* `earned` is this lender's own settled earnings PLUS, for the admin pot
          only, the 2% cut on other funders' principal on loans already repaid.
          `pending` is the same sum over loans still running. The cut belongs to
          NONE of the "Out with" or "Paid back" rows further down this page —
          those list only loans this pot's own capital went into — so a tile
          carrying a cut sat higher than the rows beneath it with nothing on the
          page to account for the difference. The note prints the cut so the two
          reconcile by addition. `adminCutEarned` / `adminCutPending` are exactly
          the SUM("adminCutCentavos") slices of the same two totals, split in
          lenderPosition; both are 0 for every lender except the admin pot. */}
      <StatRow>
        <StatTile label="Out on loan" value={<Money amount={position.outOnLoan} variant="display" />} />
        <StatTile
          label="Earned"
          value={<Money amount={position.earned} variant="display" />}
          note={
            position.adminCutEarned > 0
              ? `includes ${formatPesos(position.adminCutEarned)} cut from other lenders' loans`
              : undefined
          }
        />
        {/* Pending is deliberately separate from Earned. It is owed, not received,
            and folding it into floating would let the admin lend money that has
            not come back yet. */}
        <StatTile
          label="Still to earn"
          value={<Money amount={position.pending} variant="display" />}
          note={
            position.adminCutPending > 0
              ? `on loans running, includes ${formatPesos(position.adminCutPending)} cut from other lenders' loans`
              : 'on loans running'
          }
        />
      </StatRow>

      {/* THE POT OVER TIME, which is the one thing the figures above cannot say.
          They are all as of today: they tell the admin where the money is, and
          nothing at all about whether this pot has been growing or sitting
          still.

          Each column is the pot as it stood at the end of that month, rebuilt
          from the movements. The last one is as of TODAY rather than the end of
          this month, so it is not a projection.

          IT COUNTS A LOAN FROM ITS START DATE. "Out on loan" above counts it
          from the moment it was recorded, so a loan dated to start next week is
          in the tile and not yet in the columns. That is the honest order for a
          history, and because the two sit inches apart the difference is
          printed underneath rather than left to be noticed. */}
      <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
        <div className="flex items-start gap-3">
          <IconChip icon={TrendingUp} tint="violet" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">The last twelve months</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              What this pot was worth at each month end, and how much of it was working.
            </p>
          </div>
        </div>

        <StackedColumns
          columns={lender.history.map((month) => ({
            label: month.label,
            base: month.outOnLoan,
            top: month.floating,
          }))}
          series={[{ label: 'Out on loan' }, { label: 'Floating' }]}
        />

        {lender.notYetStarted > 0 ? (
          <p className="text-muted-foreground text-xs">
            <Money amount={lender.notYetStarted} variant="display" /> is committed to a loan dated to
            start later. It is counted in Out on loan above, and joins the columns on its start date.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Out with</h2>

        {lender.fundings.length === 0 ? (
          <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-6 text-center text-sm">
            None of this money is out on loan right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {lender.fundings.map((funding) => (
              <li key={funding.loanId}>
                <Link
                  href={`/borrowers/${funding.borrowerId}`}
                  className="bg-card group flex items-center gap-3 p-3 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
                >
                  <Avatar name={funding.borrowerName} />
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

      {/* WHO HAS ALREADY PAID THIS POT BACK. "Out with" above is the money at
          risk; this is the track record beside it, and the two answer different
          questions. Kept forever, the same as on a borrower's own profile. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Paid back</h2>
          {lender.settled.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {lender.settled.length === 1 ? '1 loan settled' : `${lender.settled.length} loans settled`} ·{' '}
              <Money amount={settledEarnings} variant="display" /> earned
            </p>
          ) : null}
        </div>

        {lender.settled.length === 0 ? (
          <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-6 text-center text-sm">
            No loan funded by this money has been repaid yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {lender.settled.map((funding) => (
              <li key={funding.loanId}>
                <Link
                  href={`/loans/${funding.loanId}`}
                  className="bg-card group flex items-center gap-3 p-3 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
                >
                  <Avatar name={funding.borrowerName} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{funding.borrowerName}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {funding.paidOn ? `paid ${dateFormat.format(funding.paidOn)}` : 'paid'} · earned{' '}
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
          <h2 className="text-base font-semibold tracking-tight">Record money in or out</h2>
        </div>

        <TransactionForm lenderId={lender.id} today={todayForInput()} />
      </section>

      {/* MONEY IN AND MONEY OUT ARE TWO LISTS, not one mixed one.
          They answer different questions — "what has this person put in" and
          "what have they taken back" — and the second is the one the admin is
          usually looking for, because it is the money that has left. In a single
          list a withdrawal was a minus sign among a dozen deposits. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Money in</h2>
          {deposits.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              <Money amount={position.deposits} variant="display" /> over{' '}
              {deposits.length === 1 ? '1 deposit' : `${deposits.length} deposits`}
            </p>
          ) : null}
        </div>

        <TransactionList
          entries={deposits}
          empty="Nothing has been put into this pot yet."
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Withdrawal history</h2>
          {withdrawals.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              <Money amount={position.withdrawals} variant="display" /> over{' '}
              {withdrawals.length === 1 ? '1 withdrawal' : `${withdrawals.length} withdrawals`}
            </p>
          ) : null}
        </div>

        <TransactionList
          entries={withdrawals}
          empty="Nothing has been taken back out of this pot."
        />
      </section>
    </div>
  )
}

/**
 * A run of movements, one way or the other.
 *
 * Money going out is shown NEGATIVE, not merely greyed. A colour and an icon are
 * easy to skim past; a minus sign in front of the figure is not — and on the
 * withdrawal list, where every row is an outgoing one, the sign is the only
 * thing carrying the direction at all.
 */
function TransactionList({
  entries,
  empty,
}: {
  entries: LenderDetail['transactions']
  empty: string
}) {
  if (entries.length === 0) {
    return (
      <div className="bg-card/60 border-border rounded-2xl border border-dashed p-8 text-center">
        <HandCoins className="text-muted-foreground mx-auto size-6" aria-hidden />
        <p className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm">{empty}</p>
      </div>
    )
  }

  return (
    <ul className="bg-card divide-border/70 shadow-rest ring-border/70 divide-y overflow-hidden rounded-2xl ring-1">
      {entries.map((entry) => {
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
              amount={isDeposit ? entry.amount : centavos(-entry.amount)}
              variant="display"
              className="text-sm font-semibold"
              muted={!isDeposit}
            />
            <ActionForm
              action={deleteTransaction}
              values={{ transactionId: entry.id }}
              variant="destructive"
              size="sm"
              pendingLabel="Deleting…"
              confirm={{
                title: 'Delete this entry?',
                body: "It moves to Recently Deleted and can be restored for thirty days. The lender's balance changes right away.",
                action: 'Delete entry',
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </ActionForm>
          </li>
        )
      })}
    </ul>
  )
}
