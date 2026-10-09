'use client'

import { useState } from 'react'

import Link from 'next/link'

import { FormDialog } from '@/components/forms.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'
import { DAYS_PER_WEEK, describeTerm } from '@/lib/money/weeks.ts'
import { createPendingLoan } from '@/server/pending/actions.ts'

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
/** Any number of weeks, typed, with no dates — see readTerm in server/pending/actions.ts. */
const WEEKS = 'weeks'
type BorrowerName = { id: string; firstName: string; lastName: string }

/**
 * WHO IS ASKING is picked from the Borrowers list, never typed (2026-10-09, the
 * Admin's call). A typed name could be a stranger, a misspelling or a second
 * "Angel Dela Cruz", and converting the request to a loan matches by name. The
 * request still stores the name it was given — the server copies it from the
 * borrower chosen — so the requests list and conversion work as before.
 * Someone new is added on the Borrowers screen first.
 */
export function AddPendingLoan({ borrowers }: { borrowers: BorrowerName[] }) {
  const [termChoice, setTermChoice] = useState('')

  return (
    <FormDialog
      action={createPendingLoan}
      sound="create"
      openLabel="Add request"
      title="New loan request"
      description="Someone who wants to borrow. Nothing is lent until a lender is found for it."
      submitLabel="Add request"
    >
      <div className="space-y-2">
        <Label htmlFor="borrowerId">Borrower</Label>
        <SelectNative id="borrowerId" name="borrowerId" defaultValue="" required autoFocus>
          {/* Nothing pre-picked and required, so a request cannot be filed
              under whoever happened to be first in the list. */}
          <option value="" disabled>
            Choose a borrower…
          </option>
          {borrowers.map((borrower) => (
            <option key={borrower.id} value={borrower.id}>
              {borrower.firstName} {borrower.lastName}
            </option>
          ))}
        </SelectNative>
        <p className="text-muted-foreground text-xs">
          {borrowers.length === 0 ? (
            <>
              No borrowers yet.{' '}
              <Link href="/borrowers" className="text-brand font-medium">
                Add one in Borrowers
              </Link>{' '}
              first.
            </>
          ) : (
            <>
              Someone new?{' '}
              <Link href="/borrowers" className="text-brand font-medium">
                Add them in Borrowers
              </Link>{' '}
              first.
            </>
          )}
        </p>
      </div>

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
            <option value={WEEKS}>Other number of weeks</option>
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

      {termChoice === WEEKS ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="weeks">Number of weeks</Label>
            <div className="relative">
              <Input
                id="weeks"
                name="weeks"
                type="number"
                inputMode="numeric"
                min={1}
                max={52}
                step={1}
                placeholder="6"
                className="pr-16"
                required
                autoFocus
              />
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm" aria-hidden>
                weeks
              </span>
            </div>
            <p className="text-muted-foreground text-xs">No dates needed yet. They are set when the loan is recorded.</p>
          </div>
        </div>
      ) : null}

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
