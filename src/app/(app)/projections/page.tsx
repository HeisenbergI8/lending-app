import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { type Centavos, centavos, parsePesos } from '@/lib/money/centavos.ts'
import { HISTORY_MONTHS } from '@/lib/money/forecast-history.ts'
import {
  DEFAULT_HORIZON_MONTHS,
  type Plan,
  type View,
  forecastSafely,
  lateInView,
  type TargetKind,
  forecastView,
  monthOf,
  reachTarget,
} from '@/lib/money/forecast.ts'
import { rate as pct } from '@/lib/loan-export.ts'
import { monthKey, storedCalendarDate } from '@/lib/money/weeks.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listPlans, plansById, projectionContext } from '@/server/projections/queries.ts'

import { AddMoveForm, DeletePlanButton, PlanForm, RemoveMoveButton } from './plan-form.tsx'
import { type ChartLine, ProjectionChart } from './projection-chart.tsx'

export const metadata = { title: 'Projections' }

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)']
const monthName = (d: Date) => d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

export default async function ProjectionsPage({ searchParams }: PageProps<'/projections'>) {
  const user = await requireUser()
  const q = await searchParams
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined)

  const [ctx, saved] = await Promise.all([projectionContext(user.id), listPlans(user.id)])
  const currentId = one('plan') ?? saved[0]?.id ?? null
  const ids = [...new Set([currentId, ...(one('compare')?.split(',') ?? [])].filter((id): id is string => !!id))].slice(0, 3)
  const loaded = await plansById(user.id, ids)

  const realOnly: Plan = {
    horizonMonths: DEFAULT_HORIZON_MONTHS, newLoansPerMonth: 0, loanAmount: centavos(1), termWeeks: 1,
    borrowerRateBps: ctx.defaults.borrowerRateBps, adminCutBps: ctx.defaults.adminCutBps,
    collection: 'AT_END', relend: false, moves: [],
  }
  const plans = loaded.length > 0 ? loaded : [{ id: 'real', name: 'Running loans only', plan: realOnly, moves: [] }]

  const admin = ctx.lenders.find((l) => l.isSelf)
  const view: View =
    one('view') === 'admin' ? { kind: 'admin-cut' }
    : one('view') === 'lender' ? { kind: 'lender', lenderId: one('lender') ?? admin?.id ?? '' }
    : { kind: 'pot' }

  // A plan that compounds past safe whole-number arithmetic (long horizon +
  // re-lending) is left off the chart and NAMED, rather than crashing the page:
  // the page must still load so that plan can be shortened or deleted.
  const tooLarge: string[] = []
  const run = (p: { id: string; name: string; plan: Plan }) => {
    const input = { today: ctx.today, plan: p.plan, lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits }
    const r = forecastSafely(input, { onTimeBps: ctx.onTime.bps, lateDelayDays: ctx.lateDelayDays })
    if (!r.ok) {
      tooLarge.push(p.name)
      return []
    }
    const f = r.value
    return [{ ...p, f, best: forecastView(f.best, view), realistic: f.realistic ? forecastView(f.realistic, view) : null }]
  }
  const drawn = plans.flatMap(run)
  // Running loans alone never overflow: they are real, stored amounts.
  const runs = drawn.length > 0 ? drawn : run({ id: 'real', name: 'Running loans only', plan: realOnly })

  const first = runs[0]
  const selectedKey = one('month') ?? monthKey(ctx.today)
  const best = monthOf(first.best, selectedKey) ?? first.best[0]
  const realistic = first.realistic ? monthOf(first.realistic, best.key) : null
  const targetParsed = one('target') ? parsePesos(one('target') as string) : null
  const target: Centavos | null = targetParsed?.ok ? targetParsed.value : null
  const targetKind: TargetKind = one('targetKind') === 'pot' && view.kind !== 'admin-cut' ? 'pot' : 'interest'

  const lines: ChartLine[] = runs.flatMap((r, i) => [
    { key: `${r.id}-best`, label: `${r.name} — all pay on time`, color: SERIES[i], dashed: false, points: r.best },
    ...(r.realistic ? [{ key: `${r.id}-real`, label: `${r.name} — realistic`, color: SERIES[i], dashed: true, points: r.realistic }] : []),
  ])
  const flagged = new Set(first.best.filter((m) => m.warnings.length > 0).map((m) => m.key))
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])))
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k)
      else p.set(k, v)
    }
    return `/projections?${p.toString()}`
  }
  const name = (id: string) => ctx.lenders.find((l) => l.id === id)?.name ?? 'A lender'

  /* LABEL PROVENANCE (label-truth). Every figure below is an ESTIMATE from
     lib/money/forecast.ts, recomputed on every view from today's ACTIVE loans
     (realRows) and the saved plan's inputs. "Interest" is money COLLECTED in
     the month, in the chosen view:
       pot        LenderMonth.interest + adminCut, every pot
       admin      LenderMonth.adminCut on the Admin pot — the cut only
       lender     that pot's own LenderMonth.interest
     "Total by then" is interestToDate: from TODAY to the end of that month, not
     since the start of lending. Money already late today (Simulation.lateNow)
     is in NEITHER line, and is printed separately so the gap is visible. */

  return (
    // [overflow-wrap:anywhere]: a plan name is free text, and one long word must wrap, not widen a phone screen.
    <div className="space-y-6 [overflow-wrap:anywhere]">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Projections</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Estimates, not promises. Built from the loans running today plus the pretend loans in the plan.
        </p>
      </div>

      <nav aria-label="Whose money" className="flex flex-wrap gap-2 text-sm [&>a]:rounded-full [&>a]:px-3 [&>a]:py-1 [&>a]:ring-1 [&>a]:ring-border [&>a[aria-current=page]]:bg-brand [&>a[aria-current=page]]:text-brand-foreground [&>a[aria-current=page]]:ring-brand">
        <Link href={href({ view: 'pot', lender: null })} aria-current={view.kind === 'pot' ? 'page' : undefined}>Whole pot</Link>
        <Link href={href({ view: 'admin', lender: null })} aria-current={view.kind === 'admin-cut' ? 'page' : undefined}>Admin cut</Link>
        {ctx.lenders.map((l) => (
          <Link key={l.id} href={href({ view: 'lender', lender: l.id })} aria-current={view.kind === 'lender' && view.lenderId === l.id ? 'page' : undefined}>
            {l.name}
          </Link>
        ))}
      </nav>

      <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70">
        <h2 className="text-base font-semibold">Estimated interest, running total</h2>
        {/* The chart's dotted target line is drawn only for an interest target: a pot-size
            target is on a different scale from the running interest the chart plots. */}
        <ProjectionChart lines={lines} selected={best.key} hrefFor={(key) => href({ month: key })} target={targetKind === 'interest' ? target : null} flagged={flagged} />
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {lines.map((l) => <li key={l.key}><span style={{ color: l.color }}>{l.dashed ? '- - -' : '———'}</span> {l.label}</li>)}
        </ul>
        <p className="text-muted-foreground text-xs">
          {ctx.onTime.bps === null
            ? `No realistic line: nothing fell due in the last ${HISTORY_MONTHS} months to measure.`
            : `Realistic line: ${pct(ctx.onTime.bps)} of ${ctx.onTime.counted} amounts due since ${ctx.onTime.from.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })} were paid on or before their due day. The rest is drawn ${ctx.lateDelayDays ?? 30} days later${ctx.lateDelayDays === null ? ' (a guess: no late payment has come in yet)' : ' (the usual delay)'}.`}
        </p>
        {tooLarge.length > 0 ? (
          <p role="alert" className="text-sm">
            {tooLarge.map((n) => `“${n}”`).join(', ')} grows too large to calculate (re-lending compounds every month).
            {drawn.length === 0 ? ' Showing running loans only.' : ''} Shorten its months ahead, or turn re-lending off.
          </p>
        ) : null}
        {/* lateInView: the overdue money that belongs to THIS view's money, not always the whole pot's. */}
        {lateInView(first.f.best, view) > 0 ? (
          <p className="text-xs">
            Not in either line: <Money amount={lateInView(first.f.best, view)} variant="display" /> already overdue today.
          </p>
        ) : null}
        {first.f.best.refused ? <p role="alert" className="text-sm">{first.f.best.refused}</p> : null}
        {first.plan.relend ? (
          <ul className="text-muted-foreground space-y-0.5 text-xs" aria-label="How each lender re-lends">
            {/* RelendHabit from relendHabits: shareBps is an UPPER BOUND (deposit-funded
                lending looks like re-lending), so the words say "up to". A default is
                named as one, per lender, as the owner asked. */}
            {ctx.lenders.map((l) => {
              const h = ctx.habits.get(l.id)
              return (
                <li key={l.id}>
                  {l.name}:{' '}
                  {!h || h.basis === 'default'
                    ? 'default — not enough history, so all returned money is re-lent the next month'
                    : `re-lends up to ${pct(h.shareBps)} of returned money, about ${Math.max(1, h.lagMonths)} month${Math.max(1, h.lagMonths) === 1 ? '' : 's'} later (from ${h.returnMonths} months with money back)`}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="bg-card rounded-2xl p-4 ring-1 ring-border/70">
          {/* interest COLLECTED in this one month, best case, first plan */}
          {/* The current month counts from TODAY: money that came back earlier this month is not in it. */}
          <p className="text-muted-foreground text-xs">
            {best.key === monthKey(ctx.today) ? `Estimated interest from today to the end of ${monthName(best.month)}` : `Estimated interest in ${monthName(best.month)}`}
          </p>
          <p className="text-xl font-semibold"><Money amount={best.interest} variant="display" /></p>
          {realistic ? <p className="text-muted-foreground text-xs">Realistic: <Money amount={realistic.interest} variant="display" /></p> : null}
        </div>
        <div className="bg-card rounded-2xl p-4 ring-1 ring-border/70">
          {/* interestToDate: from today, not from the start of lending */}
          <p className="text-muted-foreground text-xs">Estimated total from today to the end of {monthName(best.month)}</p>
          <p className="text-xl font-semibold"><Money amount={best.interestToDate} variant="display" /></p>
          {realistic ? <p className="text-muted-foreground text-xs">Realistic: <Money amount={realistic.interestToDate} variant="display" /></p> : null}
        </div>
      </section>

      <form method="get" action="/projections" className="flex flex-wrap items-end gap-2">
        {Object.entries(q).flatMap(([k, v]) => (k !== 'target' && k !== 'targetKind' && typeof v === 'string' ? [<input key={k} type="hidden" name={k} value={v} />] : []))}
        <label className="text-sm">When do I reach ₱ <input name="target" inputMode="decimal" defaultValue={one('target') ?? ''} className="border-border w-32 rounded border px-2" /></label>
        <select name="targetKind" defaultValue={targetKind} aria-label="Reach it in" className="border-border rounded border px-1 text-sm">
          <option value="interest">in total interest from today</option>
          {view.kind !== 'admin-cut' ? <option value="pot">in pot size (cash + capital out)</option> : null}
        </select>
        <button type="submit" className="text-brand text-sm font-medium">Find the month</button>
      </form>
      {target !== null ? (
        <p className="text-sm">
          {(() => {
            const b = reachTarget(first.best, target, targetKind)
            const r = first.realistic ? reachTarget(first.realistic, target, targetKind) : null
            const say = (m: typeof b) => (m ? monthName(m.month) : `not within the ${first.best.length} months shown`)
            const what = targetKind === 'pot' ? 'Pot size (cash + capital out) estimated to reach it' : 'Total interest from today estimated to reach it'
            return `${what}: ${say(b)} if everyone pays on time${first.realistic ? `; ${say(r)} on the realistic line` : ''}.`
          })()}
        </p>
      ) : null}

      {flagged.size > 0 ? (
        <section aria-label="Months with a cash warning" className="space-y-1">
          <h2 className="flex items-center gap-1 text-sm font-semibold"><AlertTriangle className="size-4" /> Not enough free cash</h2>
          <ul className="text-sm">
            {first.best.filter((m) => m.warnings.length > 0).map((m) => (
              <li key={m.key}>
                {monthName(m.month)}:{' '}
                {m.warnings.map((w) => `${name(w.lenderId)} would need ${w.cause === 'loans' ? 'their share of the new loans' : 'a withdrawal'} but has less free`).join('; ')}
                {' '}— still projected as if the money were there.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Plans</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {saved.map((p) => (
            <li key={p.id} className="flex min-w-0 gap-1 [overflow-wrap:anywhere]">
              <Link href={href({ plan: p.id })}>{p.name}</Link>
              {p.id === currentId ? null : ids.includes(p.id) ? (
                <Link className="text-muted-foreground" href={href({ compare: ids.filter((id) => id !== currentId && id !== p.id).join(',') || null })}>− remove</Link>
              ) : (
                <Link className="text-muted-foreground" href={href({ compare: [...ids.filter((id) => id !== currentId && id !== p.id), p.id].slice(-2).join(',') })}>+ compare</Link>
              )}
            </li>
          ))}
          {/* "new" matches no saved plan, so the form below opens empty, as a create form. */}
          {loaded.length > 0 ? <li><Link className="text-brand" href={href({ plan: 'new', compare: null })}>+ New plan</Link></li> : null}
        </ul>
        <PlanForm
          planId={loaded[0]?.id ?? null}
          values={/* from loaded[0] row, or ctx.defaults for a new plan — see Step 6.4 notes */ toFormValues(loaded[0]?.plan ?? null, loaded[0]?.name ?? '', ctx.defaults)}
          defaultsNote={
            ctx.defaults.basedOn === 0
              ? 'Rate, cut and collection start at 7%, 2%, at the end: no weekly-rate loans in the last 6 months to take them from.'
              : `Rate, cut and collection start from the most common values on ${ctx.defaults.basedOn} weekly-rate loans in the last 6 months. Change them for this plan.`
          }
        />
        {loaded[0] ? (
          <>
            <h3 className="text-sm font-semibold">Planned money in and out (pretend; nothing is recorded)</h3>
            <ul className="text-sm">
              {loaded[0].moves.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  {name(m.lenderId)} {m.type === 'DEPOSIT' ? 'adds' : 'takes out'} <Money amount={centavos(m.amountCentavos)} variant="display" />
                  {m.everyMonth
                    ? ` every month from ${monthName(storedCalendarDate(m.fromMonth))}${m.untilMonth ? ` to ${monthName(storedCalendarDate(m.untilMonth))}` : ''}`
                    : ` in ${monthName(storedCalendarDate(m.fromMonth))}`}
                  <RemoveMoveButton moveId={m.id} />
                </li>
              ))}
            </ul>
            <AddMoveForm planId={loaded[0].id} lenders={ctx.lenders.map((l) => ({ id: l.id, name: l.name }))} />
            <DeletePlanButton planId={loaded[0].id} name={loaded[0].name} />
          </>
        ) : null}
      </section>
    </div>
  )
}

/** A saved plan (or the history defaults) as the strings the form shows. */
function toFormValues(plan: Plan | null, name: string, d: { borrowerRateBps: number; adminCutBps: number; collection: 'AT_END' | 'WEEKLY' }) {
  const pctText = (bps: number) => String(bps / 100)
  return {
    name: plan ? name : '',
    newLoansPerMonth: plan?.newLoansPerMonth ?? 1,
    // 0 is stored for a plan with no new loans: show it blank, which the form accepts there.
    loanAmount: plan && plan.loanAmount > 0 ? String(plan.loanAmount / 100) : '',
    termWeeks: plan?.termWeeks ?? 4,
    borrowerRate: pctText(plan?.borrowerRateBps ?? d.borrowerRateBps),
    adminCut: pctText(plan?.adminCutBps ?? d.adminCutBps),
    interestCollection: plan?.collection ?? d.collection,
    relend: plan?.relend ?? true,
    horizonMonths: plan?.horizonMonths ?? DEFAULT_HORIZON_MONTHS,
  }
}
