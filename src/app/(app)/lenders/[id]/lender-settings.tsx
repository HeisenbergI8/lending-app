'use client'

import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

import { ActionForm, FormDialog } from '@/components/forms.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteLender, renameLender } from '@/server/lenders/actions.ts'

/**
 * Rename, or delete.
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
}: {
  lenderId: string
  firstName: string
  lastName: string
  isSelf: boolean
}) {
  const [renaming, setRenaming] = useState(false)

  // The buttons stay put while the dialog is open. Swapping them out for the
  // form was what put the form in the page header in the first place.
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
        <Pencil className="size-4" aria-hidden />
        Rename
      </Button>

      {isSelf ? null : (
        <ActionForm
          action={deleteLender}
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

      <FormDialog
        action={renameLender}
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
