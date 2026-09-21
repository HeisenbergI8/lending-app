import Link from 'next/link'
import { Search, X } from 'lucide-react'

import { type LoanFilter, type LoanStatusFilter, isFiltered, loanFilterHref } from '@/lib/loan-filter.ts'
import { toDateInput } from '@/lib/money/weeks.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Finding a loan.
 *
 * A plain GET form, not a server action and not a client component: the browser
 * turns the fields into the query string by itself, so the search works with no
 * JavaScript, the result is a link you can keep, and this file stays out of the
 * browser bundle entirely.
 *
 * The status chips are links rather than radio buttons for the same reason —
 * one tap, no submit, and tapping the chip that is already on clears it.
 */

const CHIPS: { value: LoanStatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
]

export function LoanSearch({ filter }: { filter: LoanFilter }) {
  return (
    // The search and the chips live on ONE surface. Loose on the page they read
    // as four unrelated controls floating above the list — the clutter was the
    // lack of a container, not the number of fields.
    <div className="bg-card ring-border/70 shadow-rest space-y-3 rounded-2xl p-3 ring-1 sm:p-4">
      <form method="get" action="/loans" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {/* The status chips live outside the form, so their value has to ride
            along or submitting the box would silently drop the chip. */}
        {filter.status ? <input type="hidden" name="status" value={filter.status} /> : null}

        <div className="flex-1 space-y-1">
          <Label htmlFor="q" className="text-muted-foreground text-xs">
            Search
          </Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={filter.query}
              maxLength={80}
              placeholder="Name or amount"
              className="pl-7"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="from" className="text-muted-foreground text-xs">
              Due from
            </Label>
            <Input
              id="from"
              name="from"
              type="date"
              defaultValue={filter.from ? toDateInput(filter.from) : ''}
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="to" className="text-muted-foreground text-xs">
              Due to
            </Label>
            <Input id="to" name="to" type="date" defaultValue={filter.to ? toDateInput(filter.to) : ''} />
          </div>
        </div>

        <Button type="submit" variant="secondary" className="sm:w-auto">
          Search
        </Button>
      </form>

      <div className="border-border/70 flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-muted-foreground mr-0.5 text-xs font-medium">Show</span>
        {CHIPS.map((chip) => {
          const on = filter.status === chip.value
          return (
            <Link
              key={chip.value}
              href={loanFilterHref(filter, { status: on ? null : chip.value })}
              aria-pressed={on}
              className={cn(
                // py-2 on a touch device: at py-1 these chips were 26px tall,
                // and they are the fastest way to filter the list, so they are
                // the last thing that should need an accurate tap.
                'inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium transition-colors pointer-fine:min-h-0 pointer-fine:py-1',
                on
                  ? 'bg-brand text-brand-foreground border-brand shadow-rest'
                  : 'border-border hover:bg-muted hover:border-brand-line',
              )}
            >
              {chip.label}
            </Link>
          )
        })}

        {isFiltered(filter) ? (
          <Link
            href="/loans"
            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1 px-2 text-xs pointer-fine:min-h-0 pointer-fine:px-1"
          >
            <X className="size-3" aria-hidden />
            Clear
          </Link>
        ) : null}
      </div>
    </div>
  )
}
