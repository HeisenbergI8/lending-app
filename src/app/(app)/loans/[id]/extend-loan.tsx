'use client'

import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'

import { FormDialog } from '@/components/forms.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { centavos, formatPesos } from '@/lib/money/centavos.ts'
import { computeInterest } from '@/lib/money/interest.ts'
import { DAYS_PER_WEEK } from '@/lib/money/weeks.ts'
import { extendLoan } from '@/server/loans/extend-actions.ts'

const PRESETS = [1, 2, 3, 4]
const OTHER = 'other'
const onDay = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The Extend button and its dialog: how many more weeks, and when the extra
 * interest is paid.
 *
 * THE PREVIEW IS THE SERVER'S SUM, NOT A GUESS. On a weekly-rate loan the
 * interest is computeInterest over the weeks, the same function loanTerms calls,
 * so "₱4,200 more" here is the figure the save will write. A fixed-amount loan
 * has no rate, so the Admin types the extra and the preview repeats it.
 *
 * Until the LoanExtension table exists (`ready` false) the dialog says so and the
 * button is off, rather than letting the Admin fill it in to be refused.
 */
export function ExtendLoan({
  loanId,
  ready,
  capital,
  interest,
  termDays,
  dueOn,
  basis,
  collection,
  borrowerRateBps,
}: {
  loanId: string
  ready: boolean
  capital: number
  interest: number
  termDays: number
  /** The capital due date, as a calendar day. */
  dueOn: Date
  basis: 'WEEKLY_RATE' | 'FIXED_AMOUNT'
  collection: 'AT_END' | 'WEEKLY'
  borrowerRateBps: number | null
}) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState('1')
  const [other, setOther] = useState('')
  const [paidNow, setPaidNow] = useState(false)

  const weeks = choice === OTHER ? Number(other) : Number(choice)
  const validWeeks = Number.isInteger(weeks) && weeks >= 1 && weeks <= 52
  const newDue = validWeeks ? new Date(dueOn.getFullYear(), dueOn.getMonth(), dueOn.getDate() + weeks * DAYS_PER_WEEK, 12) : null
  const onRate = basis === 'WEEKLY_RATE' && borrowerRateBps !== null
  const canPayNow = collection === 'AT_END'

  let added: number | null = null
  if (validWeeks && onRate) {
    added = paidNow
      ? computeInterest({ capital: centavos(capital), rateBps: borrowerRateBps!, weeks })
      : computeInterest({ capital: centavos(capital), rateBps: borrowerRateBps!, weeks: termDays / DAYS_PER_WEEK + weeks }) - interest
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus className="size-4" aria-hidden />
        Extend
      </Button>

      <FormDialog
        action={extendLoan}
        sound="save"
        open={open}
        onOpenChange={setOpen}
        title="Extend this loan"
        description={`Due ${onDay.format(dueOn)} now. Give the borrower more time.`}
        submitLabel={ready ? 'Extend loan' : 'Not available yet'}
        pendingLabel="Extending…"
      >
        <input type="hidden" name="loanId" value={loanId} />
        <input type="hidden" name="weeks" value={validWeeks ? String(weeks) : ''} />

        {!ready ? (
          <p className="bg-status-warning/10 text-status-warning rounded-lg p-3 text-sm">
            Extending needs a one-time update to the database first. Until then nothing can be extended.
          </p>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm leading-none font-medium">How many more weeks</legend>
          <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-1.5">
            {[...PRESETS.map((w) => ({ value: String(w), label: `+${w} wk${w === 1 ? '' : 's'}` })), { value: OTHER, label: 'Other' }].map(
              (option) => (
                <label key={option.value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="weeksChoice"
                    value={option.value}
                    checked={choice === option.value}
                    onChange={() => setChoice(option.value)}
                    className="peer sr-only"
                  />
                  <span className="border-input text-muted-foreground peer-checked:bg-brand-bg peer-checked:ring-brand-line peer-checked:text-foreground peer-focus-visible:ring-ring/50 flex h-10 items-center justify-center rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors peer-checked:border-transparent peer-checked:ring-1 peer-focus-visible:ring-3 pointer-fine:h-8 sm:text-sm">
                    {option.label}
                  </span>
                </label>
              ),
            )}
          </div>
          {choice === OTHER ? (
            <div className="relative">
              <Input
                aria-label="Number of weeks"
                type="number"
                inputMode="numeric"
                min={1}
                max={52}
                value={other}
                onChange={(event) => setOther(event.target.value)}
                placeholder="6"
                className="pr-16"
                required
                autoFocus
              />
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm" aria-hidden>
                weeks
              </span>
            </div>
          ) : null}
        </fieldset>

        {!onRate ? (
          // A fixed amount has no rate to run longer: the Admin says what the
          // extra time costs, and how much of it the lenders keep.
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="extraInterest">Extra interest</Label>
              <Input id="extraInterest" name="extraInterest" inputMode="decimal" placeholder="500" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="extraLenderShare">Lenders keep</Label>
              <Input id="extraLenderShare" name="extraLenderShare" inputMode="decimal" placeholder="0" />
            </div>
          </div>
        ) : null}

        {canPayNow ? (
          <fieldset className="space-y-2">
            <legend className="text-sm leading-none font-medium">The interest so far</legend>
            <label className="has-checked:border-brand-line has-checked:bg-brand-bg flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
              <input type="radio" name="paidNow" value="" checked={!paidNow} onChange={() => setPaidNow(false)} className="mt-1" />
              <span>
                <span className="font-medium">Nothing paid now</span>
                <span className="text-muted-foreground block text-xs">
                  The extra interest is added on, and everything is paid at the end.
                </span>
              </span>
            </label>
            <label className="has-checked:border-brand-line has-checked:bg-brand-bg flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
              <input type="radio" name="paidNow" value="yes" checked={paidNow} onChange={() => setPaidNow(true)} className="mt-1" />
              <span>
                <span className="font-medium">They pay the interest now ({formatPesos(centavos(interest))})</span>
                <span className="text-muted-foreground block text-xs">
                  This loan is closed as paid for its interest, and the {formatPesos(centavos(capital))} capital carries on as a
                  new loan for the extra weeks.
                </span>
              </span>
            </label>
          </fieldset>
        ) : (
          <p className="text-muted-foreground text-xs">
            This loan collects its interest every week, so the extra weeks are added to its schedule.
          </p>
        )}

        {newDue ? (
          <div className="bg-muted/50 rounded-xl p-3 text-sm" aria-live="polite">
            <div>
              New due date <span className="font-semibold">{onDay.format(newDue)}</span>
            </div>
            {added !== null ? (
              <div className="text-muted-foreground text-xs">
                {paidNow
                  ? `They pay ${formatPesos(centavos(interest))} today; the new loan charges ${formatPesos(centavos(added))} interest.`
                  : `${formatPesos(centavos(added))} more interest, paid at the end.`}
              </div>
            ) : null}
          </div>
        ) : null}
      </FormDialog>
    </>
  )
}
