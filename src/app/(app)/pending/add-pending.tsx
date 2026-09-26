'use client'

import { useState } from 'react'

import { Avatar } from '@/components/avatar.tsx'

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
const MAX_SUGGESTIONS = 6

type BorrowerName = { id: string; firstName: string; lastName: string }

/**
 * Borrowers whose name has a word starting with what was typed. "ma" finds
 * Maria Santos and Jose Manalo. Typing both names ("maria s") narrows to the
 * people whose full name starts that way.
 */
function suggestionsFor(query: string, borrowers: BorrowerName[]): BorrowerName[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return borrowers
    .filter((b) => {
      const full = `${b.firstName} ${b.lastName}`.toLowerCase()
      return full.startsWith(q) || full.split(/\s+/).some((word) => word.startsWith(q))
    })
    .slice(0, MAX_SUGGESTIONS)
}

/**
 * A request stores a typed name, not a link to a Borrower, so picking someone
 * here only fills in the two name boxes. Converting the request later matches
 * the name back to that borrower.
 */
export function AddPendingLoan({ borrowers }: { borrowers: BorrowerName[] }) {
  const [termChoice, setTermChoice] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(0)

  const suggestions = suggestionsFor(firstName, borrowers)
  const showList = listOpen && suggestions.length > 0

  function pick(borrower: BorrowerName) {
    setFirstName(borrower.firstName)
    setLastName(borrower.lastName)
    setListOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      // Enter picks the highlighted name instead of submitting the form.
      event.preventDefault()
      pick(suggestions[active])
    } else if (event.key === 'Escape') {
      // Close the list, not the whole dialog (FormDialog leaves Escape alone
      // while this field says its list is open).
      setListOpen(false)
    }
  }

  return (
    <FormDialog
      action={createPendingLoan}
      sound="create"
      openLabel="Add request"
      title="New loan request"
      description="Someone who wants to borrow. Nothing is lent until a lender is found for it."
      submitLabel="Add request"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            required
            autoComplete="off"
            autoFocus
            role="combobox"
            aria-expanded={showList}
            aria-controls="borrower-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={showList ? `borrower-suggestion-${active}` : undefined}
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value)
              setListOpen(true)
              setActive(0)
            }}
            onFocus={() => setListOpen(true)}
            onBlur={() => setListOpen(false)}
            onKeyDown={onKeyDown}
          />
          {showList ? (
            <ul
              id="borrower-suggestions"
              role="listbox"
              aria-label="Existing borrowers"
              className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg p-1 shadow-md ring-1 ring-border sm:right-auto sm:min-w-[calc(200%+0.75rem)]"
            >
              {suggestions.map((borrower, index) => (
                <li
                  key={borrower.id}
                  id={`borrower-suggestion-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // mousedown, not click, so the pick lands before the input's blur closes the list.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(borrower)
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm pointer-fine:min-h-8 ${
                    index === active ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <Avatar name={`${borrower.firstName} ${borrower.lastName}`} />
                  <span className="truncate">
                    {borrower.firstName} {borrower.lastName}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            required
            autoComplete="off"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
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
