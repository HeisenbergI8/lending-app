'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'

import { ActionForm, DisclosureForm } from '@/components/forms.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { archiveLender, renameLender } from '@/server/lenders/actions.ts'

/**
 * Rename, or archive.
 *
 * Archiving is not deleting: the row and its whole history come back from the
 * Archive screen, and its loans keep pointing at it meanwhile. That is why this
 * needs no "are you sure" — there is nothing here to be sure about.
 *
 * The admin's own pot cannot be archived, and the button is absent rather than
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

  if (!renaming) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
          <Pencil className="size-4" aria-hidden />
          Rename
        </Button>
        {isSelf ? null : (
          <ActionForm action={archiveLender} values={{ lenderId }} variant="ghost" size="sm" pendingLabel="Archiving…">
            Archive
          </ActionForm>
        )}
      </div>
    )
  }

  return (
    <DisclosureForm
      action={renameLender}
      open={renaming}
      onOpenChange={setRenaming}
      openLabel="Rename"
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
    </DisclosureForm>
  )
}
