'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import { ActionForm, FormDialog } from '@/components/forms.tsx'
import { MoneyInput } from '@/components/money-input.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type Centavos, formatPesos } from '@/lib/money/centavos.ts'
import { storedCalendarDate, toDateInput } from '@/lib/money/weeks.ts'
import { deleteTransaction, recordTransaction, updateTransaction } from '@/server/lenders/actions.ts'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/** Centavos back into the plain "30000.00" the admin typed in the first place. */
function pesosForInput(value: Centavos): string {
  return (value / 100).toFixed(2)
}

/**
 * The four things a movement is: which way, how much, when, and what for.
 *
 * ONE SET OF FIELDS, TWO FORMS. Recording a movement and correcting one later
 * ask the admin exactly the same questions, and a second copy of them would
 * stay identical only until the day one form gained a field. The dialog around
 * them is what differs, not the questions.
 */
function TransactionFields({
  type,
  amount,
  occurredOn,
  note,
  advance,
}: {
  type: 'DEPOSIT' | 'WITHDRAWAL'
  amount?: Centavos
  occurredOn: string
  note?: string | null
  /**
   * This row is money drawn against a named loan.
   *
   * The direction is then not a choice: an advance is money out by definition,
   * and offering "Money in" here would let the admin turn a drawing against a
   * loan into a deposit that still points at it. The server ignores the field
   * on these rows as well, because a hidden control is a suggestion.
   */
  advance?: boolean
}) {
  return (
    <>
      {advance ? (
        <input type="hidden" name="type" value="WITHDRAWAL" />
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Direction</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'DEPOSIT', label: 'Money in', hint: 'they added cash' },
              { value: 'WITHDRAWAL', label: 'Money out', hint: 'they took cash back' },
            ].map((option) => (
              <label
                key={option.value}
                className="has-checked:border-foreground has-checked:bg-muted/60 flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors"
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="type"
                    value={option.value}
                    defaultChecked={option.value === type}
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
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyInput
          name="amount"
          label="Amount"
          defaultValue={amount === undefined ? undefined : pesosForInput(amount)}
        />
        <div className="space-y-2">
          <Label htmlFor="occurredOn">Date</Label>
          <Input id="occurredOn" name="occurredOn" type="date" defaultValue={occurredOn} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="note"
          name="note"
          autoComplete="off"
          placeholder="Initial capital"
          defaultValue={note ?? undefined}
        />
      </div>
    </>
  )
}

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
      sound={(form) => (form.get('type') === 'WITHDRAWAL' ? 'cashOut' : 'cashIn')}
      openLabel="Record money in or out"
      title="Money in or out"
      description="Cash the lender handed over, or took back. Not a loan."
      submitLabel="Record it"
    >
      <input type="hidden" name="lenderId" value={lenderId} />
      <TransactionFields type="DEPOSIT" occurredOn={today} />
    </FormDialog>
  )
}

/**
 * Correcting a movement already recorded.
 *
 * THE WHOLE ROW IS THE BUTTON. A pencil and a bin on every row turned a list of
 * money into a control panel, and the figures are what the admin came to read.
 * So the trigger is an invisible layer over the row, the list shows nothing but
 * its data, and the one destructive control moves inside this dialog where it
 * takes a deliberate second press.
 *
 * It covers the row rather than wrapping it because a row can contain a link of
 * its own — an advance names its loan — and a link inside a button is markup a
 * browser will quietly rearrange. The layer is positioned, the link is lifted
 * above it, and both stay real controls.
 *
 * BOTH FIGURES ARE ON SCREEN WHILE THE ADMIN TYPES. The amount is what moves
 * this pot, so the dialog says what the row said before the cursor touched it:
 * a slip that turns ₱1,450 into ₱14,500 is invisible in a field that arrived
 * pre-filled, and the pot moves by the difference the moment it is saved.
 */
export function EditTransaction({
  entry,
}: {
  entry: {
    id: string
    type: 'DEPOSIT' | 'WITHDRAWAL'
    amount: Centavos
    occurredOn: Date
    note: string | null
    advance: boolean
  }
}) {
  const [open, setOpen] = useState(false)
  const was = `${formatPesos(entry.amount)} on ${dateFormat.format(entry.occurredOn)}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-visible:ring-ring/60 absolute inset-0 focus-visible:ring-2 focus-visible:outline-none"
      >
        {/* The row itself is silent to a screen reader — it is a figure and a
            date, read in order. This is the only thing announcing what pressing
            here does, so it names the entry rather than saying "Edit". */}
        <span className="sr-only">Edit this entry: {was}</span>
      </button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        action={updateTransaction}
        sound="save"
        title="Edit entry"
        description={
          entry.advance
            ? 'Money drawn against a loan. It stays money out, and it stays on that loan.'
            : 'Cash the lender handed over, or took back. Not a loan.'
        }
        submitLabel="Save changes"
        aside={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              Entered by mistake rather than typed wrong?
            </p>
            <ActionForm
              action={deleteTransaction}
              sound="trash"
              values={{ transactionId: entry.id }}
              variant="destructive"
              size="sm"
              pendingLabel="Deleting…"
              onDone={() => setOpen(false)}
              confirm={{
                title: 'Delete this entry?',
                body: "It moves to Recently Deleted and can be restored for thirty days. The lender's balance changes right away.",
                action: 'Delete entry',
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete entry
            </ActionForm>
          </div>
        }
      >
        <input type="hidden" name="transactionId" value={entry.id} />
        <TransactionFields
          type={entry.type}
          amount={entry.amount}
          occurredOn={toDateInput(storedCalendarDate(entry.occurredOn))}
          note={entry.note}
          advance={entry.advance}
        />

        {/* `entry.amount` is the stored amountCentavos of this row, the same
            figure the list prints beside it. Floating is derived on every read
            from deposits minus withdrawals minus principal still out, so a
            saved change reaches it immediately — there is no stored balance
            anywhere that could keep the old figure. */}
        <p className="text-muted-foreground text-xs">
          Was {was}. A different amount moves this pot&rsquo;s Floating by the difference as soon as
          it is saved.
        </p>
      </FormDialog>
    </>
  )
}
