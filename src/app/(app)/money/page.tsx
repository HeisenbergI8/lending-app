import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, HandCoins } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { HISTORY_FILTERS, filterHistory, parseHistoryFilter } from '@/lib/money/history-filter.ts'
import { addDays, calendarDate, parseCalendarDate } from '@/lib/money/weeks.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { type LenderMoneyEvent, allMoneyHistory } from '@/server/lenders/queries.ts'

import { FiltersButton, LenderPicker } from './controls.tsx'

export const metadata = { title: 'Money history' }

/** Rows shown at first, and added by each "Show more". Short on purpose: a phone screen's worth. */
const STEP = 8

const WHENS = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'last', label: 'Last month' },
  { key: '90', label: 'Last 90 days' },
  { key: 'range', label: 'Pick dates' },
]

const dayHeading = new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

/** The days the "When" choice covers, both ends included, as calendar dates at midday. Null is all time. */
function period(when: string, fromRaw: string, toRaw: string): { from: Date; to: Date } | null {
  const today = calendarDate(new Date())
  if (when === 'month') return { from: calendarDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: today }
  if (when === 'last') {
    return {
      from: calendarDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: calendarDate(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
  }
  if (when === '90') return { from: addDays(today, -89), to: today }
  if (when === 'range') {
    const from = parseCalendarDate(fromRaw)
    const to = parseCalendarDate(toRaw)
    if (from && to) return from <= to ? { from, to } : { from: to, to: from }
  }
  return null
}

/** Borrower or lender name, a word of the line, or the amount ("8000" or "8,000"). */
function matches(event: LenderMoneyEvent, q: string): boolean {
  const needle = q.toLowerCase()
  const text = `${event.title} ${event.detail ?? ''} ${event.lender.name}`.toLowerCase()
  if (text.includes(needle)) return true
  const digits = q.replace(/[^\d.]/g, '')
  return digits !== '' && String(Math.abs(event.amount) / 100).includes(digits)
}

/**
 * MONEY HISTORY — every move of every lender's money on one screen (owner,
 * 2026-10-24). Read-only: it lists, it does not edit. A line opens its loan, or
 * the lender's page for a plain money in or out, where editing lives.
 *
 * The lines are each lender page's own Money history, merged (allMoneyHistory),
 * so the two screens can never disagree. Filters live in the URL: lender, type
 * (`show`, the same keys as the lender page's filter), when, and search. "Money
 * in" and "Money out" add up every line the filters keep, not just the ones on
 * screen.
 */
export default async function MoneyHistoryPage({ searchParams }: PageProps<'/money'>) {
  const user = await requireUser()
  const query = await searchParams

  const lenderId = one(query.lender)
  const type = parseHistoryFilter(one(query.show))
  const when = WHENS.some((option) => option.key === one(query.when)) ? one(query.when) : 'all'
  const fromRaw = one(query.from)
  const toRaw = one(query.to)
  const q = one(query.q).trim()
  const count = Math.max(STEP, Math.min(10_000, Number.parseInt(one(query.n), 10) || STEP))

  const { events, lenders } = await allMoneyHistory(user.id)
  const range = period(when, fromRaw, toRaw)

  const kept = filterHistory(
    events.filter(
      (event) =>
        (!lenderId || event.lender.id === lenderId) &&
        (!range || (event.on >= range.from && event.on <= range.to)) &&
        (!q || matches(event, q)),
    ),
    type,
  )
  const moneyIn = kept.reduce((total, event) => total + Math.max(0, event.amount), 0)
  const moneyOut = kept.reduce((total, event) => total + Math.max(0, -event.amount), 0)
  const shown = kept.slice(0, count)

  const days = new Map<string, LenderMoneyEvent[]>()
  for (const event of shown) {
    const day = dayHeading.format(event.on)
    days.set(day, [...(days.get(day) ?? []), event])
  }

  /** This page with some parameters changed and the rest kept. */
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams()
    for (const [name, value] of Object.entries(query)) {
      const first = one(value)
      if (first) next.set(name, first)
    }
    for (const [name, value] of Object.entries(patch)) {
      if (value) next.set(name, value)
      else next.delete(name)
    }
    const search = next.toString()
    return `/money${search ? `?${search}` : ''}`
  }

  const activeCount = (type ? 1 : 0) + (range ? 1 : 0) + (q ? 1 : 0)
  const summary = [
    type ? HISTORY_FILTERS.find((option) => option.key === type)?.label : null,
    range ? WHENS.find((option) => option.key === when)?.label : null,
    q ? `“${q}”` : null,
  ].filter(Boolean)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Money history</h1>
        <p className="text-muted-foreground text-sm">Every peso in and out, across all lenders.</p>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <LenderPicker
            lenders={lenders}
            value={lenderId}
            hrefFor={Object.fromEntries(
              [{ id: '' }, ...lenders].map((lender) => [lender.id, href({ lender: lender.id || null, n: null })]),
            )}
          />
          <FiltersButton
            lender={lenderId}
            q={q}
            type={type ?? 'all'}
            types={[{ key: 'all', label: 'All' }, ...HISTORY_FILTERS.map(({ key, label }) => ({ key, label }))]}
            when={when}
            whens={WHENS}
            from={fromRaw}
            to={toRaw}
            activeCount={activeCount}
          />
        </div>
        {summary.length > 0 ? (
          <p className="text-muted-foreground px-1 text-xs">
            {summary.join(' · ')} ·{' '}
            <Link href={lenderId ? `/money?lender=${lenderId}` : '/money'} className="text-brand font-medium">
              Clear filters
            </Link>
          </p>
        ) : null}
      </div>

      {/* SUMMED OVER EVERY LINE THE FILTERS KEEP, not the page. Money in is
          deposits, repayments, weekly interest and the Admin cut; money out is
          withdrawals and loans made — the signed amounts of the lines below. */}
      <div className="bg-card ring-border/70 shadow-rest divide-border/70 grid grid-cols-2 divide-x rounded-2xl ring-1">
        <div className="p-3 sm:p-4">
          <div className="text-muted-foreground text-xs">Money in</div>
          <Money amount={centavos(moneyIn)} variant="display" className="text-status-good text-base font-semibold sm:text-lg" />
        </div>
        <div className="p-3 sm:p-4">
          <div className="text-muted-foreground text-xs">Money out</div>
          <Money amount={centavos(moneyOut)} variant="display" className="text-base font-semibold sm:text-lg" />
        </div>
      </div>

      {kept.length === 0 ? (
        <div className="bg-card/60 border-border rounded-2xl border border-dashed p-8 text-center">
          <HandCoins className="text-muted-foreground mx-auto size-6" aria-hidden />
          <p className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm">
            {events.length === 0 ? 'No money has moved yet.' : 'Nothing matches these filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...days].map(([day, rows]) => (
            <section key={day} className="space-y-1.5">
              <h2 className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">{day}</h2>
              <ul className="bg-card divide-border/70 shadow-rest ring-border/70 divide-y overflow-hidden rounded-2xl ring-1">
                {rows.map((event) => {
                  const incoming = event.amount >= 0
                  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
                  return (
                    <li key={`${event.lender.id}-${event.key}`}>
                      <Link
                        href={event.loanId ? `/loans/${event.loanId}` : `/lenders/${event.lender.id}`}
                        className="hover:bg-muted/40 flex items-center gap-3 px-3 py-2.5 transition-colors"
                      >
                        <span
                          className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                            incoming ? 'bg-status-good-bg text-status-good' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{event.title}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            {event.lender.name}
                            {/* The second line of the lender page, on wide screens only. */}
                            {event.detail ? <span className="hidden sm:inline"> · {event.detail}</span> : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <Money
                            amount={event.amount}
                            variant="display"
                            className={`text-sm font-semibold ${incoming ? 'text-status-good' : ''}`}
                          />
                          {/* THAT LENDER'S floating after this move, as on their own
                              page — never a total across lenders. Wide screens only. */}
                          <span className="text-muted-foreground hidden text-xs sm:block">
                            their floating <Money amount={event.balance} variant="display" />
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {kept.length > 0 ? (
        <div className="space-y-2 text-center">
          {kept.length > shown.length ? (
            <Link
              href={href({ n: String(count + STEP) })}
              scroll={false}
              className="bg-card ring-border/70 shadow-rest hover:bg-muted/40 inline-flex h-11 items-center rounded-xl px-5 text-sm font-medium ring-1"
            >
              Show {Math.min(STEP, kept.length - shown.length)} more
            </Link>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Showing {shown.length} of {kept.length}
          </p>
        </div>
      ) : null}
    </div>
  )
}
