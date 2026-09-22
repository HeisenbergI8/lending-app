'use client'

import { FormDialog } from '@/components/forms.tsx'
import { MoneyInput } from '@/components/money-input.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { recordAdvance } from '@/server/lenders/actions.ts'

/**
 * Taking money out against a loan that has not been repaid yet.
 *
 * The ceiling is stated in the dialog, not only enforced by the server. A form
 * that accepts a figure and then refuses it is a form that made the admin guess
 * — and the number they are guessing at is one this page already knows.
 *
 * THE FIGURE SHOWN IS STILL NOT THE AUTHORITY. It was rendered when the page
 * loaded, and the action recomputes it from the rows at the moment of writing;
 * an advance taken in another tab is caught there, not here.
 */
export function AdvanceForm({
  loanId,
  headroom,
  today,
}: {
  loanId: string
  /** What is left to draw against this loan, already formatted as pesos. */
  headroom: string
  today: string
}) {
  return (
    <FormDialog
      action={recordAdvance}
      openLabel="Take an advance"
      title="Advance against this loan"
      description={`Money out of the Admin pot now, against what this loan will return to it. ${headroom} is left to draw.`}
      submitLabel="Record the advance"
    >
      <input type="hidden" name="loanId" value={loanId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyInput name="amount" label="Amount" />
        <div className="space-y-2">
          <Label htmlFor="occurredOn">Date taken</Label>
          <Input id="occurredOn" name="occurredOn" type="date" defaultValue={today} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input id="note" name="note" autoComplete="off" placeholder="What it was for" />
      </div>

      <p className="text-muted-foreground text-xs">
        This leaves the Admin pot straight away, so Floating drops by the full amount today. It can
        go below zero, and that is the true picture until the borrower repays.
      </p>
    </FormDialog>
  )
}
