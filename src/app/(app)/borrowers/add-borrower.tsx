'use client'

import { FormDialog } from '@/components/forms.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createBorrower } from '@/server/borrowers/actions.ts'

/**
 * A borrower is a first and last name. Nothing else is stored about them — no
 * phone, no address, no photo. The value of the record is the track record the
 * app counts, and that needs no personal details to build.
 */
export function AddBorrower() {
  return (
    <FormDialog
      action={createBorrower}
      sound="create"
      openLabel="Add borrower"
      title="New borrower"
      description="Name only. Their track record builds itself from their loans."
      submitLabel="Add borrower"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required autoComplete="off" autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" required autoComplete="off" />
        </div>
      </div>
    </FormDialog>
  )
}
