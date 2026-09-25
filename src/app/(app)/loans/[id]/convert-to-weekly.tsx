'use client'

import { useActionState, useState } from 'react'
import { CalendarClock } from 'lucide-react'

import { SubmitButton } from '@/components/forms.tsx'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NO_ERROR } from '@/lib/form-state.ts'
import { convertToWeekly } from '@/server/loans/convert.ts'

/**
 * Switching a loan already in the app to weekly collection.
 *
 * BEHIND A DISCLOSURE, because it is rare and it moves money onto four other
 * screens at once. A loan is created weekly from the form; this is the one-off
 * for one that was not.
 *
 * NOTHING ABOUT THE MONEY CHANGES and the copy says so first. The capital, the
 * rate, the dates and the total are all untouched — the Admin is telling the app
 * how the interest is being collected, not repricing anything.
 *
 * TICKING A WEEK NEEDS ITS DATE. The date is the only thing this flow records
 * that is not already in the database, so the server refuses a ticked week
 * without one rather than guessing.
 */

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

export function ConvertToWeekly({
  loanId,
  weeks,
  weeklyAmount,
  capitalDueOn,
  weekDates,
}: {
  loanId: string
  weeks: number
  /** What one week comes to, in pesos, already formatted. */
  weeklyAmount: string
  capitalDueOn: Date
  /** Every week's due date, so a ticked row can say which week it is. */
  weekDates: Date[]
}) {
  const [open, setOpen] = useState(false)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [state, formAction] = useActionState(convertToWeekly, NO_ERROR)

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="size-4" aria-hidden />
        Collect this interest weekly
      </Button>
    )
  }

  const toggle = (week: number) => {
    const next = new Set(ticked)
    if (next.has(week)) next.delete(week)
    else next.add(week)
    setTicked(next)
  }

  return (
    <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Collect this interest weekly</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          The capital and the total do not change. The Admin collects {weeklyAmount} a week for{' '}
          {weeks} weeks, and the capital comes back on {dateFormat.format(capitalDueOn)} with the last
          week. Tick the weeks that have already been paid and give each one its date.
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="loanId" value={loanId} />

        <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {/* The FINAL week is not offered: it is handed over with the capital,
              and a loan whose capital has come back is paid rather than being
              converted. The server refuses it too. */}
          {weekDates.slice(0, -1).map((dueOn, index) => {
            const week = index + 1
            return (
              <li key={week} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id={`week-${week}`}
                  name={`week-${week}`}
                  checked={ticked.has(week)}
                  onChange={() => toggle(week)}
                  className="border-input text-brand-strong size-4 rounded"
                />
                <label htmlFor={`week-${week}`} className="min-w-28">
                  Week {week}
                  <span className="text-muted-foreground block text-xs">
                    due {dateFormat.format(dueOn)}
                  </span>
                </label>
                <Input
                  type="date"
                  name={`week-${week}-paidOn`}
                  aria-label={`Date week ${week} was paid`}
                  disabled={!ticked.has(week)}
                  required={ticked.has(week)}
                  className="max-w-40"
                />
              </li>
            )
          })}
        </ul>

        {state.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingLabel="Switching…" className="w-full sm:w-auto">
            Collect weekly from now on
          </SubmitButton>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>

        <p className="text-muted-foreground text-xs">
          {ticked.size === 0
            ? 'No weeks ticked. Every week will show as still to collect.'
            : `${ticked.size} ${ticked.size === 1 ? 'week' : 'weeks'} ticked, ${weeklyAmount} each.`}
        </p>
      </form>
    </section>
  )
}
