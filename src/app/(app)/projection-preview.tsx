import Link from 'next/link'
import { TrendingUp } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { DEFAULT_HORIZON_MONTHS, type Plan, forecastSafely, forecastView } from '@/lib/money/forecast.ts'
import { type ProjectionContext } from '@/server/projections/queries.ts'

const PREVIEW_MONTHS = 12

/**
 * WHAT THE FIGURES ARE (label-truth). The window is today to the end of the
 * 12th calendar month (the current month counts as the first), so the title
 * names that month rather than saying "next 12 months".: forecastView(..., { kind: 'pot' }) for the
 * newest saved plan, or for the running loans alone when none is saved — every
 * pot's interest plus the Admin cut, COLLECTED from today to the end of the
 * 12th month. An estimate, and the card says so in its title. Money already
 * overdue today is not in it, as on the Projections page.
 */
export function ProjectionPreview({ ctx, plan, planName }: { ctx: ProjectionContext; plan: Plan | null; planName: string | null }) {
  const p: Plan = plan ?? {
    horizonMonths: DEFAULT_HORIZON_MONTHS, newLoansPerMonth: 0, loanAmount: centavos(1), termWeeks: 1,
    borrowerRateBps: ctx.defaults.borrowerRateBps, adminCutBps: ctx.defaults.adminCutBps,
    collection: 'AT_END', relend: false, moves: [],
  }
  const r = forecastSafely(
    { today: ctx.today, plan: { ...p, horizonMonths: PREVIEW_MONTHS }, lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits },
    { onTimeBps: ctx.onTime.bps, lateDelayDays: ctx.lateDelayDays },
  )
  // Too large to calculate: the dashboard must still load. Say so; the page explains.
  if (!r.ok) {
    return (
      <Link href="/projections" className="bg-card block rounded-2xl p-4 ring-1 ring-border/70">
        <p className="text-muted-foreground flex items-center gap-1 text-xs"><TrendingUp className="size-3.5" /> Estimated interest</p>
        <p className="text-sm">Plan “{planName}” grows too large to calculate. Open Projections to change it.</p>
      </Link>
    )
  }
  const f = r.value
  const best = forecastView(f.best, { kind: 'pot' }).at(-1)
  const realistic = f.realistic ? forecastView(f.realistic, { kind: 'pot' }).at(-1) : null
  // With re-lending on, most of the headline can be money assumed lent AGAIN
  // (data-truth, 2026-11-08: ~95% on the demo). So the same plan without
  // re-lending is shown beside it, and the headline says which it is.
  // Running loans alone never overflow, and neither does a plan without re-lending at 12 months.
  const plain = p.relend
    ? forecastSafely(
        { today: ctx.today, plan: { ...p, relend: false, horizonMonths: PREVIEW_MONTHS }, lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits },
        { onTimeBps: null, lateDelayDays: null },
      )
    : null
  const withoutRelend = plain?.ok ? forecastView(plain.value.best, { kind: 'pot' }).at(-1) : null
  const end = best ? best.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : ''
  return (
    <Link href="/projections" className="bg-card block rounded-2xl p-4 ring-1 ring-border/70">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <TrendingUp className="size-3.5" /> Estimated interest from today to the end of {end}{p.relend ? ', with re-lending' : ''}
      </p>
      <p className="text-xl font-semibold"><Money amount={best?.interestToDate ?? centavos(0)} variant="display" /></p>
      <p className="text-muted-foreground text-xs">
        {realistic ? <>Realistic: <Money amount={realistic.interestToDate} variant="display" /> · </> : null}
        {planName ? `plan “${planName}”` : 'running loans only, no new loans'}
      </p>
      {withoutRelend ? (
        <p className="text-muted-foreground text-xs">
          Without re-lending: <Money amount={withoutRelend.interestToDate} variant="display" />
        </p>
      ) : null}
    </Link>
  )
}
