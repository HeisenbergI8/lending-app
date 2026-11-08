import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { DEFAULT_RANGE, HISTORY_MONTHS, RANGES, type Whose, historyWindowStart, rangeLabel, simpleForecast } from '@/lib/money/simple-forecast.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { projectionContext, simpleInput } from '@/server/projections/queries.ts'

import { MonthlyBars } from './monthly-bars.tsx'

export const metadata = { title: 'Projections' }

const monthName = (d: Date) => d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

/**
 * PROJECTIONS, KEPT SIMPLE (owner, 2026-11-08): pick whose money and how far
 * ahead; nothing to fill in. Every figure is an ESTIMATE from
 * lib/money/simple-forecast.ts, read from the real loan history:
 *
 *   interest a month   the larger of what running loans pay that month and the
 *                      usual interest a month of the last 6 months' new lending
 *   pot                today's capital (floating + out on loan) plus the
 *                      interest counted so far — no deposits or withdrawals
 *
 * A lender's view is their own earnings only; the Admin's is its own earnings
 * plus the Admin cut; the whole pot is everything.
 */
export default async function ProjectionsPage({ searchParams }: PageProps<'/projections'>) {
  const user = await requireUser()
  const q = await searchParams
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined)

  const ctx = await projectionContext(user.id)
  const range = RANGES.find((r) => String(r) === one('range')) ?? DEFAULT_RANGE
  const admin = ctx.lenders.find((l) => l.isSelf)
  const lenderId = one('view') === 'admin' ? admin?.id : one('view') === 'lender' ? one('lender') : undefined
  const picked = lenderId ? ctx.lenders.find((l) => l.id === lenderId) : undefined
  const whose: Whose = picked ? { kind: 'lender', lenderId: picked.id } : { kind: 'pot' }
  const f = simpleForecast(simpleInput(ctx, range), whose, ctx.newLoans)

  const last = f.months.at(-1)
  const perMonth = centavos(Math.round(f.total / f.months.length))
  const who = !picked ? 'the whole pot' : picked.isSelf ? 'the Admin (own money + Admin cut)' : picked.name
  const potLabel = !picked ? 'Whole pot' : picked.isSelf ? 'Admin’s pot' : `${picked.name}’s pot`
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])))
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k)
      else p.set(k, v)
    }
    return `/projections?${p.toString()}`
  }
  const chip =
    'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted aria-[current=page]:bg-brand aria-[current=page]:text-brand-foreground aria-[current=page]:ring-brand'

  return (
    // [overflow-wrap:anywhere]: a lender's name is free text and must wrap, not widen a phone screen.
    <div className="mx-auto max-w-3xl space-y-5 [overflow-wrap:anywhere]">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Projections</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your expected interest if you keep lending the way you have for the last {HISTORY_MONTHS} months. Estimates, not promises.
        </p>
      </header>

      <section className="bg-card ring-border/70 space-y-4 rounded-2xl p-4 ring-1">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Whose money</h2>
          <ScrollRow label="Whose money">
            <Link href={href({ view: null, lender: null })} aria-current={!picked ? 'page' : undefined} className={chip}>Whole pot</Link>
            {ctx.lenders.map((l) => (
              <Link key={l.id} href={href({ view: 'lender', lender: l.id })} aria-current={picked?.id === l.id ? 'page' : undefined} className={chip}>
                {l.name}
              </Link>
            ))}
          </ScrollRow>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">How far ahead</h2>
          <ScrollRow label="How far ahead">
            {RANGES.map((r) => (
              <Link key={r} href={href({ range: String(r) })} aria-current={r === range ? 'page' : undefined} className={chip}>
                {rangeLabel(r)}
              </Link>
            ))}
          </ScrollRow>
        </div>
      </section>

      {/* THE ANSWER: interest a month (the range's total over its months), the total, and the pot at the end. */}
      <section aria-label="The estimate" className="bg-hero shadow-rest relative overflow-hidden rounded-2xl p-5 text-white">
        <span className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <p className="relative text-xs font-medium"><span className="rounded-full bg-white/15 px-2 py-0.5">Estimate</span></p>
        <p className="relative mt-3 text-sm text-white/90">Over the next {range === 12 ? 'year' : rangeLabel(range)}, {who} would earn about</p>
        <p className="relative mt-1 text-4xl font-semibold tracking-tight">
          <Money amount={perMonth} variant="display" /><span className="text-xl font-medium"> a month</span>
        </p>
        <dl className="relative mt-4 grid gap-1.5 border-t border-white/20 pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-white/85">Total interest, today to end of {last ? monthName(last.month) : ''}</dt>
            <dd className="shrink-0 font-medium whitespace-nowrap"><Money amount={f.total} variant="display" /></dd>
          </div>
          {last ? (
            <div className="flex justify-between gap-3">
              <dt className="text-white/85">{potLabel} by then (capital + earnings)</dt>
              <dd className="shrink-0 font-medium whitespace-nowrap"><Money amount={last.pot} variant="display" /></dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="bg-card ring-border/70 space-y-4 rounded-2xl p-4 ring-1">
        <div>
          <h2 className="text-base font-semibold">Each month</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">Estimated interest coming in each month, and the pot at the end of it.</p>
        </div>
        <MonthlyBars months={f.months} />
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="text-muted-foreground border-border/70 border-b text-left text-xs">
                <th scope="col" className="px-4 py-2 font-medium">Month</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Interest</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{potLabel}<span className="block font-normal">capital + earnings</span></th>
              </tr>
            </thead>
            <tbody className="divide-border/70 divide-y">
              {f.months.map((m, i) => (
                <tr key={m.key}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium whitespace-nowrap">
                    {m.month.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}
                    {i === 0 ? <span className="text-muted-foreground block text-xs font-normal">from today</span> : null}
                  </th>
                  <td className="px-2 py-2.5 text-right">
                    <Money amount={m.interest} variant="column" />
                    {/* Which figure the month used: shown so a month can be understood at a glance. */}
                    <span className="text-muted-foreground block text-xs">{m.basis === 'known' ? 'running loans' : 'usual pace'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right"><Money amount={m.pot} variant="column" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="group bg-card ring-border/70 rounded-2xl p-4 ring-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-base font-semibold [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block">How it’s worked out</span>
            <span className="text-muted-foreground block text-xs font-normal">Open this if a number surprises you.</span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="text-muted-foreground mt-3 list-disc space-y-2 pl-4 text-sm">
          <li>
            <span className="text-foreground">Your usual pace:</span> the {f.basedOnLoans} new loans since{' '}
            {historyWindowStart(ctx.today).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })} earned{' '}
            {who} about <Money amount={f.usual} variant="display" /> a month.
          </li>
          <li>Each month uses what your running loans will pay that month, or your usual pace, whichever is more; the table says which. A month where a big loan falls due can read a little high, because a loan’s whole interest counts on its due date. This month counts from today only, so the “a month” figure, an average over the months shown, reads slightly low.</li>
          <li>A lender’s figures are their own earnings only. The Admin’s include the Admin cut. The whole pot is everyone.</li>
          <li>The pot is today’s capital (cash + money out on loan) plus the interest counted so far. It assumes no money is added or taken out.</li>
          {f.overdue > 0 ? <li>Not counted: <Money amount={f.overdue} variant="display" /> already overdue today.</li> : null}
        </ul>
      </details>
    </div>
  )
}

/** One line of choices that scrolls sideways on a phone instead of wrapping into a block. */
function ScrollRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className="-mx-4 -my-1 overflow-x-auto px-4 [scrollbar-width:none]">
      <div className="flex w-max gap-2 py-1">{children}</div>
    </nav>
  )
}
