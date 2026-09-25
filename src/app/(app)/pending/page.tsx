import Link from 'next/link'
import { ArrowRight, Inbox } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { ActionForm } from '@/components/forms.tsx'
import { Money } from '@/components/money.tsx'
import { Pager } from '@/components/pager.tsx'
import { Button } from '@/components/ui/button'
import { formatPesos } from '@/lib/money/centavos.ts'
import { describeTerm } from '@/lib/money/weeks.ts'
import { parsePage } from '@/lib/pagination.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { deletePendingLoan } from '@/server/pending/actions.ts'
import { listPendingLoans } from '@/server/pending/queries.ts'

import { AddPendingLoan } from './add-pending.tsx'

export const metadata = { title: 'Pending loans' }

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

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
  const { rows, totals } = await listPendingLoans(user.id, paging)

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
        <AddPendingLoan />
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
            <li
              key={request.id}
              className="bg-card block p-3.5 rounded-2xl ring-1 ring-border/70 shadow-rest"
            >
              <div className="flex items-center gap-3">
                <Avatar name={`${request.firstName} ${request.lastName}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {request.firstName} {request.lastName}
                  </div>
                  {/* The amount ASKED FOR, which is capital alone. The interest
                      beside it is capital x rate x weeks, worked out on every
                      read by the same function that will store it if this
                      becomes a loan — so a request converted unchanged shows the
                      same figures afterwards. Nothing here is fixed: correct the
                      rate and both move. */}
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    <Money amount={request.capital} variant="display" /> ·{' '}
                    {describeTerm(request.termDays)} · {ratePercent(request.rateBps)} a week (
                    <Money amount={request.interest} variant="display" />)
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {/* Capital plus that interest. "Would owe" rather than "Total"
                      because nothing has been agreed: no money has changed
                      hands, no lender is behind it, and the figure moves if the
                      rate or the length is corrected. A loan's total cannot. */}
                  <div className="text-muted-foreground text-xs">would owe</div>
                  <Money amount={request.total} variant="display" className="text-sm font-semibold" />
                </div>
              </div>

              <div className="border-border/70 mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
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
