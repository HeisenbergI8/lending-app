import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { storedCalendarDate, toDateInput } from '@/lib/money/weeks.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { updateLoan } from '@/server/loans/actions.ts'
import { getLoan, loanFormOptions } from '@/server/loans/queries.ts'

import { LoanForm } from '../../loan-form.tsx'

export const metadata = { title: 'Edit loan · Consignment Kush' }

/**
 * A stored Date back into the "2026-09-21" an <input type="date"> wants.
 *
 * THROUGH storedCalendarDate, and that matters more here than anywhere else it
 * was wrong. This hand-rolled copy of `toDateInput` read the local parts of a
 * `date` column, so west of London the edit form opened pre-filled with the day
 * BEFORE the loan's real start — and saving the form without touching the dates
 * would have written that day back. A display bug everywhere else; a silent data
 * change here.
 */
function forInput(date: Date): string {
  return toDateInput(storedCalendarDate(date))
}

/** Centavos back into the plain "30000.00" the admin typed. */
function pesosForInput(value: number): string {
  return (value / 100).toFixed(2)
}

/**
 * Correcting a loan entered wrong.
 *
 * The same form as creating one, because it is the same decision being made
 * again — and every figure is recomputed from what is submitted, since "entered
 * wrong" means the stored numbers answered the wrong question.
 */
export default async function EditLoanPage({ params }: PageProps<'/loans/[id]/edit'>) {
  const user = await requireUser()
  const { id } = await params

  const [loan, options] = await Promise.all([getLoan(user.id, id), loanFormOptions(user.id)])
  if (!loan) notFound()
  // Refused in the action too; this only saves the admin filling in a form that
  // was never going to save.
  if (loan.state === 'paid') redirect(`/loans/${loan.id}`)

  const onARate = loan.interestBasis === 'WEEKLY_RATE'
  const adminCutBps = loan.funders.find((funder) => !funder.isSelf)?.adminCutBps ?? 0

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/loans/${loan.id}`} className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0">
          <ArrowLeft className="size-4" aria-hidden />
          {loan.borrowerName}&rsquo;s loan
        </Link>
        <h1 className="mt-2 text-[1.75rem] font-semibold tracking-tight">Edit loan</h1>
        <p className="text-muted-foreground text-sm">
          Saving works every figure out again from what is entered here.
        </p>
      </div>

      <LoanForm
        action={updateLoan}
        borrowers={options.borrowers}
        lenders={options.lenders}
        submitLabel="Save changes"
        initial={{
          loanId: loan.id,
          borrowerId: loan.borrowerId,
          capital: pesosForInput(loan.capital),
          startOn: forInput(loan.startOn),
          // capitalDueOn, NOT loan.dueOn. On a weekly loan the latter is the
          // next unpaid week, and prefilling the edit form with it would
          // silently reprice the loan the first time the Admin pressed Save.
          dueOn: forInput(loan.capitalDueOn),
          interestBasis: loan.interestBasis,
          interestCollection: loan.interestCollection,
          borrowerRate: onARate && loan.borrowerRateBps !== null ? String(loan.borrowerRateBps / 100) : '',
          adminCut: onARate ? String(adminCutBps / 100) : '',
          fixedInterest: onARate ? '' : pesosForInput(loan.interest),
          // What the lenders keep, read back the way it was typed. lenderEarnings
          // is the loan's interest minus everything the Admin took, which on a
          // fixed-amount loan is exactly the figure that was entered here.
          fixedLenderShare: onARate ? '' : pesosForInput(loan.lenderEarnings),
          funders: loan.funders.map((funder) => ({
            lenderId: funder.lenderId,
            amount: pesosForInput(funder.principal),
          })),
        }}
      />
    </div>
  )
}
