'use client'

import { useId, useState } from 'react'

import { BorrowerLabelBadge, type BorrowerLabelValue, TrackRecordLine } from '@/components/borrower-rating.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type TrackRecord } from '@/lib/track-record.ts'
import { cn } from '@/lib/utils'

/**
 * The name boxes on a loan request, with existing borrowers suggested as you type.
 *
 * Still two plain text boxes, and still what gets posted: a request stores a
 * typed name and never a Borrower id (see PendingLoan in the schema). Picking a
 * suggestion only fills both boxes, so a new person is typed exactly as before
 * and nothing about saving changes.
 *
 * The rating sits beside each name because the moment someone asks to borrow is
 * the moment it matters — a Bad label is worth seeing before the request is
 * taken down, not after.
 */

export type BorrowerSuggestion = {
  id: string
  firstName: string
  lastName: string
  label: BorrowerLabelValue | null
  record: TrackRecord
}

/** Few enough to read at a glance on a phone. Typing more narrows it. */
const MAX_SHOWN = 6

function normalise(text: string): string {
  return text.trim().toLowerCase()
}

/**
 * Borrowers whose name holds every word typed in either box.
 *
 * Every word, in any order, so "cruz" in the first-name box still finds Angel
 * Cruz — people start with whichever name they remember.
 */
function matching(borrowers: BorrowerSuggestion[], firstName: string, lastName: string) {
  const words = normalise(`${firstName} ${lastName}`).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  return borrowers
    .filter((borrower) => {
      const name = normalise(`${borrower.firstName} ${borrower.lastName}`)
      return words.every((word) => name.includes(word))
    })
    .slice(0, MAX_SHOWN)
}

export function BorrowerNameFields({ borrowers }: { borrowers: BorrowerSuggestion[] }) {
  const listId = useId()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const matches = matching(borrowers, firstName, lastName)
  // Once a suggestion has been picked the boxes hold exactly that name, and a
  // list offering it back again is noise.
  const picked =
    matches.length === 1 &&
    normalise(matches[0].firstName) === normalise(firstName) &&
    normalise(matches[0].lastName) === normalise(lastName)
  const showing = open && matches.length > 0 && !picked
  const activeIndex = Math.min(active, matches.length - 1)

  function pick(borrower: BorrowerSuggestion) {
    setFirstName(borrower.firstName)
    setLastName(borrower.lastName)
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((activeIndex + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((activeIndex - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      // Enter picks rather than submitting a half-typed name.
      event.preventDefault()
      pick(matches[activeIndex])
    } else if (event.key === 'Escape') {
      // Close the list, not the whole dialog.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  const comboProps = {
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': showing,
    'aria-controls': listId,
    'aria-activedescendant': showing ? `${listId}-${activeIndex}` : undefined,
    autoComplete: 'off',
    required: true,
    onKeyDown,
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  } as const

  return (
    <div className="relative">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            autoFocus
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value)
              setActive(0)
              setOpen(true)
            }}
            {...comboProps}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value)
              setActive(0)
              setOpen(true)
            }}
            {...comboProps}
          />
        </div>
      </div>

      {showing ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Existing borrowers"
          className="bg-popover text-popover-foreground ring-border absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl p-1 shadow-lg ring-1"
        >
          {matches.map((borrower, index) => (
            <li
              key={borrower.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown, not click: a click lands after the box has blurred
              // and the list has already gone.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(borrower)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2',
                index === activeIndex && 'bg-accent text-accent-foreground',
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {borrower.firstName} {borrower.lastName}
                </div>
                <TrackRecordLine record={borrower.record} className="block truncate" />
              </div>
              {borrower.label ? <BorrowerLabelBadge label={borrower.label} className="shrink-0" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
