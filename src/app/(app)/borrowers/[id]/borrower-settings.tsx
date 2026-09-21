'use client'

import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

import { type BorrowerLabelValue } from '@/components/borrower-rating.tsx'
import { ActionForm, FormDialog } from '@/components/forms.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteBorrower, renameBorrower, setBorrowerLabel } from '@/server/borrowers/actions.ts'

/**
 * The admin's own Good / Okay / Bad, and the housekeeping.
 *
 * The label is a judgement, which is why it is the one thing about a borrower
 * that IS stored — the counted record beside it is arithmetic and is recomputed
 * on every read. Tapping the label already set clears it, so "I no longer have
 * an opinion" is reachable without a fourth button that reads like a fourth
 * rating.
 */

const CHOICES: { value: BorrowerLabelValue; label: string }[] = [
  { value: 'GOOD', label: 'Good' },
  { value: 'OKAY', label: 'Okay' },
  { value: 'BAD', label: 'Bad' },
]

export function LabelPicker({
  borrowerId,
  current,
}: {
  borrowerId: string
  current: BorrowerLabelValue | null
}) {
  return (
    <div className="bg-card rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <h2 className="text-base font-semibold tracking-tight">Admin rating</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">
        The Admin’s own call, on top of the counted record. It blocks nothing.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {CHOICES.map((choice) => {
          const selected = current === choice.value
          return (
            <ActionForm
              key={choice.value}
              action={setBorrowerLabel}
              // Tapping the current rating clears it: the posted value is empty,
              // which the action treats as "no opinion" rather than as invalid.
              values={{ borrowerId, label: selected ? '' : choice.value }}
              variant={selected ? 'default' : 'outline'}
              size="sm"
            >
              {choice.label}
            </ActionForm>
          )
        })}
      </div>
    </div>
  )
}

export function BorrowerSettings({
  borrowerId,
  firstName,
  lastName,
}: {
  borrowerId: string
  firstName: string
  lastName: string
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

      <ActionForm
        action={deleteBorrower}
        values={{ borrowerId }}
        variant="destructive"
        size="sm"
        pendingLabel="Deleting…"
        confirm={{
          title: 'Delete this borrower?',
          body: 'They move to Recently Deleted with their whole loan history, and can be restored for thirty days.',
          action: 'Delete borrower',
        }}
      >
        <Trash2 className="size-4" aria-hidden />
        Delete
      </ActionForm>

      <FormDialog
        action={renameBorrower}
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename borrower"
        description="Their loans and history stay exactly where they are."
        submitLabel="Save name"
      >
        <input type="hidden" name="borrowerId" value={borrowerId} />
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
