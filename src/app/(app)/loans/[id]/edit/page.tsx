import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { requireUser } from '@/server/auth/guard.ts'
import { updateLoan } from '@/server/loans/actions.ts'
import { getLoan, loanFormOptions } from '@/server/loans/queries.ts'

import { LoanForm } from '../../loan-form.tsx'

export const metadata = { title: 'Edit loan · Lending App' }

/** A stored Date back into the "2026-09-21" an <input type="date"> wants. */
function forInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

  const adminCutBps = loan.funders.find((funder) => !funder.isSelf)?.adminCutBps ?? 0

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/loans/${loan.id}`} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" aria-hidden />
          {loan.borrowerName}&rsquo;s loan
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit loan</h1>
        <p className="text-muted-foreground text-sm">
          Saving works every figure out again from what you enter here.
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
          dueOn: forInput(loan.dueOn),
          borrowerRate: String(loan.borrowerRateBps / 100),
          adminCut: String(adminCutBps / 100),
          funders: loan.funders.map((funder) => ({
            lenderId: funder.lenderId,
            amount: pesosForInput(funder.principal),
          })),
        }}
      />
    </div>
  )
}
