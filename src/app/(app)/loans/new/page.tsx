import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { requireUser } from '@/server/auth/guard.ts'
import { createLoan } from '@/server/loans/actions.ts'
import { loanFormOptions } from '@/server/loans/queries.ts'

import { LoanForm } from '../loan-form.tsx'

export const metadata = { title: 'New loan · Consignment Kush' }

/** Today, as <input type="date"> wants it, in the admin's own timezone. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Recording a loan.
 *
 * The due date is left blank rather than guessed. Both dates are typed by the
 * admin on purpose — that is what lets a loan be entered days after the cash
 * changed hands without the week count going wrong — and a pre-filled due date
 * is one that gets accepted without being read.
 */
export default async function NewLoanPage() {
  const user = await requireUser()
  const options = await loanFormOptions(user.id)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/loans" className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0">
          <ArrowLeft className="size-4" aria-hidden />
          Loans
        </Link>
        <h1 className="mt-2 text-[1.75rem] font-semibold tracking-tight">New loan</h1>
        <p className="text-muted-foreground text-sm">
          The interest and everyone&rsquo;s share are worked out once, when the loan is saved.
        </p>
      </div>

      <LoanForm
        action={createLoan}
        borrowers={options.borrowers}
        lenders={options.lenders}
        submitLabel="Record loan"
        initial={{
          borrowerId: options.borrowers[0]?.id ?? 'new',
          capital: '',
          startOn: today(),
          dueOn: '',
          // The weekly rate is the default, and the placeholders in the two rate
          // boxes carry the usual 7 and 2 rather than the boxes being filled in.
          interestBasis: 'WEEKLY_RATE',
          borrowerRate: '',
          adminCut: '',
          fixedInterest: '',
          fixedLenderShare: '',
          funders: [],
        }}
      />
    </div>
  )
}
