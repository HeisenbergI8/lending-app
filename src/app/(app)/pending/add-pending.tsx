'use client'

import { useState } from 'react'

import { FormDialog } from '@/components/forms.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'
import { DAYS_PER_WEEK, describeTerm } from '@/lib/money/weeks.ts'
import { createPendingLoan } from '@/server/pending/actions.ts'

import { type BorrowerSuggestion, BorrowerNameFields } from './borrower-name-fields.tsx'

/**
 * Taking down a loan request.
 *
 * Only what is known before a lender is found: who asked, how much, at what
 * weekly rate, and for how long. No start date, no due date and no funding —
 * those are decisions nobody has made yet, and a form that asks for them invites
 * a guess that later reads as a fact.
 *
 * The length dropdown is the loan form's, deliberately: the same four presets
 * and the same Custom dates escape hatch, so converting a request does not mean
 * learning a second way to say "3 weeks". It is a small duplication rather than
 * a shared component, because the two post different things — a loan posts two
 * dates, and a request that nobody has dated posts a length.
 */

const WEEK_PRESETS = [1, 2, 3, 4]
const CUSTOM = 'custom'

export function AddPendingLoan({ borrowers }: { borrowers: BorrowerSuggestion[] }) {
  const [termChoice, setTermChoice] = useState('')

  return (
    <FormDialog
      action={createPendingLoan}
      openLabel="Add request"
      title="New loan request"
      description="Someone who wants to borrow. Nothing is lent until a lender is found for it."
      submitLabel="Add request"
    >
      <BorrowerNameFields borrowers={borrowers} />

      <div className="space-y-2">
        <Label htmlFor="capital">How much they want</Label>
        <div className="relative">
          <span
            className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
            aria-hidden
          >
            ₱
          </span>
          <Input
            id="capital"
            name="capital"
            inputMode="decimal"
            autoComplete="off"
            placeholder="30,000"
            className="money-column pl-7"
            required
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="termChoice">How long</Label>
          <SelectNative
            id="termChoice"
            name="termChoice"
            value={termChoice}
            onChange={(event) => setTermChoice(event.target.value)}
            required
          >
            {/* Nothing is pre-picked, and the select is required, so a length
                nobody read cannot be saved. */}
            {termChoice === '' ? <option value="">Choose a length…</option> : null}
            {WEEK_PRESETS.map((weeks) => (
              <option key={weeks} value={weeks}>
                {describeTerm(weeks * DAYS_PER_WEEK)}
              </option>
            ))}
            <option value={CUSTOM}>Custom dates</option>
          </SelectNative>
        </div>

        <div className="space-y-2">
          <Label htmlFor="borrowerRate">Rate, per week</Label>
          <div className="relative">
            <Input
              id="borrowerRate"
              name="borrowerRate"
              inputMode="decimal"
              placeholder="7"
              className="pr-7"
              autoComplete="off"
            />
            <span
              className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
              aria-hidden
            >
              %
            </span>
          </div>
          <p className="text-muted-foreground text-xs">Left blank, it is the usual 7%.</p>
        </div>
      </div>

      {termChoice === CUSTOM ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="startOn">Start date</Label>
            <Input id="startOn" name="startOn" type="date" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dueOn">Due date</Label>
            <Input id="dueOn" name="dueOn" type="date" required />
            {/* The rate is per week, so the gap has to divide by seven. The
                action refuses anything that does not and names the two dates
                either side of it. */}
            <p className="text-muted-foreground text-xs">Must be a whole number of weeks apart.</p>
          </div>
        </div>
      ) : null}
    </FormDialog>
  )
}
