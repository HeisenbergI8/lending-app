'use client'

import { FormDialog } from '@/components/forms.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createLender } from '@/server/lenders/actions.ts'

/**
 * A lender is a first and last name. That is the whole record — no phone, no
 * address, by decision in the spec.
 */
export function AddLender() {
  return (
    <FormDialog
      action={createLender}
      sound="create"
      openLabel="Add lender"
      title="New lender"
      description="Name only. Record their money in once they are added."
      submitLabel="Add lender"
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
