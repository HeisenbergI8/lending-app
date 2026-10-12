'use client'

import { FormDialog } from '@/components/forms.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setStartingCapital } from '@/server/lenders/actions.ts'

/**
 * Type a new starting capital, with a note on why. Saving keeps it as a new
 * version in the history below; the old figures stay listed.
 *
 * THE FIGURE IS TYPED, and this is the only place it can be. It is not a
 * deposit: nothing moves, nothing is lent, and no other figure on any screen
 * changes when it is saved. The description says so, because a box asking for
 * pesos inside an app that records money in and money out will otherwise be
 * read as recording money in.
 *
 * Pre-filled in PESOS from the stored centavos, with no thousands separators —
 * parsePesos accepts them, but a value typed back out of this box has to
 * round-trip exactly, and "155,177.00" re-read as a default is one comma away
 * from a different number.
 *
 * Blank saves as "not set" rather than ₱0.00, which is the only way to take a
 * figure typed by mistake back off the screen.
 */
export function ChangeCapitalForm({ lenderId, current }: { lenderId: string; current: number }) {
  return (
    <FormDialog
      action={setStartingCapital}
      sound="save"
      openLabel="Change starting capital"
      title="Starting capital"
      description="Type the new figure. The old one stays in the history. Saving moves no money: Floating does not change."
      submitLabel="Save"
    >
      <input type="hidden" name="lenderId" value={lenderId} />
      <div className="space-y-2">
        <Label htmlFor="startingCapital">Amount in pesos</Label>
        <Input
          id="startingCapital"
          name="startingCapital"
          inputMode="decimal"
          defaultValue={current === 0 ? '' : (current / 100).toFixed(2)}
          placeholder="80000"
          autoFocus
        />
        <p className="text-muted-foreground text-xs">Leave it blank if you do not know what they started with.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="capitalNote">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input id="capitalNote" name="note" autoComplete="off" placeholder="Why it changed" />
      </div>
    </FormDialog>
  )
}
