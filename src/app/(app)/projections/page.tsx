import Link from 'next/link'
import { AlertTriangle, ChevronDown, SlidersHorizontal } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { IconChip } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'
import { type Centavos, centavos, formatPesos, parsePesos } from '@/lib/money/centavos.ts'
import { HISTORY_MONTHS, historyWindowStart } from '@/lib/money/forecast-history.ts'
import {
  DEFAULT_RANGE,
  type Plan,
  RANGES,
  automaticPlan,
  rangeLabel,
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
  const range = RANGES.find((r) => String(r) === one('range')) ?? DEFAULT_RANGE
  // AUTOMATIC FIRST (owner, 2026-11-08): with no choice made, the page projects
  // "carry on lending the way you have been" — nothing to fill in. A saved plan is
  // used only when picked; "Customize" is how one is made.
  const pickedId = one('plan') && one('plan') !== 'auto' ? (one('plan') as string) : null
  const loaded = pickedId ? await plansById(user.id, [pickedId]) : []
  const custom = loaded[0] ?? null
  const auto = automaticPlan(ctx.auto, ctx.defaults, range)
  // The time frame is the page's, whichever plan is drawn.
  const current = custom
    ? { id: custom.id, name: custom.name, plan: { ...custom.plan, horizonMonths: range } }
    : { id: 'auto', name: 'Your usual lending', plan: auto }

  const admin = ctx.lenders.find((l) => l.isSelf)
  const view: View =
    one('view') === 'admin' ? { kind: 'admin-cut' }
    : one('view') === 'lender' ? { kind: 'lender', lenderId: one('lender') ?? admin?.id ?? '' }
    : { kind: 'pot' }

  // A plan that compounds past safe whole-number arithmetic (long horizon +
  // re-lending) is reported and the running loans drawn instead, rather than
  // crashing the page: it must still load so that plan can be changed or deleted.
  const run = (plan: Plan) => {
    const input = { today: ctx.today, plan, lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits }
    const r = forecastSafely(input, { onTimeBps: ctx.onTime.bps, lateDelayDays: ctx.lateDelayDays })
    if (!r.ok) return null
    return { f: r.value, best: forecastView(r.value.best, view), realistic: r.value.realistic ? forecastView(r.value.realistic, view) : null }
  }
  const realOnly: Plan = { ...auto, newLoansPerMonth: 0, relend: false }
  const attempted = run(current.plan)
  const tooLarge = attempted === null
  const first = attempted ?? (run(realOnly) as NonNullable<ReturnType<typeof run>>)
  const drawnPlan = tooLarge ? realOnly : current.plan
  // Re-lending can be most of an estimate (data-truth, 2026-11-08): when it is on,
  // the same plan without it is shown beside every figure.
  const plain = drawnPlan.relend ? run({ ...drawnPlan, relend: false }) : null

  const lastKey = first.best.at(-1)?.key ?? monthKey(ctx.today)
  const best = monthOf(first.best, one('month') ?? lastKey) ?? (first.best.at(-1) as (typeof first.best)[number])
  const atEnd = best.key === lastKey
  const realistic = first.realistic ? monthOf(first.realistic, best.key) : null
  const plainMonth = plain ? monthOf(plain.best, best.key) : null
  const targetParsed = one('target') ? parsePesos(one('target') as string) : null
  const target: Centavos | null = targetParsed?.ok ? targetParsed.value : null
  const targetKind: TargetKind = one('targetKind') === 'pot' && view.kind !== 'admin-cut' ? 'pot' : 'interest'

  const withRelend = drawnPlan.relend ? ', with re-lending' : ''
  const lines: ChartLine[] = [
    { key: 'best', label: `Everyone pays on time${withRelend}`, color: SERIES[0], dashed: false, points: first.best },
    ...(first.realistic ? [{ key: 'real', label: `Some pay late, like before${withRelend}`, color: SERIES[0], dashed: true, points: first.realistic }] : []),
  ]
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
     (realRows) and the plan's inputs — the automatic plan unless one is picked.
     "Interest" is money COLLECTED, in the chosen view:
       pot        LenderMonth.interest + adminCut, every pot
       admin      LenderMonth.adminCut on the Admin pot — the cut only
       lender     that pot's own LenderMonth.interest (its share of new loans
                  follows its 6-month capital share)
     The hero is interestToDate: from TODAY to the end of the month, not since
     lending began. Money already late today is in NEITHER line. */

  const viewName = view.kind === 'pot' ? 'the whole pot' : view.kind === 'admin-cut' ? 'the Admin cut' : name(view.lenderId)
  const warnMonths = first.best.filter((m) => m.warnings.length > 0)
  const late = lateInView(first.f.best, view)
  const shortDate = (d: Date) => d.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })
  const chip = 'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted aria-[current=page]:bg-brand aria-[current=page]:text-brand-foreground aria-[current=page]:ring-brand'
  const p = drawnPlan
  const planSentence =
    p.newLoansPerMonth === 0
      ? 'No new loans: just the loans running today.'
      : `About ${p.newLoansPerMonth} new loan${p.newLoansPerMonth === 1 ? '' : 's'} a month of ${formatPesos(p.loanAmount)}, for ${p.termWeeks} week${p.termWeeks === 1 ? '' : 's'}, at ${pct(p.borrowerRateBps)} a week${p.relend ? ', re-lending returned money' : ''}.`

  return (
    // [overflow-wrap:anywhere]: a plan name is free text, and one long word must wrap, not widen a phone screen.
    <div className="mx-auto max-w-3xl space-y-5 [overflow-wrap:anywhere]">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Projections</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What you could earn if you keep lending the way you have been. Estimates, not promises.
        </p>
      </header>

      {/* TWO TAPS, NOTHING TO FILL IN: whose money, and how far ahead. */}
      <section className="bg-card ring-border/70 space-y-4 rounded-2xl p-4 ring-1">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Whose money</h2>
          <ScrollRow label="Whose money">
            <Link href={href({ view: 'pot', lender: null, month: null })} aria-current={view.kind === 'pot' ? 'page' : undefined} className={chip}>Whole pot</Link>
            <Link href={href({ view: 'admin', lender: null, month: null })} aria-current={view.kind === 'admin-cut' ? 'page' : undefined} className={chip}>Admin cut</Link>
            {ctx.lenders.map((l) => (
              <Link key={l.id} href={href({ view: 'lender', lender: l.id, month: null })} aria-current={view.kind === 'lender' && view.lenderId === l.id ? 'page' : undefined} className={chip}>
                {l.name}
              </Link>
            ))}
          </ScrollRow>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">How far ahead</h2>
          <ScrollRow label="How far ahead">
            {RANGES.map((r) => (
              <Link key={r} href={href({ range: String(r), month: null })} aria-current={r === range ? 'page' : undefined} className={chip}>
                {rangeLabel(r)}
              </Link>
            ))}
          </ScrollRow>
        </div>
      </section>

      {tooLarge ? (
        <Notice>
          “{current.name}” grows too large to calculate, because re-lending compounds every month. Showing the running loans only.
          Pick a shorter time frame, or turn re-lending off under Customize.
        </Notice>
      ) : null}
      {first.f.best.refused ? <Notice>{first.f.best.refused}</Notice> : null}

      {/* THE ANSWER. One hero, read as a sentence. interestToDate: from TODAY to
          the end of the month, not since lending began. */}
      <section aria-label="The estimate" className="space-y-3">
        <div className="bg-hero shadow-rest relative overflow-hidden rounded-2xl p-5 text-white">
          <span className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <p className="relative flex flex-wrap gap-1.5 text-xs font-medium">
            <span className="rounded-full bg-white/15 px-2 py-0.5">Estimate</span>
            {drawnPlan.relend ? <span className="rounded-full bg-white/15 px-2 py-0.5">Includes re-lending</span> : null}
          </p>
          <p className="relative mt-3 text-sm text-white/90">
            {atEnd ? `In the next ${range === 12 ? 'year' : rangeLabel(range)}, if everyone pays on time,` : 'If everyone pays on time,'} {viewName} would collect an estimated
          </p>
          <p className="relative mt-1 text-4xl font-semibold tracking-tight">
            <Money amount={best.interestToDate} variant="display" />
          </p>
          <p className="relative mt-1 text-sm text-white/90">in interest, from today to the end of {monthName(best.month)}.</p>
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
          {!atEnd ? (
            <Link href={href({ month: null })} scroll={false} className="relative mt-3 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2">
              Back to the end of the time frame
            </Link>
          ) : null}
        </div>

        {/* WHAT IT ASSUMES, in one line, with the one button that changes it. */}
        <div className="bg-card ring-border/70 flex flex-col gap-3 rounded-2xl p-4 ring-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">
              {custom ? `Your plan “${custom.name}”` : ctx.auto.basedOn > 0 ? `Based on your last ${HISTORY_MONTHS} months (${ctx.auto.basedOn} new loans)` : 'No new loans in the last 6 months'}
            </p>
            <p className="mt-0.5 text-sm">{planSentence}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {custom ? (
              <Link href={href({ plan: null, customize: null, month: null })} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-border hover:bg-muted">
                Use automatic
              </Link>
            ) : null}
            <Link href={`${href({ customize: '1' })}#customize`} className="bg-brand text-brand-foreground inline-flex min-h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium">
              <SlidersHorizontal className="size-4" aria-hidden /> Customize
            </Link>
          </div>
        </div>

        {warnMonths.length > 0 ? (
          <div className="bg-card ring-border/70 flex gap-3 rounded-2xl p-4 ring-1">
            <IconChip icon={AlertTriangle} tint="amber" />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-semibold">Not enough free cash in {warnMonths.length === 1 ? '1 month' : `${warnMonths.length} months`}</p>
              <ul className="text-muted-foreground space-y-0.5">
                {warnMonths.slice(0, 3).map((m) => (
                  <li key={m.key}>
                    <Link href={href({ month: m.key })} scroll={false} className="text-foreground font-medium">{monthName(m.month)}</Link>:{' '}
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
          title="Month by month"
          purpose="The line adds up estimated interest from today. Tap the chart to see any month."
        />
        {/* The chart's dotted target line is drawn only for an interest target: a pot-size
            target is on a different scale from the running interest the chart plots. */}
        <ProjectionChart lines={lines} selected={best.key} hrefFor={(key) => href({ month: key })} target={targetKind === 'interest' ? target : null} flagged={flagged} />
        <ChartLegend lines={lines} />
        {best.potSize !== null ? (
          <p className="text-muted-foreground border-border/70 border-t pt-3 text-sm">
            Estimated pot size at the end of {monthName(best.month)}{withRelend}: <span className="text-foreground font-semibold"><Money amount={best.potSize} variant="display" /></span>
            <span className="block text-xs">Cash plus money out on loan.</span>
          </p>
        ) : null}
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
            const say = (m: typeof b) => (m ? monthName(m.month) : `Not within ${rangeLabel(range)}`)
            return (
              <div className="bg-muted/50 space-y-1.5 rounded-xl p-3 text-sm">
                <p className="text-muted-foreground text-xs">Estimated month{withRelend}</p>
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
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="text-muted-foreground mt-3 list-disc space-y-2 pl-4 text-sm">
          <li>Starts from the loans running today. New loans are added from next month.</li>
          {custom ? null : (
            <li>
              The automatic plan copies your new loans since {shortDate(historyWindowStart(ctx.today))}: how many a month, the average amount, the usual length and rate.
              It does not re-lend on top, because those loans already include money you re-lent.
            </li>
          )}
          <li>A lender’s share of new loans follows how much they put into loans in the last {HISTORY_MONTHS} months.</li>
          <li>
            {ctx.onTime.bps === null
              ? `“If some pay late” is not shown: nothing fell due in the last ${HISTORY_MONTHS} months to measure.`
              : `“If some pay late”: ${pct(ctx.onTime.bps)} of ${ctx.onTime.counted} amounts due since ${shortDate(ctx.onTime.from)} were paid on or before their due day. The rest is counted ${ctx.lateDelayDays ?? 30} days later${ctx.lateDelayDays === null ? ' (a guess: no late payment has come in yet)' : ' (the usual delay)'}.`}
          </li>
          {/* lateInView: the overdue money that belongs to THIS view's money, not always the whole pot's. */}
          {late > 0 ? <li>Not counted anywhere: <Money amount={late} variant="display" /> already overdue today.</li> : null}
          {drawnPlan.relend ? (
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

      {/* CUSTOMIZE: closed until asked for. Opens filled in with what is being
          projected now, so only the one thing to change needs touching. */}
      <details id="customize" open={one('customize') === '1'} className="group bg-card ring-border/70 scroll-mt-4 rounded-2xl p-4 ring-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-base font-semibold">Customize</span>
            <span className="text-muted-foreground block text-xs">Change what the estimate assumes, and save it as your own plan.</span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-4 space-y-5">
          {saved.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Your saved plans</p>
              <ScrollRow label="Saved plans">
                <Link href={href({ plan: null, month: null })} aria-current={custom ? undefined : 'page'} className={chip}>Automatic</Link>
                {saved.map((s) => (
                  <Link key={s.id} href={href({ plan: s.id, month: null })} aria-current={s.id === custom?.id ? 'page' : undefined} className={chip}>{s.name}</Link>
                ))}
              </ScrollRow>
            </div>
          ) : null}
          <PlanForm
            key={custom?.id ?? 'auto'}
            planId={custom?.id ?? null}
            values={toFormValues(custom ? custom.plan : auto, custom?.name ?? '')}
            defaultsNote={custom ? 'Change anything, then save.' : 'Filled in from your usual lending. Change what you like, give it a name, and save.'}
          />
          {custom ? (
            <div className="border-border/70 space-y-3 border-t pt-4">
              <SectionHead
                title="Money in and out"
                purpose="Planning for a lender to add or take out money? Add it here and the estimate allows for it. Pretend only: nothing is recorded."
              />
              {custom.moves.length === 0 ? (
                <p className="text-muted-foreground text-sm">None yet.</p>
              ) : (
                <ul className="divide-border/70 divide-y text-sm">
                  {custom.moves.map((m) => (
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
              <details className="group/add">
                <summary className="text-brand flex min-h-11 cursor-pointer list-none items-center text-sm font-medium [&::-webkit-details-marker]:hidden">+ Add money in or out</summary>
                <div className="mt-3">
                  <AddMoveForm planId={custom.id} lenders={ctx.lenders.map((l) => ({ id: l.id, name: l.name }))} />
                </div>
              </details>
              <div className="flex justify-center">
                <DeletePlanButton planId={custom.id} name={custom.name} />
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  )
}

/** A plan as the strings the form shows. A new plan starts from the automatic one. */
function toFormValues(plan: Plan, name: string) {
  const pctText = (bps: number) => String(bps / 100)
  return {
    name,
    newLoansPerMonth: plan.newLoansPerMonth,
    // 0 is stored for a plan with no new loans: show it blank, which the form accepts there.
    loanAmount: plan.loanAmount > 0 ? String(plan.loanAmount / 100) : '',
    termWeeks: plan.termWeeks,
    borrowerRate: pctText(plan.borrowerRateBps),
    adminCut: pctText(plan.adminCutBps),
    interestCollection: plan.collection,
    relend: plan.relend,
    // The page's time frame is what is drawn; this only keeps the stored column as it was.
    horizonMonths: plan.horizonMonths,
  }
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



/** One line of choices that scrolls sideways on a phone instead of wrapping into a block. */
function ScrollRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className="-mx-4 -my-1 overflow-x-auto px-4 [scrollbar-width:none]">
      <div className="flex w-max gap-2 py-1">{children}</div>
    </nav>
  )
}


function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="bg-card ring-border/70 flex gap-2 rounded-2xl p-4 text-sm ring-1">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}
