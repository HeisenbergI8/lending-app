import Link from 'next/link'
import { TrendingUp } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { DEFAULT_HORIZON_MONTHS, type Plan, forecastSafely, forecastView } from '@/lib/money/forecast.ts'
import { type ProjectionContext } from '@/server/projections/queries.ts'

const PREVIEW_MONTHS = 12

/**
 * WHAT THE FIGURES ARE (label-truth): forecastView(..., { kind: 'pot' }) for the
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
        <p className="text-muted-foreground flex items-center gap-1 text-xs"><TrendingUp className="size-3.5" /> Estimated interest, next {PREVIEW_MONTHS} months</p>
        <p className="text-sm">Plan “{planName}” grows too large to calculate. Open Projections to change it.</p>
      </Link>
    )
  }
  const f = r.value
  const best = forecastView(f.best, { kind: 'pot' }).at(-1)
  const realistic = f.realistic ? forecastView(f.realistic, { kind: 'pot' }).at(-1) : null
  return (
    <Link href="/projections" className="bg-card block rounded-2xl p-4 ring-1 ring-border/70">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <TrendingUp className="size-3.5" /> Estimated interest, next {PREVIEW_MONTHS} months
      </p>
      <p className="text-xl font-semibold"><Money amount={best?.interestToDate ?? centavos(0)} variant="display" /></p>
      <p className="text-muted-foreground text-xs">
        {realistic ? <>Realistic: <Money amount={realistic.interestToDate} variant="display" /> · </> : null}
        {planName ? `plan “${planName}”` : 'running loans only, no new loans'}
      </p>
    </Link>
  )
}
