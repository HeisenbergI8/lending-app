'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'

export type Option = { key: string; label: string }

/** Choosing a lender reloads the page for them, keeping every other filter. */
export function LenderPicker({
  lenders,
  value,
  hrefFor,
}: {
  lenders: { id: string; name: string }[]
  value: string
  /** The page's URL for each choice, built on the server so it keeps the other filters. */
  hrefFor: Record<string, string>
}) {
  const router = useRouter()
  return (
    <SelectNative
      aria-label="Lender"
      value={value}
      onChange={(event) => router.push(hrefFor[event.target.value] ?? '/money')}
      className="h-11 min-w-0 flex-1 rounded-xl font-medium"
    >
      <option value="">All lenders</option>
      {lenders.map((lender) => (
        <option key={lender.id} value={lender.id}>
          {lender.name}
        </option>
      ))}
    </SelectNative>
  )
}

const chip =
  'border-border text-muted-foreground peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-ring/50 inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3.5 text-sm transition-colors peer-focus-visible:ring-3'

/**
 * Search, type and dates, in a dialog behind one button so the page itself stays
 * one row of controls. A plain GET form: applying it is just loading the page
 * with those values in the URL.
 */
export function FiltersButton({
  lender,
  q,
  type,
  types,
  when,
  whens,
  from,
  to,
  activeCount,
}: {
  lender: string
  q: string
  type: string
  types: Option[]
  when: string
  whens: Option[]
  from: string
  to: string
  /** How many filters are on, shown on the button so a filtered list is never mistaken for everything. */
  activeCount: number
}) {
  const [pickedWhen, setPickedWhen] = useState(when)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 shrink-0 rounded-xl">
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
          {activeCount > 0 ? (
            <span className="bg-foreground text-background ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-xs">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Filters</DialogTitle>
        <DialogDescription>Narrow the list down. The totals follow.</DialogDescription>

        <form action="/money" method="get" className="mt-4 space-y-5">
          {lender ? <input type="hidden" name="lender" value={lender} /> : null}

          <div className="space-y-2">
            <Label htmlFor="money-q">Search</Label>
            <Input id="money-q" name="q" defaultValue={q} placeholder="Borrower name or amount" autoComplete="off" />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            <div className="flex flex-wrap gap-2">
              {types.map((option) => (
                <label key={option.key}>
                  <input
                    type="radio"
                    name="show"
                    value={option.key}
                    defaultChecked={type === option.key}
                    className="peer sr-only"
                  />
                  <span className={chip}>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">When</legend>
            <div className="flex flex-wrap gap-2">
              {whens.map((option) => (
                <label key={option.key}>
                  <input
                    type="radio"
                    name="when"
                    value={option.key}
                    checked={pickedWhen === option.key}
                    onChange={() => setPickedWhen(option.key)}
                    className="peer sr-only"
                  />
                  <span className={chip}>{option.label}</span>
                </label>
              ))}
            </div>
            {pickedWhen === 'range' ? (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="money-from">From</Label>
                  <Input id="money-from" name="from" type="date" defaultValue={from} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="money-to">To</Label>
                  <Input id="money-to" name="to" type="date" defaultValue={to} required />
                </div>
              </div>
            ) : null}
          </fieldset>

          <div className="flex gap-2">
            <Button asChild variant="outline" className="h-11 flex-1">
              <Link href={lender ? `/money?lender=${lender}` : '/money'}>Clear</Link>
            </Button>
            <Button type="submit" className="h-11 flex-[2]">
              Show results
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
