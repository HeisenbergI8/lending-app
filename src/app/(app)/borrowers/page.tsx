import Link from 'next/link'
import { ChevronRight, Users } from 'lucide-react'

import { BorrowerLabelBadge, TrackRecordLine } from '@/components/borrower-rating.tsx'
import { Money } from '@/components/money.tsx'
import { requireUser } from '@/server/auth/guard.ts'
import { listBorrowers } from '@/server/borrowers/queries.ts'

import { AddBorrower } from './add-borrower.tsx'

export const metadata = { title: 'Borrowers · Lending App' }

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
export default async function BorrowersPage() {
  const user = await requireUser()
  const borrowers = await listBorrowers(user.id)

  const owing = borrowers.filter((borrower) => borrower.outstanding > 0).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Borrowers</h1>
          <p className="text-muted-foreground text-sm">
            {borrowers.length === 1 ? '1 person' : `${borrowers.length} people`} ·{' '}
            {owing === 0 ? 'nobody owing' : `${owing} owing right now`}
          </p>
        </div>
        <AddBorrower />
      </div>

      {borrowers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Users className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-3 text-sm font-medium">No borrowers yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Add someone here, or create them while recording their first loan.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {borrowers.map((borrower) => (
            <li key={borrower.id}>
              <Link
                href={`/borrowers/${borrower.id}`}
                className="bg-card hover:bg-muted/40 flex items-center gap-3 rounded-xl border p-4 transition-colors"
              >
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
                    <div className="text-muted-foreground text-xs">
                      {borrower.record.overdue > 0 ? 'overdue' : 'owes'}
                    </div>
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
    </div>
  )
}
