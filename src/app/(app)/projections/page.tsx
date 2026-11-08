import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { type Centavos, centavos, parsePesos } from '@/lib/money/centavos.ts'
import { rate as pct } from '@/lib/loan-export.ts'
import { DEFAULT_RANGE, HISTORY_MONTHS, PACES, type Pace, RANGES, type Whose, historyWindowStart, rangeLabel, simpleForecast } from '@/lib/money/simple-forecast.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { projectionContext, simpleInput } from '@/server/projections/queries.ts'

import { MonthlyBars } from './monthly-bars.tsx'

export const metadata = { title: 'Projections' }

const PACE_LABEL: Record<Pace, string> = { slow: 'Slow', usual: 'Usual', busy: 'Busy' }

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
 *
 * BORROWERS (owner, 2026-11-08): `pace` picks slow / usual / busy, from the
 * slowest and busiest of the last 6 full months; the hero shows all three a
 * month. Each lender's interest is held to their busiest month, and money past
 * it is shown as having no borrower (SimpleMonth.idle).
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
  // Money in / out each month: typed on the page, never saved. Blank or nonsense is none.
  const pesos = (k: string): Centavos | undefined => {
    const raw = one(k)
    if (!raw) return undefined
    const r = parsePesos(raw)
    return r.ok ? r.value : undefined
  }
  const monthlyIn = pesos('add')
  const monthlyOut = pesos('out')
  const pace = PACES.find((p) => p === one('pace')) ?? 'usual'
  const at = (p: Pace) => simpleForecast(simpleInput(ctx, range, { monthlyIn, monthlyOut, pace: p }), whose, ctx.newLoans)
  const f = at(pace)
  const a = (x: { total: Centavos; months: unknown[] }) => centavos(Math.round(x.total / x.months.length))
  const slow = pace === 'slow' ? f : at('slow')
  const busy = pace === 'busy' ? f : at('busy')
  const slowPerMonth = a(slow)
  const busyPerMonth = a(busy)
  const runsOut = monthlyOut ? f.months.find((m, i) => i > 0 && m.takenOut < monthlyOut) : undefined

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
          Your expected interest if you keep lending the way you have for the last {HISTORY_MONTHS} months, with interest left in to earn more. Estimates, not promises.
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
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">How busy with borrowers</h2>
            <p className="text-muted-foreground text-xs">Like your slowest month, an average month, or your busiest month of the last {HISTORY_MONTHS}.</p>
          </div>
          <ScrollRow label="How busy with borrowers">
            {PACES.map((p) => (
              <Link key={p} href={href({ pace: p === 'usual' ? null : p })} aria-current={p === pace ? 'page' : undefined} className={chip}>
                {PACE_LABEL[p]}
              </Link>
            ))}
          </ScrollRow>
        </div>
      </section>

      {/* THE ANSWER: interest a month (the range's total over its months), the total, and the pot at the end. */}
      <section aria-label="The estimate" className="bg-hero shadow-rest relative overflow-hidden rounded-2xl p-5 text-white">
        <span className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <p className="relative text-xs font-medium"><span className="rounded-full bg-white/15 px-2 py-0.5">Estimate</span></p>
        <p className="relative mt-3 text-sm text-white/90">
          Over the next {range === 12 ? 'year' : rangeLabel(range)}{pace === 'usual' ? '' : `, in ${pace} months`}, {who} would earn about
        </p>
        <p className="relative mt-1 text-4xl font-semibold tracking-tight">
          <Money amount={perMonth} variant="display" /><span className="text-xl font-medium"> a month</span>
        </p>
        <dl className="relative mt-4 grid gap-1.5 border-t border-white/20 pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-white/85">Range a month, slow to busy months</dt>
            <dd className="shrink-0 font-medium whitespace-nowrap">
              <Money amount={slowPerMonth} variant="display" /> – <Money amount={busyPerMonth} variant="display" />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-white/85">Total interest, today to end of {last ? monthName(last.month) : ''}</dt>
            <dd className="shrink-0 font-medium whitespace-nowrap"><Money amount={f.total} variant="display" /></dd>
          </div>
          {f.monthlyReturnBps !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-white/85">
                Monthly return{picked ? ` on ${picked.isSelf ? 'the Admin’s own money' : `${picked.name}’s money`}` : ''}, from the last {HISTORY_MONTHS} months
              </dt>
              <dd className="shrink-0 font-medium whitespace-nowrap">{pct(f.monthlyReturnBps)}</dd>
            </div>
          ) : null}
          {picked?.isSelf && f.usualCut > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-white/85">Plus the Admin cut on other lenders’ money (grows with their pots)</dt>
              <dd className="shrink-0 font-medium whitespace-nowrap"><Money amount={f.usualCut} variant="display" /> a month</dd>
            </div>
          ) : null}
          {last ? (
            <div className="flex justify-between gap-3">
              <dt className="text-white/85">{potLabel} by then (capital + earnings{monthlyIn || monthlyOut ? ', after money in and out' : ''})</dt>
              <dd className="shrink-0 font-medium whitespace-nowrap"><Money amount={last.pot} variant="display" /></dd>
            </div>
          ) : null}
          {last && pace === 'usual' && last.idle > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-white/85">Of that, money with no borrower by then (more than your busiest month has used)</dt>
              <dd className="shrink-0 font-medium whitespace-nowrap"><Money amount={last.idle} variant="display" /></dd>
            </div>
          ) : null}
        </dl>
        <p className="relative mt-3 text-xs text-white/80">Apart from what running loans already owe, interest never goes above your busiest month so far, because the number of borrowers may not grow with the pot.</p>
      </section>

      {/* MONEY IN AND OUT: a plain GET form, so it works without JavaScript and nothing is saved. */}
      <section className="bg-card ring-border/70 space-y-3 rounded-2xl p-4 ring-1">
        <div>
          <h2 className="text-base font-semibold">Money in and out each month</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">Optional. Starts next month and changes the pot, and so the interest after it. Nothing is saved or recorded.</p>
        </div>
        <form method="get" action="/projections" className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          {Object.entries(q).flatMap(([k, v]) => (k !== 'add' && k !== 'out' && typeof v === 'string' ? [<input key={k} type="hidden" name={k} value={v} />] : []))}
          <PesoField name="add" label="Add each month" value={one('add')} />
          <PesoField name="out" label="Take out each month" value={one('out')} />
          <button type="submit" className="bg-brand text-brand-foreground col-span-2 min-h-11 rounded-lg px-4 text-sm font-medium sm:col-span-1">Update</button>
        </form>
        {runsOut ? (
          <p role="alert" className="text-sm">The pot runs out in {monthName(runsOut.month)}: taking out more than it holds.{picked?.isSelf ? ' The Admin cut still comes in after that, because it is earned on the other lenders’ money.' : ''}</p>
        ) : null}
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
                    <span className="text-muted-foreground block text-xs">{m.basis === 'known' ? 'running loans' : 'monthly return'}</span>
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
            {who} about <Money amount={f.usual} variant="display" /> a month. On <Money amount={f.capitalNow} variant="display" /> of money today, that is a monthly return of {f.monthlyReturnBps === null ? '—' : pct(f.monthlyReturnBps)}.
          </li>
          <li>From next month, each lender’s pot earns their own return as it stands. Interest left in earns interest too, so it compounds.</li>
          <li>
            <span className="text-foreground">Borrowers:</span> a lender never earns more in a month than in their busiest month of the last {HISTORY_MONTHS}, because more money does not bring more borrowers by itself. Money past that is shown as having no borrower (the lenders’ own money only; the Admin cut is not money sitting anywhere).
          </li>
          {f.basedOnLoans > 0 ? <li>
            <span className="text-foreground">Slow and busy:</span> your slowest of the last {HISTORY_MONTHS} full months earned {Math.round(slow.paceFactor * 100)}% of an average month, your busiest {Math.round(busy.paceFactor * 100)}%. Slow and busy use those against the usual return. Running loans still pay what they will either way.
          </li> : null}
          <li>The Admin cut is earned on the other lenders’ money, so it grows with their pots, not with the Admin’s. That is why every lender’s figures add up to the whole pot.</li>
          <li>Money added in a month starts earning the month after.</li>
          <li>The return uses the money there is today. If a lot was added or taken out recently, it can read high or low.{f.capped ? ' One lender’s return was held to the most a loan can earn, about 30% a month, because they have very little money left.' : ''}</li>
          <li>Money in and out goes to the pot you are looking at. On the whole pot it is shared across lenders by the size of their pots.</li>
          <li>A month never shows less than your running loans will pay in it; the table says which figure it used. A month where a big loan falls due can read a little high, because a loan’s whole interest counts on its due date. This month counts from today only, so the “a month” figure, an average over the months shown, reads slightly low.</li>
          <li>A lender’s figures are their own earnings only. The Admin’s include the Admin cut. The whole pot is everyone.</li>
          <li>The pot starts from today’s capital (cash + money out on loan). Each month adds its interest and any money in, and takes off any money out. It cannot go below zero.</li>
          {f.overdue > 0 ? <li>Not counted: <Money amount={f.overdue} variant="display" /> already overdue today.</li> : null}
        </ul>
      </details>
    </div>
  )
}

function PesoField({ name, label, value }: { name: string; label: string; value: string | undefined }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">{label}</label>
      <div className="relative">
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm" aria-hidden>₱</span>
        <input id={name} name={name} inputMode="decimal" defaultValue={value ?? ''} placeholder="0" className="border-input bg-background h-11 w-full rounded-lg border pr-3 pl-7 text-base" />
      </div>
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
