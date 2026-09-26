'use client'

import { useState } from 'react'
import { Landmark, Pencil, Trash2 } from 'lucide-react'

import { ActionForm, FormDialog } from '@/components/forms.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteLender, renameLender, setStartingCapital } from '@/server/lenders/actions.ts'

/**
 * Rename, set the starting capital, or delete.
 *
 * Deleting is reversible for thirty days: the row and its whole history sit in
 * Recently Deleted, and its loans keep pointing at it meanwhile. That is why
 * this needs no "are you sure" — there is a month to change your mind.
 *
 * The admin's own pot cannot be deleted, and the button is absent rather than
 * disabled: a disabled control asks the reader to work out why. The server
 * refuses it as well, because a hidden button is a suggestion, not a rule.
 */
export function LenderSettings({
  lenderId,
  firstName,
  lastName,
  isSelf,
  startingCapital,
}: {
  lenderId: string
  firstName: string
  lastName: string
  isSelf: boolean
  /** Centavos, 0 when the Admin has not said. Shown in the box as pesos. */
  startingCapital: number
}) {
  const [renaming, setRenaming] = useState(false)
  const [capital, setCapital] = useState(false)

  // The buttons stay put while the dialog is open. Swapping them out for the
  // form was what put the form in the page header in the first place.
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
        <Pencil className="size-4" aria-hidden />
        Rename
      </Button>

      <Button variant="ghost" size="sm" onClick={() => setCapital(true)}>
        <Landmark className="size-4" aria-hidden />
        Starting capital
      </Button>

      {isSelf ? null : (
        <ActionForm
          action={deleteLender}
          sound="trash"
          values={{ lenderId }}
          variant="destructive"
          size="sm"
          pendingLabel="Deleting…"
          confirm={{
            title: 'Delete this lender?',
            body: 'They move to Recently Deleted with their money in and out, and can be restored for thirty days. Loans they funded keep pointing at them meanwhile.',
            action: 'Delete lender',
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          Delete
        </ActionForm>
      )}

      {/* THE FIGURE IS TYPED, and this is the only place it can be. It is not a
          deposit: nothing moves, nothing is lent, and no other figure on any
          screen changes when it is saved. The description says so, because a box
          asking for pesos inside an app that records money in and money out will
          otherwise be read as recording money in.

          Pre-filled in PESOS from the stored centavos, with no thousands
          separators — parsePesos accepts them, but a value typed back out of this
          box has to round-trip exactly, and "155,177.00" re-read as a default is
          one comma away from a different number.

          Blank saves as "not set" rather than ₱0.00, which is the only way to
          take a figure typed by mistake back off the screen. */}
      <FormDialog
        action={setStartingCapital}
        sound="save"
        open={capital}
        onOpenChange={setCapital}
        title="Starting capital"
        description="What this person put in to start, before any interest. The Admin types it; the app never works it out. Saving it moves no money and changes no other figure."
        submitLabel="Save starting capital"
      >
        <input type="hidden" name="lenderId" value={lenderId} />
        <div className="space-y-2">
          <Label htmlFor="startingCapital">Amount in pesos</Label>
          <Input
            id="startingCapital"
            name="startingCapital"
            inputMode="decimal"
            defaultValue={startingCapital === 0 ? '' : (startingCapital / 100).toFixed(2)}
            placeholder="80000"
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            Raise it when this person hands over fresh money from outside the lending. Leave it blank
            if the Admin does not know what they started with.
          </p>
        </div>
      </FormDialog>

      <FormDialog
        action={renameLender}
        sound="save"
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename lender"
        description="Their loans and history stay exactly where they are."
        submitLabel="Save name"
      >
        <input type="hidden" name="lenderId" value={lenderId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" defaultValue={firstName} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" defaultValue={lastName} required />
          </div>
        </div>
      </FormDialog>
    </div>
  )
}
