import Link from 'next/link'
import { AlertTriangle, ChevronRight, HandCoins, PiggyBank, Users, Wallet } from 'lucide-react'

import { BorrowerLabelBadge, TrackRecordLine } from '@/components/borrower-rating.tsx'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { centavos, formatPesos } from '@/lib/money/centavos.ts'
import { NO_FILTER } from '@/lib/loan-filter.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listBorrowers } from '@/server/borrowers/queries.ts'
import { listLenders } from '@/server/lenders/queries.ts'
import { listLoans } from '@/server/loans/queries.ts'

export const metadata = { title: 'Dashboard · Lending App' }

/** Borrowers shown on the home screen before it stops being a glance. The rest are one tap away. */
const SHOWN = 6

/**
 * The opening screen: the four figures from the spec, the pots across the top,
 * the people below.
 *
 * Every number here is DERIVED from the same queries the lender and borrower
 * screens use, never from a separate dashboard aggregate. A second way of
 * summing the same money is a second answer waiting to disagree with the first,
 * and the admin would have no way to tell which of the two was lying.
 */
export default async function DashboardPage() {
  const user = await requireUser()

  const [lenders, borrowers, overdue] = await Promise.all([
    listLenders(user.id),
    listBorrowers(user.id),
    listLoans(user.id, { ...NO_FILTER, status: 'overdue' }),
  ])

  const pots = lenders.reduce(
    (sum, lender) => ({
      floating: sum.floating + lender.position.floating,
      out: sum.out + lender.position.outOnLoan,
    }),
    { floating: 0, out: 0 },
  )

  // The admin is a lender row with isSelf — their earnings are their own cut on
  // other people's money plus what their own capital made, already added up by
  // lenderPosition. There is no separate admin ledger to reconcile.
  const self = lenders.find((lender) => lender.isSelf)
  const overdueTotal = overdue.reduce((sum, loan) => sum + loan.total, 0)
  const owing = borrowers.filter((borrower) => borrower.outstanding > 0)

  // PEOPLE, not loans — the spec asks how many borrowers are overdue, and one
  // person late on two loans is one person to chase, not two.
  const overdueBorrowers = new Set(overdue.map((loan) => loan.borrowerId)).size

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
        label="Out on loan"
        value={<Money amount={centavos(pots.out)} variant="display" />}
        note={
          owing.length === 1 ? 'in one borrower’s hands' : `in ${owing.length} borrowers’ hands`
        }
      />

      <StatRow>
        <StatTile
          label="Floating"
          icon={PiggyBank}
          value={<Money amount={centavos(pots.floating)} variant="display" />}
          note="idle, ready to lend"
        />
        <Link href="/loans?status=overdue" className="block">
          <StatTile
            label="Overdue"
            icon={AlertTriangle}
            tone={overdueBorrowers > 0 ? 'critical' : undefined}
            value={String(overdueBorrowers)}
            note={
              overdueBorrowers > 0
                ? `${overdue.length === 1 ? '1 loan' : `${overdue.length} loans`} · ${formatPesos(centavos(overdueTotal))} unpaid`
                : 'nobody late'
            }
            className="hover:bg-muted/40 h-full"
          />
        </Link>
        <StatTile
          label="You've earned"
          icon={Wallet}
          value={<Money amount={self?.position.earned ?? centavos(0)} variant="display" />}
          note={
            self && self.position.pending > 0
              ? `${formatPesos(self.position.pending)} still to come`
              : 'banked so far'
          }
        />
      </StatRow>

      {/* LENDERS ACROSS THE TOP, per the spec's main screen — the admin's own pot
          included, because it is a lender row like any other. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Pots</h2>
          <Link href="/lenders" className="text-muted-foreground hover:text-foreground text-xs">
            All lenders
          </Link>
        </div>

        {lenders.length === 0 ? (
          <EmptyCard
            icon={Wallet}
            title="No lenders yet"
            body="Add the people whose money you lend out — including your own pot."
            href="/lenders"
            action="Add a lender"
          />
        ) : (
          // A strip that scrolls sideways on a phone and lays out as a row on a
          // laptop: the pots are a glance, not a list to work through.
          <ul className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
            {lenders.map((lender) => (
              <li key={lender.id} className="w-56 shrink-0 snap-start sm:w-auto">
                <Link
                  href={`/lenders/${lender.id}`}
                  className="bg-card hover:bg-muted/40 block h-full rounded-xl border p-4 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {lender.firstName} {lender.lastName}
                    </span>
                    {lender.isSelf ? (
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                        You
                      </span>
                    ) : null}
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2">
                    <div>
                      <dt className="text-muted-foreground text-xs">Floating</dt>
                      <dd className="mt-0.5 text-sm font-semibold">
                        <Money amount={lender.position.floating} variant="display" />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Out</dt>
                      <dd className="mt-0.5 text-sm">
                        <Money
                          amount={lender.position.outOnLoan}
                          variant="display"
                          muted={lender.position.outOnLoan === 0}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Earned</dt>
                      <dd className="mt-0.5 text-sm">
                        <Money
                          amount={lender.position.earned}
                          variant="display"
                          muted={lender.position.earned === 0}
                        />
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* BORROWERS BELOW, rating beside the name — a rating you have to open a
          page to see is one you check after you have made up your mind. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Borrowers</h2>
          <Link href="/borrowers" className="text-muted-foreground hover:text-foreground text-xs">
            {borrowers.length > SHOWN ? `All ${borrowers.length}` : 'All borrowers'}
          </Link>
        </div>

        {borrowers.length === 0 ? (
          <EmptyCard
            icon={HandCoins}
            title="No borrowers yet"
            body="Add someone here, or create them while recording their first loan."
            href="/loans/new"
            action="Record a loan"
          />
        ) : (
          <ul className="space-y-2">
            {/* Whoever owes the most, first. An alphabetical list on the home
                screen buries the person worth looking at. */}
            {[...borrowers]
              .sort((a, b) => b.outstanding - a.outstanding)
              .slice(0, SHOWN)
              .map((borrower) => (
                <li key={borrower.id}>
                  <Link
                    href={`/borrowers/${borrower.id}`}
                    className="bg-card hover:bg-muted/40 flex items-center gap-3 rounded-xl border p-4 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {borrower.firstName} {borrower.lastName}
                        </span>
                        {borrower.label ? <BorrowerLabelBadge label={borrower.label} /> : null}
                      </div>
                      <TrackRecordLine record={borrower.record} className="mt-1 block" />
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <div className="text-muted-foreground text-xs">Owes</div>
                        <Money
                          amount={borrower.outstanding}
                          variant="display"
                          muted={borrower.outstanding === 0}
                          className="text-sm font-semibold"
                        />
                      </div>
                      <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function EmptyCard({
  icon: Icon,
  title,
  body,
  href,
  action,
}: {
  icon: typeof Users
  title: string
  body: string
  href: string
  action: string
}) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <Icon className="text-muted-foreground mx-auto size-6" aria-hidden />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">{body}</p>
      <Link href={href} className="mt-3 inline-block text-sm font-medium underline underline-offset-4">
        {action}
      </Link>
    </div>
  )
}
