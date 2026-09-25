'use client'

import { useActionState, useRef } from 'react'
import { CheckCircle2 } from 'lucide-react'

import { SubmitButton } from '@/components/forms.tsx'
import { ProofInput } from '@/components/proof-input.tsx'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FormState, NO_ERROR } from '@/lib/form-state.ts'
import { addProof, markPaid } from '@/server/payments/actions.ts'

/**
 * Marking a loan paid, with the proof attached in the same step.
 *
 * THE AMOUNT IS NOT A FIELD. Full payment only — the borrower hands over the
 * whole total, which was fixed the day the loan was created. Showing it as an
 * editable number would invite a partial payment the rest of the app has no way
 * to represent.
 *
 * The files are optional and the button says so, because a repayment that
 * happened must be recordable the moment it happens, not whenever the screenshot
 * turns up. The loan carries a "no proof" warning until one does.
 */

/**
 * Clear the picked files once they have been attached.
 *
 * Wrapping the action in a closure costs this form its no-JavaScript fallback —
 * Next can only post a form straight to the server when the action passed to
 * useActionState IS the server action, not a function that calls one. That is an
 * acceptable trade HERE and nowhere else on this page: choosing files, shrinking
 * them and showing what was picked all need JavaScript anyway, so there was no
 * fallback to lose. Mark-as-paid, which needs none of that, is left unwrapped.
 */
function useClearOnSuccess(action: (state: FormState, form: FormData) => Promise<FormState>) {
  const formRef = useRef<HTMLFormElement>(null)

  // Clearing happens in the submit rather than in an effect watching the result:
  // the form clears BECAUSE something was saved, and saying so here is both
  // simpler and what the React compiler's rules ask for.
  const [state, formAction] = useActionState(async (previous: FormState, form: FormData) => {
    const result = await action(previous, form)
    if (result.error === null) formRef.current?.reset()
    return result
  }, NO_ERROR)

  return { formRef, state, formAction }
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function MarkPaidPanel({
  loanId,
  total,
  weekly = false,
}: {
  loanId: string
  total: string
  /** True on a loan collecting its interest weekly: this records February. */
  weekly?: boolean
}) {
  // markPaid itself, not a wrapper: this form is rendered server-side and posts
  // without JavaScript. Nothing needs clearing afterwards — on success the whole
  // section is replaced by the payment that was just recorded.
  const [state, formAction] = useActionState(markPaid, NO_ERROR)

  return (
    <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Mark as paid</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {weekly
            ? `Records the capital and the last week, ${total}. Every week before it is collected on its own.`
            : `Records the full ${total}. There are no partial payments.`}
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="loanId" value={loanId} />

        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="paidOn">Date paid</Label>
          <Input id="paidOn" name="paidOn" type="date" defaultValue={today()} required />
        </div>

        <ProofInput
          label="Proof of payment"
          hint="Optional. The screenshot, the chat, or both. They can be added later."
        />

        {state.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <SubmitButton pendingLabel="Recording…" className="w-full sm:w-auto">
          <CheckCircle2 className="size-4" aria-hidden />
          Mark as paid
        </SubmitButton>
      </form>
    </section>
  )
}

/**
 * Attaching the screenshot that was still on someone's phone at the time.
 *
 * `paymentId` names WHICH payment on a loan that collects its interest weekly,
 * because there are up to twenty of them and a week ticked off during a
 * conversion is flagged "No proof" until one arrives. Without it this attaches to
 * the payment that settled the loan, which is what every caller meant back when
 * a loan had only one — and which does not exist yet on a running weekly loan.
 */
export function AddProofForm({ loanId, paymentId }: { loanId: string; paymentId?: string }) {
  const { formRef, state, formAction } = useClearOnSuccess(addProof)

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="loanId" value={loanId} />
      {paymentId ? <input type="hidden" name="paymentId" value={paymentId} /> : null}

      <ProofInput label="Add proof" hint="Images are shrunk before they are stored." />

      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton pendingLabel="Attaching…" variant="outline" className="w-full sm:w-auto">
        Attach files
      </SubmitButton>
    </form>
  )
}
