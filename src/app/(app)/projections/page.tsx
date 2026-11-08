import Link from 'next/link'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { IconChip, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'
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
import { type ChartLine, ChartLegend, ProjectionChart } from './projection-chart.tsx'

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
  // The first plan again with re-lending off, for the tiles: re-lending can be
  // most of the estimate (data-truth, 2026-11-08), so the plain figure is shown beside it.
  const plainRun = first.plan.relend ? run({ id: `${first.id}-plain`, name: first.name, plan: { ...first.plan, relend: false } })[0] ?? null : null
  const selectedKey = one('month') ?? monthKey(ctx.today)
  const best = monthOf(first.best, selectedKey) ?? first.best[0]
  const realistic = first.realistic ? monthOf(first.realistic, best.key) : null
  const targetParsed = one('target') ? parsePesos(one('target') as string) : null
  const target: Centavos | null = targetParsed?.ok ? targetParsed.value : null
  const targetKind: TargetKind = one('targetKind') === 'pot' && view.kind !== 'admin-cut' ? 'pot' : 'interest'

  const lines: ChartLine[] = runs.flatMap((r, i) => [
    { key: `${r.id}-best`, label: `${r.name}: everyone pays on time${r.plan.relend ? ', with re-lending' : ''}`, color: SERIES[i], dashed: false, points: r.best },
    ...(r.realistic ? [{ key: `${r.id}-real`, label: `${r.name}: some pay late${r.plan.relend ? ', with re-lending' : ''}`, color: SERIES[i], dashed: true, points: r.realistic }] : []),
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

  const isNew = loaded.length === 0
  const viewName = view.kind === 'pot' ? 'the whole pot' : view.kind === 'admin-cut' ? 'the Admin cut' : name(view.lenderId)
  const isThisMonth = best.key === monthKey(ctx.today)
  const at = first.best.findIndex((m) => m.key === best.key)
  const prev = first.best[at - 1] ?? null
  const next = first.best[at + 1] ?? null
  const warnMonths = first.best.filter((m) => m.warnings.length > 0)
  const late = lateInView(first.f.best, view)
  const plainMonth = plainRun ? monthOf(plainRun.best, best.key) : null
  const shortDate = (d: Date) => d.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })
  const small = 'inline-flex min-h-11 items-center rounded-full px-3 text-xs font-medium ring-1 ring-border hover:bg-muted'
  const chip = 'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted aria-[current=page]:bg-brand aria-[current=page]:text-brand-foreground aria-[current=page]:ring-brand'

  return (
    // [overflow-wrap:anywhere]: a plan name is free text, and one long word must wrap, not widen a phone screen.
    <div className="mx-auto max-w-3xl space-y-5 [overflow-wrap:anywhere]">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Projections</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          How much interest you could earn if lending carries on the way you plan. Estimates, not promises.
        </p>
      </header>

      {/* STEP 1 and 2: what is being projected. Choices first, so every figure
          below reads as the answer to them. One scrolling row each on a phone. */}
      <section className="bg-card ring-border/70 space-y-4 rounded-2xl p-4 ring-1">
        <SectionHead title="Choose what to look at" purpose="The figures and the chart below change to match what you pick here." />
        <div className="space-y-2">
          <StepTitle n={1}>Pick a plan</StepTitle>
          <p className="text-muted-foreground -mt-1 text-xs">A plan is your guess about the loans you will make. “Running loans only” shows just today’s loans.</p>
          <ScrollRow label="Plans">
            {saved.map((p) => (
              <Link key={p.id} href={href({ plan: p.id, compare: null })} aria-current={p.id === currentId ? 'page' : undefined} className={chip}>
                {p.name}
              </Link>
            ))}
            <Link href={href({ plan: 'new', compare: null })} aria-current={isNew ? 'page' : undefined} className={chip}>
              {saved.length === 0 ? 'Running loans only' : '+ New plan'}
            </Link>
          </ScrollRow>
          {isNew ? (
            <p className="text-muted-foreground text-xs">
              Showing only the loans running today. <a href="#plan-settings" className="text-brand font-medium">Create a plan</a> to add the new loans you expect to make.
            </p>
          ) : saved.length > 1 ? (
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              Also draw on the chart:
              {saved.filter((p) => p.id !== currentId).map((p) =>
                ids.includes(p.id) ? (
                  <Link key={p.id} className={`${small} bg-brand/10 text-brand ring-brand/30`} href={href({ compare: ids.filter((id) => id !== currentId && id !== p.id).join(',') || null })}>✓ {p.name}</Link>
                ) : (
                  <Link key={p.id} className={small} href={href({ compare: [...ids.filter((id) => id !== currentId && id !== p.id), p.id].slice(-2).join(',') })}>+ {p.name}</Link>
                ),
              )}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <StepTitle n={2}>Whose money</StepTitle>
          <p className="text-muted-foreground -mt-1 text-xs">Whole pot is everyone together. Pick a name to see only theirs.</p>
          <ScrollRow label="Whose money">
            <Link href={href({ view: 'pot', lender: null })} aria-current={view.kind === 'pot' ? 'page' : undefined} className={chip}>Whole pot</Link>
            <Link href={href({ view: 'admin', lender: null })} aria-current={view.kind === 'admin-cut' ? 'page' : undefined} className={chip}>Admin cut</Link>
            {ctx.lenders.map((l) => (
              <Link key={l.id} href={href({ view: 'lender', lender: l.id })} aria-current={view.kind === 'lender' && view.lenderId === l.id ? 'page' : undefined} className={chip}>
                {l.name}
              </Link>
            ))}
          </ScrollRow>
        </div>
      </section>

      {tooLarge.length > 0 ? (
        <Notice>
          {tooLarge.map((n) => `“${n}”`).join(', ')} grows too large to calculate, because re-lending compounds every month.
          {drawn.length === 0 ? ' Showing running loans only.' : ''} Shorten its months, or turn re-lending off, in Plan settings below.
        </Notice>
      ) : null}
      {first.f.best.refused ? <Notice>{first.f.best.refused}</Notice> : null}

      {/* STEP 3: THE ANSWER. One hero, read as a sentence. Every figure is an
          ESTIMATE from forecastView (see LABEL PROVENANCE above):
            hero   interestToDate — from TODAY to the end of the month, not since lending began
            tiles  interest collected during that month; potSize = cash + capital out at month end */}
      <section aria-label="Estimate for the chosen month" className="space-y-3">
        <div className="bg-hero shadow-rest relative overflow-hidden rounded-2xl p-5 text-white">
          <span className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <StepBadge n={3} light>Pick a month</StepBadge>
          <p className="relative mt-1 text-xs text-white/80">Use the arrows, or tap the chart below. The numbers show that month’s estimate.</p>
          <div className="relative mt-2 flex items-center justify-between gap-2 rounded-full bg-white/10 p-1">
            <MonthArrow href={prev ? href({ month: prev.key }) : null} label="Previous month"><ChevronLeft className="size-5" /></MonthArrow>
            <span className="text-base font-semibold">{monthName(best.month)}</span>
            <MonthArrow href={next ? href({ month: next.key }) : null} label="Next month"><ChevronRight className="size-5" /></MonthArrow>
          </div>
          {/* Says ESTIMATE and, when on, RE-LENDING beside the figure itself: re-lending can be most of it. */}
          <p className="relative mt-4 flex flex-wrap gap-1.5 text-xs font-medium">
            <span className="rounded-full bg-white/15 px-2 py-0.5">Estimate</span>
            {first.plan.relend ? <span className="rounded-full bg-white/15 px-2 py-0.5">Includes re-lending</span> : null}
          </p>
          <p className="relative mt-2 text-sm text-white/90">
            If everyone pays on time, {viewName} would collect an estimated
          </p>
          <p className="relative mt-1 text-4xl font-semibold tracking-tight">
            <Money amount={best.interestToDate} variant="display" />
          </p>
          <p className="relative mt-1 text-sm text-white/90">in interest from today to the end of {monthName(best.month)}.</p>
          {realistic || plainMonth ? (
            <dl className="relative mt-4 grid gap-1.5 border-t border-white/20 pt-3 text-sm">
              {realistic ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-white/85">If some pay late, like before</dt>
                  <dd className="font-medium"><Money amount={realistic.interestToDate} variant="display" /></dd>
                </div>
              ) : null}
              {plainMonth ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-white/85">Without re-lending</dt>
                  <dd className="font-medium"><Money amount={plainMonth.interestToDate} variant="display" /></dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        <div className={view.kind === 'admin-cut' ? '' : 'grid grid-cols-2 gap-2.5 sm:gap-3'}>
          <StatTile
            label={`${isThisMonth ? 'Est. still to come in' : 'Est. collected in'} ${monthName(best.month)}${first.plan.relend ? ', with re-lending' : ''}`}
            value={<Money amount={best.interest} variant="display" />}
            note={
              <>
                {realistic ? <span className="block">Paid late: <Money amount={realistic.interest} variant="display" /></span> : null}
                {plainMonth ? <span className="block">No re-lending: <Money amount={plainMonth.interest} variant="display" /></span> : null}
              </>
            }
          />
          {best.potSize !== null ? (
            <StatTile
              label={`Est. pot size, end of ${monthName(best.month)}${first.plan.relend ? ', with re-lending' : ''}`}
              value={<Money amount={best.potSize} variant="display" />}
              note="Cash plus money out on loan"
            />
          ) : null}
        </div>

        {warnMonths.length > 0 ? (
          <div className="bg-card ring-border/70 flex gap-3 rounded-2xl p-4 ring-1">
            <IconChip icon={AlertTriangle} tint="amber" />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-semibold">Not enough free cash in {warnMonths.length === 1 ? '1 month' : `${warnMonths.length} months`}</p>
              <ul className="text-muted-foreground space-y-0.5">
                {warnMonths.slice(0, 3).map((m) => (
                  <li key={m.key}>
                    <Link href={href({ month: m.key })} className="text-foreground font-medium">{monthName(m.month)}</Link>:{' '}
                    {[...new Set(m.warnings.map((w) => name(w.lenderId)))].join(', ')} would be short
                  </li>
                ))}
                {warnMonths.length > 3 ? <li>and {warnMonths.length - 3} more</li> : null}
              </ul>
              <p className="text-muted-foreground text-xs">Still counted as if the money were there.</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="bg-card ring-border/70 space-y-3 rounded-2xl p-4 ring-1">
        <SectionHead
          title="How it grows over time"
          purpose="The line adds up estimated interest from today. The higher it climbs, the more you would have earned by that month. Tap the chart to jump to a month."
        />
        <div>
          <p className="text-muted-foreground text-xs">
            {runs.some((r) => r.plan.relend) ? 'The key under the chart says which lines include re-lending.' : 'No line here includes re-lending.'}
          </p>
        </div>
        {/* The chart's dotted target line is drawn only for an interest target: a pot-size
            target is on a different scale from the running interest the chart plots. */}
        <ProjectionChart lines={lines} selected={best.key} hrefFor={(key) => href({ month: key })} target={targetKind === 'interest' ? target : null} flagged={flagged} />
        <ChartLegend lines={lines} />
      </section>

      <section className="bg-card ring-border/70 space-y-3 rounded-2xl p-4 ring-1">
        <SectionHead title="When will I reach a goal?" purpose="Type an amount and see the first month you would get there." />
        <form method="get" action="/projections" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          {Object.entries(q).flatMap(([k, v]) => (k !== 'target' && k !== 'targetKind' && typeof v === 'string' ? [<input key={k} type="hidden" name={k} value={v} />] : []))}
          <div className="space-y-1.5">
            <Label htmlFor="target">Goal amount</Label>
            <div className="relative">
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm" aria-hidden>₱</span>
              <Input id="target" name="target" inputMode="decimal" defaultValue={one('target') ?? ''} placeholder="e.g. 100,000" className="pl-7" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="targetKind">Counting</Label>
            <SelectNative id="targetKind" name="targetKind" defaultValue={targetKind}>
              <option value="interest">Interest earned from today</option>
              {view.kind !== 'admin-cut' ? <option value="pot">Pot size (cash + money out)</option> : null}
            </SelectNative>
          </div>
          <Button type="submit" variant="secondary" size="lg">Find the month</Button>
        </form>
        {target !== null ? (
          (() => {
            const b = reachTarget(first.best, target, targetKind)
            const r = first.realistic ? reachTarget(first.realistic, target, targetKind) : null
            const say = (m: typeof b) => (m ? monthName(m.month) : `Not within ${first.best.length} months`)
            return (
              <div className="bg-muted/50 space-y-1.5 rounded-xl p-3 text-sm">
                <p className="text-muted-foreground text-xs">Estimated month{first.plan.relend ? ', with re-lending' : ''}</p>
                <dl className="grid gap-1.5">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">If everyone pays on time</dt><dd className="font-semibold">{say(b)}</dd></div>
                {first.realistic ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">If some pay late</dt><dd className="font-semibold">{say(r)}</dd></div> : null}
                </dl>
              </div>
            )
          })()
        ) : null}
      </section>

      <details className="group bg-card ring-border/70 rounded-2xl p-4 ring-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-base font-semibold [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block">How these numbers are worked out</span>
            <span className="text-muted-foreground block text-xs font-normal">Open this if a number surprises you.</span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="text-muted-foreground mt-3 list-disc space-y-2 pl-4 text-sm">
          <li>Starts from the loans running today, then adds the new loans in the plan from next month.</li>
          <li>
            {ctx.onTime.bps === null
              ? `“If some pay late” is not shown: nothing fell due in the last ${HISTORY_MONTHS} months to measure.`
              : `“If some pay late”: ${pct(ctx.onTime.bps)} of ${ctx.onTime.counted} amounts due since ${shortDate(ctx.onTime.from)} were paid on or before their due day. The rest is counted ${ctx.lateDelayDays ?? 30} days later${ctx.lateDelayDays === null ? ' (a guess: no late payment has come in yet)' : ' (the usual delay)'}.`}
          </li>
          {/* lateInView: the overdue money that belongs to THIS view's money, not always the whole pot's. */}
          {late > 0 ? <li>Not counted anywhere: <Money amount={late} variant="display" /> already overdue today.</li> : null}
          <li>Pot size is cash plus money out on loan. Interest not yet collected is not in it.</li>
          {first.plan.relend ? (
            <li>
              Re-lending, per lender (“up to”, because lending paid for by new deposits looks the same):
              {/* RelendHabit from relendHabits: shareBps is an UPPER BOUND. A default is named as one, per lender. */}
              <ul className="mt-1 space-y-0.5">
                {ctx.lenders.map((l) => {
                  const h = ctx.habits.get(l.id)
                  return (
                    <li key={l.id}>
                      <span className="text-foreground">{l.name}</span>:{' '}
                      {!h || h.basis === 'default'
                        ? 'not enough history yet, so all of it, the next month'
                        : `up to ${pct(h.shareBps)}, about ${Math.max(1, h.lagMonths)} month${Math.max(1, h.lagMonths) === 1 ? '' : 's'} later`}
                    </li>
                  )
                })}
              </ul>
            </li>
          ) : null}
        </ul>
      </details>

      <details id="plan-settings" open={isNew} className="group bg-card ring-border/70 scroll-mt-4 rounded-2xl p-4 ring-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-base font-semibold">{isNew ? 'Create a plan' : 'Plan settings'}</span>
            <span className="text-muted-foreground block text-xs">{isNew ? 'Describe the loans you expect to make. The estimate is built from these guesses.' : `The guesses “${loaded[0].name}” is built on. Change them here.`}</span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-4">
          <PlanForm
            planId={loaded[0]?.id ?? null}
            values={toFormValues(loaded[0]?.plan ?? null, loaded[0]?.name ?? '', ctx.defaults)}
            defaultsNote={
              ctx.defaults.basedOn === 0
                ? 'Starts at 7%, 2%, collected at the end: no weekly-rate loans in the last 6 months to copy.'
                : `Copied from your usual loans (${ctx.defaults.basedOn} in the last 6 months). Change them if you like.`
            }
          />
        </div>
      </details>

      {loaded[0] ? (
        <section className="bg-card ring-border/70 space-y-3 rounded-2xl p-4 ring-1">
          <SectionHead
            title="Money in and out"
            purpose="Planning for a lender to add or take out money? Add it here and the estimate allows for it. Pretend only: nothing is recorded."
          />
          {loaded[0].moves.length === 0 ? (
            <p className="text-muted-foreground text-sm">None yet.</p>
          ) : (
            <ul className="divide-border/70 divide-y text-sm">
              {loaded[0].moves.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {name(m.lenderId)} {m.type === 'DEPOSIT' ? 'puts in' : 'takes out'} <Money amount={centavos(m.amountCentavos)} variant="display" />
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {m.everyMonth
                        ? `Every month from ${monthName(storedCalendarDate(m.fromMonth))}${m.untilMonth ? ` to ${monthName(storedCalendarDate(m.untilMonth))}` : ''}`
                        : `Once, in ${monthName(storedCalendarDate(m.fromMonth))}`}
                    </span>
                  </span>
                  <RemoveMoveButton moveId={m.id} />
                </li>
              ))}
            </ul>
          )}
          <details className="group">
            <summary className="text-brand flex min-h-11 cursor-pointer list-none items-center text-sm font-medium [&::-webkit-details-marker]:hidden">+ Add money in or out</summary>
            <div className="mt-3">
              <AddMoveForm planId={loaded[0].id} lenders={ctx.lenders.map((l) => ({ id: l.id, name: l.name }))} />
            </div>
          </details>
        </section>
      ) : null}

      {loaded[0] ? (
        <div className="flex justify-center pb-4">
          <DeletePlanButton planId={loaded[0].id} name={loaded[0].name} />
        </div>
      ) : null}
    </div>
  )
}

/** A section's title and ONE line on what it is for, so each card explains itself. */
function SectionHead({ title, purpose }: { title: string; purpose: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 text-sm">{purpose}</p>
    </div>
  )
}

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return <h2><StepBadge n={n}>{children}</StepBadge></h2>
}

/** "1 Pick a plan": a numbered step, so the page reads in the order it is used. */
function StepBadge({ n, light = false, children }: { n: number; light?: boolean; children: React.ReactNode }) {
  return (
    <span className={`relative flex items-center gap-2 text-sm font-semibold ${light ? 'text-white' : ''}`}>
      <span className={`flex size-5 items-center justify-center rounded-full text-[0.7rem] ${light ? 'bg-white/20' : 'bg-brand text-brand-foreground'}`} aria-hidden>{n}</span>
      {children}
    </span>
  )
}

/** One line of choices that scrolls sideways on a phone instead of wrapping into a block. */
function ScrollRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <div className="flex w-max gap-2 pb-0.5">{children}</div>
    </nav>
  )
}

function MonthArrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = 'flex size-11 items-center justify-center rounded-full bg-white/15'
  if (!href) return <span className={`${cls} opacity-40`} aria-hidden>{children}</span>
  return <Link href={href} scroll={false} aria-label={label} className={`${cls} hover:bg-white/25`}>{children}</Link>
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="bg-card ring-border/70 flex gap-2 rounded-2xl p-4 text-sm ring-1">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
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
