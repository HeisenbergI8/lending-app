'use client'

import { FormDialog } from '@/components/forms.tsx'
import { MoneyInput } from '@/components/money-input.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { recordTransaction } from '@/server/lenders/actions.ts'

/**
 * Money in, money out — "John Ross added ₱100,000 on Jan 5".
 *
 * Deposit and withdrawal are radio buttons rather than two separate forms. They
 * differ by one column, and two forms would be two places to fix the day the
 * date field changes.
 *
 * The date defaults to today but is editable, because a transaction is often
 * entered days after the cash actually moved — the same reason a loan carries
 * both a start date and a due date.
 */
export function TransactionForm({ lenderId, today }: { lenderId: string; today: string }) {
  return (
    <FormDialog
      action={recordTransaction}
      openLabel="Record money in or out"
      title="Money in or out"
      description="Cash the lender handed over, or took back. Not a loan."
      submitLabel="Record it"
    >
      <input type="hidden" name="lenderId" value={lenderId} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Direction</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'DEPOSIT', label: 'Money in', hint: 'they added cash' },
            { value: 'WITHDRAWAL', label: 'Money out', hint: 'they took cash back' },
          ].map((option, index) => (
            <label
              key={option.value}
              className="has-checked:border-foreground has-checked:bg-muted/60 flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors"
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="type"
                  value={option.value}
                  defaultChecked={index === 0}
                  className="accent-foreground size-4"
                  required
                />
                {option.label}
              </span>
              <span className="text-muted-foreground mt-1 pl-6 text-xs">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyInput name="amount" label="Amount" />
        <div className="space-y-2">
          <Label htmlFor="occurredOn">Date</Label>
          <Input id="occurredOn" name="occurredOn" type="date" defaultValue={today} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input id="note" name="note" autoComplete="off" placeholder="Initial capital" />
      </div>
    </FormDialog>
  )
}
