import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, FileText, ImageIcon, Pencil } from 'lucide-react'

import { ActionForm } from '@/components/forms.tsx'
import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { formatPesos } from '@/lib/money/centavos.ts'
import { describeBytes } from '@/lib/proof.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { archiveLoan } from '@/server/loans/actions.ts'
import { getLoan } from '@/server/loans/queries.ts'
import { archiveProof, undoPayment } from '@/server/payments/actions.ts'
import { paymentForLoan } from '@/server/payments/queries.ts'

import { AddProofForm, MarkPaidPanel } from './payment-panel.tsx'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
const percent = (bps: number) => `${(bps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}%`

export async function generateMetadata({ params }: PageProps<'/loans/[id]'>) {
  const user = await requireUser()
  const loan = await getLoan(user.id, (await params).id)
  return { title: loan ? `${loan.borrowerName}'s loan · Lending App` : 'Loan · Lending App' }
}

/**
 * One loan, and where every peso of it goes.
 *
 * Nothing on this page is recalculated. Each figure was decided the day the loan
 * was created and written down, so what is shown here is what was agreed — not
 * what today's default rates would produce.
 */
export default async function LoanPage({ params }: PageProps<'/loans/[id]'>) {
  const user = await requireUser()
  const { id } = await params
  const loan = await getLoan(user.id, id)
  if (!loan) notFound()

  const paid = loan.state === 'paid'
  const payment = paid ? await paymentForLoan(user.id, id) : null

  return (
    <div className="space-y-6">
      <div>
        <Link href="/loans" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" aria-hidden />
          Loans
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                <Link href={`/borrowers/${loan.borrowerId}`} className="hover:underline">
                  {loan.borrowerName}
                </Link>
              </h1>
              <LoanStatusBadge state={loan.state} />
            </div>
            <p className="text-muted-foreground text-sm">
              {dateFormat.format(loan.startOn)} → {dateFormat.format(loan.dueOn)} ·{' '}
              {loan.weeks === 1 ? '1 week' : `${loan.weeks} weeks`} at {percent(loan.borrowerRateBps)} a week
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* A paid loan is not editable: its payment records a total that was
                agreed and handed over, and changing one without the other would
                leave the two disagreeing with nothing to say which is right. */}
            {paid ? null : (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/loans/${loan.id}/edit`}>
                  <Pencil className="size-4" aria-hidden />
                  Edit
                </Link>
              </Button>
            )}
            <ActionForm action={archiveLoan} values={{ loanId: loan.id }} variant="ghost" size="sm" pendingLabel="Undoing…">
              Undo loan
            </ActionForm>
          </div>
        </div>
      </div>

      <StatTile
        hero
        label={paid ? 'Repaid' : 'They repay'}
        value={<Money amount={loan.total} variant="display" />}
        note={
          paid && loan.paidOn
            ? `paid ${dateFormat.format(loan.paidOn)}`
            : `${loan.weeks === 1 ? '1 week' : `${loan.weeks} weeks`} at ${percent(loan.borrowerRateBps)}`
        }
        tone={loan.state === 'overdue' ? 'critical' : undefined}
      />

      <StatRow>
        <StatTile label="Capital" value={<Money amount={loan.capital} variant="display" />} />
        <StatTile label="Interest" value={<Money amount={loan.interest} variant="display" />} />
        <StatTile label="You earn" value={<Money amount={loan.adminEarnings} variant="display" />} />
      </StatRow>

      {/* Paying is the one thing this page is for once a loan is running, so it
          sits above the funding breakdown rather than under it. */}
      {paid ? (
        <PaymentSection loanId={loan.id} payment={payment} missingProof={loan.missingProof} />
      ) : (
        <MarkPaidPanel loanId={loan.id} total={formatPesos(loan.total)} />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Whose money, and what it earns</h2>

        <ul className="space-y-2">
          {loan.funders.map((funder) => (
            <li key={funder.lenderId} className="bg-card rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <Link href={`/lenders/${funder.lenderId}`} className="text-sm font-medium hover:underline">
                  {funder.name}
                </Link>
                <Money amount={funder.principal} variant="display" className="text-sm font-semibold" />
              </div>

              <dl className="text-muted-foreground mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <dt>Earns {percent(funder.lenderRateBps)}/wk</dt>
                  <dd className="text-foreground font-medium">
                    <Money amount={funder.earnings} variant="display" />
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Zero on the admin's own money — they charge themselves nothing. */}
                  <dt>Your cut {percent(funder.adminCutBps)}/wk</dt>
                  <dd className="text-foreground font-medium">
                    <Money amount={funder.adminCut} variant="display" muted={funder.adminCut === 0} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">
          Every share was fixed when the loan was created and is never recalculated.
        </p>
      </section>
    </div>
  )
}

/**
 * What was paid, and what backs it up.
 *
 * The "no proof" warning is prominent by design: a payment can be recorded with
 * nothing attached, and the only thing stopping that being forgotten is this
 * line. It disappears the moment a file arrives.
 *
 * Undoing a payment puts the loan back to running. The payment row is archived
 * rather than destroyed, so the proof stays with it and marking it paid again
 * picks up where it left off.
 */
function PaymentSection({
  loanId,
  payment,
  missingProof,
}: {
  loanId: string
  payment: Awaited<ReturnType<typeof paymentForLoan>>
  missingProof: boolean
}) {
  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Payment</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {payment ? `Paid in full on ${dateFormat.format(payment.paidOn)}.` : 'Recorded as paid.'}
          </p>
        </div>
        <ActionForm action={undoPayment} values={{ loanId }} variant="ghost" size="sm" pendingLabel="Undoing…">
          Undo payment
        </ActionForm>
      </div>

      {missingProof ? (
        <p className="text-status-warning inline-flex items-center gap-1.5 text-sm font-medium">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          No proof attached yet
        </p>
      ) : null}

      {payment && payment.files.length > 0 ? (
        <ul className="space-y-2">
          {payment.files.map((file, index) => (
            <li key={file.id} className="flex items-center gap-3 rounded-lg border p-2.5">
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                {file.isPdf ? <FileText className="size-4" aria-hidden /> : <ImageIcon className="size-4" aria-hidden />}
              </span>

              <div className="min-w-0 flex-1 text-sm">
                {file.url ? (
                  // Signed, and good for a few minutes only — the bucket is
                  // private, so there is no lasting address to leak.
                  <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {file.isPdf ? 'Document' : 'Screenshot'} {index + 1}
                  </a>
                ) : (
                  <span className="text-muted-foreground font-medium">
                    {file.isPdf ? 'Document' : 'Screenshot'} {index + 1} — link unavailable
                  </span>
                )}
                <div className="text-muted-foreground text-xs">{describeBytes(file.sizeBytes)}</div>
              </div>

              <ActionForm
                action={archiveProof}
                values={{ proofFileId: file.id }}
                variant="ghost"
                size="sm"
                pendingLabel="Removing…"
              >
                Remove
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : null}

      <AddProofForm loanId={loanId} />
    </section>
  )
}
