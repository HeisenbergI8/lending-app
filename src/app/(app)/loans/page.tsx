import Link from 'next/link'
import { HandCoins, Plus, SearchX } from 'lucide-react'

import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { centavos } from '@/lib/money/centavos.ts'
import { isFiltered, parseLoanFilter } from '@/lib/loan-filter.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listLoans } from '@/server/loans/queries.ts'

import { LoanSearch } from './search-form.tsx'

export const metadata = { title: 'Loans · Lending App' }

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Every loan, soonest due first.
 *
 * Unpaid before paid, and within each group the nearest due date on top — the
 * list is read to answer "who do I chase next", so the answer sits where the eye
 * lands.
 *
 * The search comes out of the query string and goes into the database query, so
 * what is rendered is what matched. Nothing is filtered again here: two filters
 * are two chances to disagree about what "overdue" means.
 */
export default async function LoansPage({ searchParams }: PageProps<'/loans'>) {
  const user = await requireUser()
  const filter = parseLoanFilter(await searchParams)
  const loans = await listLoans(user.id, filter)

  const searching = isFiltered(filter)
  const unpaid = loans.filter((loan) => loan.state !== 'paid')
  const overdue = unpaid.filter((loan) => loan.state === 'overdue')
  const owed = unpaid.reduce((sum, loan) => sum + loan.total, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Loans</h1>
          <p className="text-muted-foreground text-sm">
            {searching ? (
              loans.length === 1 ? (
                '1 match'
              ) : (
                `${loans.length} matches`
              )
            ) : (
              <>
                {unpaid.length === 1 ? '1 running' : `${unpaid.length} running`}
                {loans.length - unpaid.length > 0 ? ` · ${loans.length - unpaid.length} paid` : ''}
              </>
            )}
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/loans/new">
            <Plus className="size-4" aria-hidden />
            New loan
          </Link>
        </Button>
      </div>

      <LoanSearch filter={filter} />

      {loans.length === 0 ? (
        searching ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <SearchX className="text-muted-foreground mx-auto size-7" aria-hidden />
            <p className="mt-3 text-sm font-medium">Nothing matches that</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
              Try a first or last name, an amount like 30,000, or clear the filters.
            </p>
            <Button asChild variant="secondary" className="mt-4">
              <Link href="/loans">Clear filters</Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <HandCoins className="text-muted-foreground mx-auto size-7" aria-hidden />
            <p className="mt-3 text-sm font-medium">No loans yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
              Record one and the app works out the interest, the total and everyone&rsquo;s share.
            </p>
            <Button asChild className="mt-4">
              <Link href="/loans/new">Record a loan</Link>
            </Button>
          </div>
        )
      ) : (
        <>
          {/* The tiles describe what is on screen, so under a search they
              describe the matches rather than the whole book. */}
          <StatRow>
            <StatTile label="Owed to you" value={<Money amount={centavos(owed)} variant="display" />} />
            <StatTile label="Running" value={String(unpaid.length)} />
            <StatTile
              label="Overdue"
              value={String(overdue.length)}
              tone={overdue.length > 0 ? 'critical' : undefined}
            />
          </StatRow>

          <ul className="space-y-2">
            {loans.map((loan) => (
              <li key={loan.id}>
                <Link
                  href={`/loans/${loan.id}`}
                  className="bg-card hover:bg-muted/40 flex items-center gap-3 rounded-xl border p-4 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{loan.borrowerName}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      <Money amount={loan.capital} variant="display" /> · due {dateFormat.format(loan.dueOn)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Money amount={loan.total} variant="display" className="text-sm font-semibold" />
                    <LoanStatusBadge state={loan.state} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
