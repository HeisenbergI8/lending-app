import Link from 'next/link'
import { AlertTriangle, Clock, HandCoins, MessageSquareText, Plus, SearchX } from 'lucide-react'

import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Avatar } from '@/components/avatar.tsx'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { Pager } from '@/components/pager.tsx'
import { isFiltered, loanFilterHref, parseLoanFilter } from '@/lib/loan-filter.ts'
import { parsePage } from '@/lib/pagination.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listLoans } from '@/server/loans/queries.ts'

import { LoanSearch } from './search-form.tsx'

export const metadata = { title: 'Loans' }

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
  const params = await searchParams
  const filter = parseLoanFilter(params)
  const paging = parsePage(params.page)
  const { rows, totals } = await listLoans(user.id, filter, paging)

  const searching = isFiltered(filter)
  // A page number past the end of the list. It is not "nothing matches" — the
  // search found plenty, this slice of it just does not exist — so it gets its
  // own message and a way back rather than the empty-search copy.
  const pastEnd = rows.length === 0 && totals.all > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Loans</h1>
          <p className="text-muted-foreground text-sm">
            {/* Every count here is `totals`, which Postgres computed across the
                whole filter — never the length of `rows`, which is one page.
                "6 active" has to mean six loans, not six of the twenty on
                screen, and the two stop being the same list at loan 21. */}
            {searching ? (
              totals.all === 1 ? (
                '1 match'
              ) : (
                `${totals.all} matches`
              )
            ) : (
              <>
                {/* "unpaid", matching the tile below: this is the same
                    COUNT(status = 'ACTIVE') and it INCLUDES overdue loans, while
                    the Active filter chip excludes them. Renaming the tile alone
                    left the collision here, one line above it. */}
                {totals.active === 1 ? '1 unpaid' : `${totals.active} unpaid`}
                {totals.paid > 0 ? ` · ${totals.paid} paid` : ''}
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

      {rows.length === 0 ? (
        pastEnd ? (
          <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
            <SearchX className="text-muted-foreground mx-auto size-7" aria-hidden />
            <p className="mt-3 text-sm font-medium">Nothing on this page</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
              The list is shorter than it was. Go back to the start of it.
            </p>
            <Button asChild variant="secondary" className="mt-4">
              <Link href={loanFilterHref(filter)}>First page</Link>
            </Button>
          </div>
        ) : searching ? (
          <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
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
          <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
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
          {/* The tiles describe the whole SEARCH, not the whole book and not
              the page: under a filter they describe the matches, and they do
              not shrink when you turn to page 2. Before paging existed those
              two readings were the same sentence; they are not any more. */}
          <StatRow>
            {/* Not "owed to you": on a loan a lender funded, most of this belongs
                to them. What is yours either way is the job of collecting it. */}
            {/* SUM("totalCentavos") over the ACTIVE loans the filter matches,
                across every page, MINUS the interest already collected on the
                weekly ones.

                The subtraction is new as of 2026-09-25 and the old sentence here
                ("a loan's total IS what is still outstanding on it") stopped
                being true when weekly collection arrived. There are still no
                partial payments (FEATURES §12) — but a loan collecting its
                interest weekly has genuinely handed some of its total over
                already, and counting that as still to come would contradict the
                lender tiles that have already spent it.

                The collected part comes from the funding rows through
                releasedOnFunding, NOT from summing Payment.amountCentavos, so
                this figure and every other "collected" figure in the app
                descend from one rule. See server/payments/collected.ts.

                Measured 2026-09-25: no loan on any account collects weekly yet
                (the interestCollection column did not exist in the database at
                that point), so the subtrahend is zero everywhere and this tile
                reads exactly as it did before. */}
            <StatTile
              icon={HandCoins}
              tint="indigo"
              label="Still to collect"
              value={<Money amount={totals.outstanding} variant="display" />}
            />
            {/* COUNT of status = ACTIVE, which INCLUDES the overdue ones — an
                overdue loan is still unpaid. So this tile and the one beside it
                overlap rather than adding up, and the badges below use "Active"
                in the narrower sense of "running and not yet late".
                Called "Unpaid" for that reason: measured on 2026-09-22 this tile
                read 6 beside "Overdue 1", inviting the sum 7 when six loans
                existed, and the Active filter chip then returned 5. One word was
                naming two different sets within a screen's height. The count is
                unchanged — only the label moved off the contested word. */}
            <StatTile icon={Clock} tint="sky" label="Unpaid" value={String(totals.active)} />
            {/* COUNT of status = ACTIVE AND dueOn < today, on the server's clock. */}
            <StatTile
              icon={AlertTriangle}
              label="Overdue"
              value={String(totals.overdue)}
              tone={totals.overdue > 0 ? 'critical' : undefined}
            />
          </StatRow>

          <ul className="space-y-2">
            {rows.map((loan) => (
              <li key={loan.id}>
                <Link
                  href={`/loans/${loan.id}`}
                  className="bg-card group block p-3.5 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={loan.borrowerName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{loan.borrowerName}</div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        <Money amount={loan.capital} variant="display" /> ·{' '}
                        {/* "week due" is not decoration. Without it a ₱4,200
                            week reads exactly like a ₱144,000 capital repayment
                            falling on the same day. */}
                        {loan.dueIsWeekly ? 'week due' : 'due'} {dateFormat.format(loan.dueOn)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Money amount={loan.total} variant="display" className="text-sm font-semibold" />
                      <LoanStatusBadge state={loan.state} />
                    </div>
                  </div>

                  {loan.latestNote || loan.funders.length > 0 ? (
                    <div className="border-border/70 mt-2.5 space-y-1.5 border-t pt-2">
                      {/* THE LAST THING WRITTEN ON THIS LOAN, above the funders
                          and not muted to match them. This list is read to
                          decide who to chase next, and "says Friday" changes
                          that answer in a way no figure on the card can.

                          ONE LINE, CLAMPED. A note has no length limit worth
                          relying on at 2,000 characters, and a card that grows
                          to fit one stops being a list. The count beside it is
                          what keeps the clamp honest: the card is showing the
                          newest of N, and it says so rather than looking like
                          the whole story. The loan's own page has them all. */}
                      {loan.latestNote ? (
                        <p className="flex items-start gap-1.5 text-xs">
                          <MessageSquareText
                            className="text-muted-foreground mt-px size-3.5 shrink-0"
                            aria-hidden
                          />
                          <span className="text-foreground/90 line-clamp-1">{loan.latestNote.body}</span>
                          {loan.noteCount > 1 ? (
                            <span className="text-muted-foreground shrink-0">
                              +{loan.noteCount - 1} more
                            </span>
                          ) : null}
                        </p>
                      ) : null}

                      {/* WHOSE MONEY, along the bottom. The amount beside each
                          name is that funder's `principalCentavos` — what they
                          PUT IN, never what they earn on it. Their earnings are
                          a separate stored column and are on the loan's own
                          page; putting the two within a card of each other is
                          how one gets read as the other.

                          Largest share first, and deliberately allowed to WRAP
                          rather than truncate: a name cut to "Jo…" beside a
                          five-figure sum is the one thing on this card nobody
                          should have to guess at. Two lines on a phone is the
                          right price for that. */}
                      {loan.funders.length > 0 ? (
                        <p className="text-muted-foreground text-xs">
                          {loan.funders.map((funder, index) => (
                            <span key={funder.lenderId}>
                              {index > 0 ? ' · ' : ''}
                              {funder.name} <Money amount={funder.principal} variant="display" />
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          <Pager
            page={paging.page}
            total={totals.all}
            noun="loans"
            href={(page) => loanFilterHref(filter, {}, page)}
          />
        </>
      )}
    </div>
  )
}
