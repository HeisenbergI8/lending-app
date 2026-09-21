import Link from 'next/link'
import { ChevronRight, Users } from 'lucide-react'

import { BorrowerLabelBadge, TrackRecordLine } from '@/components/borrower-rating.tsx'
import { Avatar } from '@/components/avatar.tsx'
import { Money } from '@/components/money.tsx'
import { Pager } from '@/components/pager.tsx'
import { parsePage } from '@/lib/pagination.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listBorrowers } from '@/server/borrowers/queries.ts'

import { AddBorrower } from './add-borrower.tsx'

export const metadata = { title: 'Borrowers · Consignment Kush' }

/**
 * Everyone who owes, or ever did.
 *
 * The rating sits NEXT TO THE NAME rather than on the profile, by decision in
 * the spec: a rating you have to open a page to see is a rating you check after
 * you have already made up your mind.
 *
 * It does not block anything. There is no warning before lending to a badly
 * rated borrower — the admin knows, and the app is a ledger, not a gatekeeper.
 */
export default async function BorrowersPage({ searchParams }: PageProps<'/borrowers'>) {
  const user = await requireUser()
  const paging = parsePage((await searchParams).page)
  const { rows, totals } = await listBorrowers(user.id, paging)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Borrowers</h1>
          <p className="text-muted-foreground text-sm">
            {/* Both counts come from Postgres over EVERYONE, not from the
                twenty rows below. "3 owing right now" counts PEOPLE with at
                least one unpaid loan — not loans, and not pesos. */}
            {totals.all === 1 ? '1 person' : `${totals.all} people`} ·{' '}
            {totals.owing === 0 ? 'nobody owing' : `${totals.owing} owing right now`}
          </p>
        </div>
        <AddBorrower />
      </div>

      {rows.length === 0 ? (
        <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
          <Users className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-3 text-sm font-medium">No borrowers yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Add someone here, or create them while recording their first loan.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((borrower) => (
            <li key={borrower.id}>
              <Link
                href={`/borrowers/${borrower.id}`}
                className="bg-card group flex items-center gap-3 p-3.5 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
              >
                <Avatar name={`${borrower.firstName} ${borrower.lastName}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">
                      {borrower.firstName} {borrower.lastName}
                    </span>
                    {borrower.label ? <BorrowerLabelBadge label={borrower.label} /> : null}
                  </div>
                  <TrackRecordLine record={borrower.record} className="mt-1 block" />
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    {/* The figure beneath is the WHOLE unpaid balance, so it may
                        only be called overdue when the whole of it is. Keying the
                        word off `record.overdue > 0` instead meant one late loan
                        relabelled everything: a borrower holding ₱13,500 that was
                        late and ₱67,500 not yet due read as "overdue ₱81,000".
                        The count of late loans is carried by the track record
                        line above, which names it without touching the amount. */}
                    <div className="text-muted-foreground text-xs">
                      {borrower.outstanding > 0 && borrower.overdueOutstanding === borrower.outstanding
                        ? 'overdue'
                        : 'owes'}
                    </div>
                    <Money
                      amount={borrower.outstanding}
                      variant="display"
                      muted={borrower.outstanding === 0}
                      className="text-sm font-semibold"
                    />
                  </div>
                  <ChevronRight
                        className="text-muted-foreground/60 group-hover:text-brand size-4 shrink-0 transition-[color,transform] duration-200 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={paging.page}
        total={totals.all}
        noun="people"
        href={(page) => (page > 1 ? `/borrowers?page=${page}` : '/borrowers')}
      />
    </div>
  )
}
