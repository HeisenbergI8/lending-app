import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  HandCoins,
  ImageIcon,
  Pencil,
  TrendingUp,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react'

import { ActionForm } from '@/components/forms.tsx'
import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Money } from '@/components/money.tsx'
import { IconChip, StatRow, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { formatPesos } from '@/lib/money/centavos.ts'
import { describeTerm } from '@/lib/money/weeks.ts'
import { describeBytes } from '@/lib/proof.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { deleteLoan, deleteLoanNote } from '@/server/loans/actions.ts'
import { type LoanDetail, getLoan } from '@/server/loans/queries.ts'
import { deleteProof, undoPayment } from '@/server/payments/actions.ts'
import { paymentForLoan } from '@/server/payments/queries.ts'

import { AdvanceForm } from './advance-form.tsx'
import { NoteForm } from './note-form.tsx'
import { AddProofForm, MarkPaidPanel } from './payment-panel.tsx'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
// A note is often several in one day, so it carries the time as well as the date.
const stampFormat = new Intl.DateTimeFormat('en-PH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const percent = (bps: number) => `${(bps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}%`

/**
 * " 5%/wk", or nothing at all when the loan charges a fixed amount.
 *
 * A fixed-amount loan stores no rate — there was none — so the line says what
 * was earned and stops. The alternative, printing a rate worked back out of the
 * amount, would put a percentage on the screen that nobody agreed to.
 */
const perWeek = (bps: number | null) => (bps === null ? '' : ` ${percent(bps)}/wk`)

/** How this loan charges, for the line under the borrower's name. */
const chargeNote = (loan: { interestBasis: string; borrowerRateBps: number | null }) =>
  loan.interestBasis === 'WEEKLY_RATE' && loan.borrowerRateBps !== null
    ? `borrower pays ${percent(loan.borrowerRateBps)} a week`
    : 'interest set as a fixed amount'

/** "2026-09-22" for <input type="date">, in the admin's own timezone. */
function todayForInput(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** "Maria Santos" → "Maria". The full name is already on the line above it. */
const firstName = (name: string) => name.split(' ')[0]

export async function generateMetadata({ params }: PageProps<'/loans/[id]'>) {
  const user = await requireUser()
  const loan = await getLoan(user.id, (await params).id)
  return { title: loan ? `${loan.borrowerName}'s loan · Consignment Kush` : 'Loan · Consignment Kush' }
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
        <Link href="/loans" className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0">
          <ArrowLeft className="size-4" aria-hidden />
          Loans
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[1.75rem] font-semibold tracking-tight">
                <Link
                  href={`/borrowers/${loan.borrowerId}`}
                  className="-my-1 inline-flex min-h-11 items-center py-1 hover:underline pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0"
                >
                  {loan.borrowerName}
                </Link>
              </h1>
              <LoanStatusBadge state={loan.state} />
            </div>
            <p className="text-muted-foreground text-sm">
              {dateFormat.format(loan.startOn)} → {dateFormat.format(loan.dueOn)} ·{' '}
              {describeTerm(loan.termDays)} · {chargeNote(loan)}
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
            <ActionForm
              action={deleteLoan}
              values={{ loanId: loan.id }}
              variant="destructive"
              size="sm"
              pendingLabel="Deleting…"
              confirm={{
                title: 'Delete this loan?',
                body: 'It moves to Recently Deleted with its payment and proof, and can be restored for thirty days.',
                action: 'Delete loan',
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete loan
            </ActionForm>
          </div>
        </div>
      </div>

      <StatTile
        hero
        icon={paid ? CheckCircle2 : HandCoins}
        label={paid ? 'Repaid' : 'They repay'}
        value={<Money amount={loan.total} variant="display" />}
        note={
          paid && loan.paidOn
            ? `${formatPesos(loan.capital)} capital · paid ${dateFormat.format(loan.paidOn)}`
            : `${formatPesos(loan.capital)} capital · ${describeTerm(loan.termDays)} · ${chargeNote(loan)}`
        }
        tone={loan.state === 'overdue' ? 'critical' : undefined}
      />

      {/* THE INTEREST, BROKEN IN TWO. One "Interest ₱8,400" tile answers what the
          borrower pays and nothing about who keeps it, and the admin's own share
          is the figure they actually came to the page for. The capital moved up
          into the hero's note to make room — it is context for the total, not a
          fourth headline. The Admin share and theirs always add back to the total,
          because lenderEarnings is carved out of it rather than re-derived. */}
      <StatRow>
        <StatTile
          icon={TrendingUp}
          tint="sky"
          label="Total interest"
          value={<Money amount={loan.interest} variant="display" />}
          note="what the borrower pays on top"
        />
        <StatTile
          icon={Wallet}
          tint="violet"
          label="Admin interest"
          value={<Money amount={loan.adminEarnings} variant="display" muted={loan.adminEarnings === 0} />}
          note="the Admin cut, plus the Admin’s own money"
        />
        <StatTile
          icon={Users}
          tint="mint"
          label="Lenders' interest"
          value={<Money amount={loan.lenderEarnings} variant="display" muted={loan.lenderEarnings === 0} />}
          note={loan.lenderEarnings === 0 ? 'nobody else funded this' : 'the other funders’ share'}
        />
      </StatRow>

      {/* Paying is the one thing this page is for once a loan is running, so it
          sits above the funding breakdown rather than under it. */}
      {paid ? (
        <PaymentSection loanId={loan.id} payment={payment} missingProof={loan.missingProof} />
      ) : (
        <MarkPaidPanel loanId={loan.id} total={formatPesos(loan.total)} />
      )}

      {/* DRAWING EARLY ON WHAT THIS LOAN WILL RETURN. Rendered only when there
          is something to say: a loan that gives the Admin pot nothing, and has
          had nothing drawn on it, gets no section at all rather than a row of
          zeroes. A repaid loan keeps the section for the record but loses the
          button — once the money is really in the pot, an ordinary withdrawal
          on the Admin pot's page is the honest record. */}
      {loan.adminStake.stake > 0 || loan.advances.length > 0 ? (
        <AdvanceSection loan={loan} paid={paid} />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Whose money, and what it earns</h2>

        <ul className="space-y-2">
          {loan.funders.map((funder) => (
            <li key={funder.lenderId} className="bg-card rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/lenders/${funder.lenderId}`}
                  className="-my-2 inline-flex min-h-11 items-center py-2 text-sm font-medium hover:underline pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0"
                >
                  {funder.name}
                </Link>
                <Money amount={funder.principal} variant="display" className="text-sm font-semibold" />
              </div>

              {/* THE ADMIN'S OWN MONEY GETS ONE LINE, not two columns.
                  An "Admin cut ₱0.00" beside it is arithmetically right and reads as
                  a loss: the cut is what the admin takes OUT of a lender's share,
                  and on their own money there is no one to take it from. The whole
                  amount is already theirs, so the row says that instead. */}
              {funder.isSelf ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  Admin earns{perWeek(funder.lenderRateBps)} ·{' '}
                  <span className="text-foreground font-medium">
                    <Money amount={funder.earnings} variant="display" />
                  </span>
                  . All of it: the Admin’s own money, with nothing to split.
                </p>
              ) : (
                /* One column on a phone, two from `sm`. Each of these is a
                   sentence plus a peso amount; side by side in half of a 375px
                   screen they wrapped into an unreadable stack of fragments. */
                <dl className="text-muted-foreground mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 sm:gap-2">
                  <div className="flex items-center justify-between gap-1.5 sm:justify-start">
                    <dt>
                      {firstName(funder.name)} earns{perWeek(funder.lenderRateBps)}
                    </dt>
                    <dd className="text-foreground shrink-0 font-medium">
                      <Money amount={funder.earnings} variant="display" />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-1.5 sm:justify-start">
                    <dt>Admin cut{perWeek(funder.adminCutBps)}</dt>
                    <dd className="text-foreground shrink-0 font-medium">
                      <Money amount={funder.adminCut} variant="display" />
                    </dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">
          Every share was fixed when the loan was created and is never recalculated.
        </p>
      </section>

      <NotesSection loanId={loan.id} notes={loan.notes} />
    </div>
  )
}

/**
 * What the Admin can still draw against this loan, and what they already have.
 *
 * THREE FIGURES THAT ADD UP, printed together because separately any one of
 * them is misleading. "Returns" is everything the loan hands the Admin pot when
 * it settles: their own capital back, what that capital earned, and the cut
 * charged on the other funders' money. "Drawn" is what has left already.
 * "Left to draw" is the difference, and the server recomputes it before
 * accepting anything — see adminStakeInLoan.
 *
 * NONE OF THIS IS MONEY IN HAND. The interest inside "Returns" has not arrived;
 * that is what makes a draw against it an advance rather than a withdrawal, and
 * why the pot's floating funds can go negative when one is taken.
 */
function AdvanceSection({ loan, paid }: { loan: LoanDetail; paid: boolean }) {
  const { stake, advanced, headroom } = loan.adminStake

  return (
    <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconChip icon={Wallet} tint="violet" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">The Admin&rsquo;s share of this loan</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {paid
                ? 'This loan has been repaid, so its share is in the Admin pot already.'
                : 'Money can be drawn out of the Admin pot now, against what this loan will return to it.'}
            </p>
          </div>
        </div>

        {paid || headroom === 0 ? null : (
          <AdvanceForm loanId={loan.id} headroom={formatPesos(headroom)} today={todayForInput()} />
        )}
      </div>

      <dl className="grid gap-2 sm:grid-cols-3">
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt className="text-muted-foreground text-xs">Returns to the Admin pot</dt>
          <dd className="text-sm font-semibold sm:mt-0.5">
            <Money amount={stake} variant="display" />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt className="text-muted-foreground text-xs">Drawn in advance</dt>
          <dd className="text-sm sm:mt-0.5">
            <Money amount={advanced} variant="display" muted={advanced === 0} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt className="text-muted-foreground text-xs">Left to draw</dt>
          <dd className="text-sm sm:mt-0.5">
            <Money amount={headroom} variant="display" muted={headroom === 0} />
          </dd>
        </div>
      </dl>

      {loan.advances.length > 0 ? (
        <ul className="divide-border/70 border-border divide-y rounded-xl border">
          {loan.advances.map((advance) => (
            <li key={advance.id} className="flex items-center gap-3 p-2.5">
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                <ArrowUpRight className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">Advance</div>
                <div className="text-muted-foreground truncate text-xs">
                  {dateFormat.format(advance.occurredOn)}
                  {advance.note ? ` · ${advance.note}` : ''}
                </div>
              </div>
              <Money amount={advance.amount} variant="display" className="text-sm font-semibold" />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {loan.advances.length > 0
          ? 'Each advance is a withdrawal on the Admin pot and is undone from there, in the withdrawal history.'
          : 'An advance leaves the Admin pot the day it is taken, whether or not this loan has been repaid.'}
      </p>
    </section>
  )
}

/**
 * The Admin's own remarks on a loan.
 *
 * Newest first, because the last thing that happened is what is being looked
 * for. Nothing here is a figure and nothing adds these up: it is a place to
 * write down what was said on the phone, and the rest of the app never reads it.
 *
 * DELETING ONE REALLY DELETES IT. Everything else in this app goes to Recently
 * Deleted for thirty days because destroying it would destroy money history;
 * a note carries none. The dialog says so rather than promising an undo that
 * does not exist.
 */
function NotesSection({ loanId, notes }: { loanId: string; notes: LoanDetail['notes'] }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Notes</h2>
        {notes.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {notes.length === 1 ? '1 note' : `${notes.length} notes`}
          </p>
        ) : null}
      </div>

      <NoteForm loanId={loanId} />

      {notes.length === 0 ? (
        <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-6 text-center text-sm">
          Nothing written on this loan yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="bg-card rounded-2xl p-3 ring-1 ring-border/70 shadow-rest">
              <div className="flex items-start justify-between gap-3">
                {/* The note as it was typed, line breaks and all. A remark is
                    often a short list, and collapsing it to one paragraph would
                    lose the thing that made it readable. */}
                <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap">{note.body}</p>
                <ActionForm
                  action={deleteLoanNote}
                  values={{ noteId: note.id }}
                  variant="ghost"
                  size="sm"
                  pendingLabel="Deleting…"
                  confirm={{
                    title: 'Delete this note?',
                    body: 'Notes are not kept in Recently Deleted. This one goes for good.',
                    action: 'Delete note',
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  <span className="sr-only">Delete note</span>
                </ActionForm>
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">{stampFormat.format(note.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * What was paid, and what backs it up.
 *
 * The "no proof" warning is prominent by design: a payment can be recorded with
 * nothing attached, and the only thing stopping that being forgotten is this
 * line. It disappears the moment a file arrives.
 *
 * Undoing a payment puts the loan back to running. The payment row is deleted
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
    <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Payment</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {payment ? `Paid in full on ${dateFormat.format(payment.paidOn)}.` : 'Recorded as paid.'}
          </p>
        </div>
        <ActionForm
          action={undoPayment}
          values={{ loanId }}
          variant="ghost"
          size="sm"
          pendingLabel="Undoing…"
          confirm={{
            title: 'Undo this payment?',
            body: 'The loan goes back to running. The proof stays attached, so marking it paid again picks up where this left off.',
            action: 'Undo payment',
          }}
        >
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
                    {file.isPdf ? 'Document' : 'Screenshot'} {index + 1} · link unavailable
                  </span>
                )}
                <div className="text-muted-foreground text-xs">{describeBytes(file.sizeBytes)}</div>
              </div>

              <ActionForm
                action={deleteProof}
                values={{ proofFileId: file.id }}
                variant="ghost"
                size="sm"
                pendingLabel="Removing…"
                confirm={{
                  title: 'Remove this file?',
                  body: 'It stops showing on the payment. It is not listed on Recently Deleted, so put it back by uploading it again.',
                  action: 'Remove file',
                }}
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
