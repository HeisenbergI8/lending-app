import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { requireUser } from '@/server/auth/guard.ts'
import { createLoan } from '@/server/loans/actions.ts'
import { loanFormOptions } from '@/server/loans/queries.ts'
import { pendingLoan } from '@/server/pending/queries.ts'
import { addDays, calendarDate, toDateInput } from '@/lib/money/weeks.ts'

import { LoanForm } from '../loan-form.tsx'

export const metadata = { title: 'New loan · Consignment Kush' }

/**
 * Recording a loan.
 *
 * The due date is left blank rather than guessed. Both dates are typed by the
 * admin on purpose — that is what lets a loan be entered days after the cash
 * changed hands without the week count going wrong — and a pre-filled due date
 * is one that gets accepted without being read.
 *
 * `?pending=` IS THE ONE EXCEPTION, and only because the admin arrived by
 * pressing "Make the loan" on a request that already carries an amount, a rate
 * and a length. Every one of those is still editable here, and nothing is
 * copied anywhere until this form is saved — walking away leaves the request
 * untouched. An unreadable or already-converted id simply gives an empty form
 * rather than an error page: the request may well have just become a loan in
 * another tab.
 */
export default async function NewLoanPage({ searchParams }: PageProps<'/loans/new'>) {
  const user = await requireUser()
  const requestedId = (await searchParams).pending
  const fromRequest =
    typeof requestedId === 'string' ? await pendingLoan(user.id, requestedId) : null

  const options = await loanFormOptions(user.id)

  // A request with no start date on it starts today, which is the same default
  // the plain form has always had. A request that named one keeps it, and the
  // due date follows from the length either way — this is the one pair of dates
  // the admin did not type, so both are printed under the length dropdown.
  const start = fromRequest?.startOn ?? calendarDate(new Date())
  const startOn = toDateInput(start)
  const dueOn = fromRequest ? toDateInput(addDays(start, fromRequest.termDays)) : ''

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={fromRequest ? '/pending' : '/loans'}
          className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {fromRequest ? 'Pending loans' : 'Loans'}
        </Link>
        <h1 className="mt-2 text-[1.75rem] font-semibold tracking-tight">New loan</h1>
        <p className="text-muted-foreground text-sm">
          {fromRequest
            ? `${fromRequest.firstName} ${fromRequest.lastName}'s request, filled in. Saving it records the loan and clears the request.`
            : 'The interest and everyone’s share are worked out once, when the loan is saved.'}
        </p>
      </div>

      <LoanForm
        action={createLoan}
        borrowers={options.borrowers}
        lenders={options.lenders}
        submitLabel="Record loan"
        initial={{
          pendingId: fromRequest?.id,
          // A request holds a typed name and no Borrower row, deliberately, so
          // converting one always opens on "Someone new". If they turn out to
          // be an existing borrower the dropdown is right there.
          borrowerId: fromRequest ? 'new' : (options.borrowers[0]?.id ?? 'new'),
          borrowerFirstName: fromRequest?.firstName,
          borrowerLastName: fromRequest?.lastName,
          capital: fromRequest ? (fromRequest.capital / 100).toFixed(2) : '',
          startOn,
          dueOn,
          // The weekly rate is the default, and the placeholders in the two rate
          // boxes carry the usual 7 and 2 rather than the boxes being filled in.
          interestBasis: 'WEEKLY_RATE',
          // A new loan collects at the end unless the Admin ticks the box.
          interestCollection: 'AT_END',
          borrowerRate: fromRequest ? String(fromRequest.rateBps / 100) : '',
          adminCut: '',
          fixedInterest: '',
          fixedLenderShare: '',
          funders: [],
        }}
      />
    </div>
  )
}
