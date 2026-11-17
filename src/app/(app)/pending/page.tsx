import Link from 'next/link'
import { ArrowRight, CalendarPlus, Inbox } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { ActionForm } from '@/components/forms.tsx'
import { Money } from '@/components/money.tsx'
import { Pager } from '@/components/pager.tsx'
import { Button } from '@/components/ui/button'
import { formatPesos } from '@/lib/money/centavos.ts'
import { describeTerm } from '@/lib/money/weeks.ts'
import { parsePage } from '@/lib/pagination.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listBorrowerNames } from '@/server/borrowers/queries.ts'
import { deletePendingLoan } from '@/server/pending/actions.ts'
import { listPendingLoans } from '@/server/pending/queries.ts'

import { AddPendingLoan } from './add-pending.tsx'

export const metadata = { title: 'Pending loans' }

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/** createdAt is a moment in time; the Admin reads it as a day in Manila. */
const addedFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila' })
const manilaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }) // YYYY-MM-DD

/** "Added today", "Added yesterday", "Added 5 days ago" — counted in Manila calendar days. */
function daysAgo(at: Date): string {
  const days = Math.round((Date.parse(manilaDay.format(new Date())) - Date.parse(manilaDay.format(at))) / 86_400_000)
  if (days <= 0) return 'Added today'
  if (days === 1) return 'Added yesterday'
  return `Added ${days} days ago`
}

/** "7%", "7.5%" — basis points as the Admin typed them. 700 is 7. */
function ratePercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

/**
 * Everyone who has asked to borrow, with nobody's money behind them yet.
 *
 * A queue, newest first, and it is only a queue: a request blocks nothing,
 * appears on no other screen, and is counted in no total anywhere else in the
 * app. Nothing here has been lent, so nothing here belongs in the figures that
 * say what is out on loan.
 *
 * Every row shows what the loan WOULD come to. That wording is load bearing —
 * see the comments on the figures below.
 */
export default async function PendingLoansPage({ searchParams }: PageProps<'/pending'>) {
  const user = await requireUser()
  const paging = parsePage((await searchParams).page)
  const [{ rows, totals }, borrowers] = await Promise.all([
    listPendingLoans(user.id, paging),
    listBorrowerNames(user.id),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Pending loans</h1>
          <p className="text-muted-foreground text-sm">
            {/* Both figures come from Postgres over EVERY request on this
                account, not from the ten rows below, and both exclude loans
                entirely — a request that has been funded is deleted, so it is
                already out of this count.

                "asked for" is SUM("capitalCentavos"): the capital, with no
                interest in it. Calling it a total would read as the totals in
                the rows underneath, which DO include interest, and the two
                figures would never add up. */}
            {totals.all === 1 ? '1 request' : `${totals.all} requests`}
            {totals.all > 0 ? ` · ${formatPesos(totals.askedFor)} asked for` : ''}
          </p>
        </div>
        <AddPendingLoan borrowers={borrowers} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
          <Inbox className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-3 text-sm font-medium">No requests waiting</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Take down who has asked to borrow. Turn it into a loan once there is a lender for it.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((request) => (
            <li key={request.id} className="bg-card shadow-rest rounded-2xl p-4 ring-1 ring-border/70">
              {/* WHEN IT CAME IN: first, in its own pill, so the queue can be scanned by date. */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={`${request.firstName} ${request.lastName}`} />
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">
                      {request.firstName} {request.lastName}
                    </div>
                    <div className="text-muted-foreground text-xs">{daysAgo(request.createdAt)}</div>
                  </div>
                </div>
                <span className="bg-muted text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium">
                  <CalendarPlus className="size-3.5" aria-hidden />
                  <span className="sr-only">Added </span>
                  {addedFormat.format(request.createdAt)}
                </span>
              </div>

              {/* The amount ASKED FOR, which is capital alone, then capital plus
                  interest: what comes BACK. The interest is capital x rate x
                  weeks, worked out on every read by the same function that will
                  store it if this becomes a loan. Nothing is fixed: correct the
                  rate and both move. */}
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-muted-foreground text-xs">Asking for</dt>
                  <dd><Money amount={request.capital} variant="display" className="text-lg font-semibold" /></dd>
                </div>
                <div className="text-right">
                  <dt className="text-muted-foreground text-xs">Total to repay</dt>
                  <dd><Money amount={request.total} variant="display" className="text-lg font-semibold" /></dd>
                </div>
              </dl>
              <p className="text-muted-foreground mt-1 text-xs">
                {describeTerm(request.termDays)} · {ratePercent(request.rateBps)} a week · <Money amount={request.interest} variant="display" /> interest
              </p>

              <div className="border-border/70 mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-muted-foreground text-xs">
                  {request.startOn
                    ? `Wants it from ${dateFormat.format(request.startOn)}`
                    : 'No start date yet'}
                </p>

                <div className="flex items-center gap-2">
                  {/* Converting does not copy anything into the loan by itself —
                      it opens the loan form filled in, and the request is
                      deleted only once that form is saved. Abandoning it
                      half-way leaves the request exactly where it was. */}
                  <Button asChild size="sm">
                    <Link href={`/loans/new?pending=${request.id}`}>
                      Make the loan
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </Button>

                  <ActionForm
                    action={deletePendingLoan}
                    sound="trash"
                    values={{ pendingId: request.id }}
                    variant="ghost"
                    size="sm"
                    pendingLabel="Deleting…"
                    confirm={{
                      title: 'Delete this request?',
                      body: `${request.firstName} ${request.lastName}'s request is deleted for good. It does not go to Recently Deleted, because nothing has been lent on it.`,
                      action: 'Delete',
                    }}
                  >
                    Delete
                  </ActionForm>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={paging.page}
        total={totals.all}
        noun="requests"
        href={(page) => (page > 1 ? `/pending?page=${page}` : '/pending')}
      />
    </div>
  )
}
