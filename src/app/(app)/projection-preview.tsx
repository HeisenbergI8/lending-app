import Link from 'next/link'
import { ChevronRight, TrendingUp } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { automaticPlan, forecastSafely, forecastView } from '@/lib/money/forecast.ts'
import { type ProjectionContext } from '@/server/projections/queries.ts'

const PREVIEW_MONTHS = 12

/**
 * WHAT THE FIGURES ARE (label-truth): forecastView(..., { kind: 'pot' }) of the
 * AUTOMATIC plan — the running loans plus new loans at the usual pace of the
 * last 6 months — every pot's interest plus the Admin cut, COLLECTED from today
 * to the end of the 12th calendar month (the current month counts as the
 * first), so the card names that month. Re-lending is off (see automaticPlan),
 * so nothing compounds. An estimate, and the card says so. Money already
 * overdue today is not in it, as on the Projections page.
 */
export function ProjectionPreview({ ctx }: { ctx: ProjectionContext }) {
  const r = forecastSafely(
    { today: ctx.today, plan: automaticPlan(ctx.auto, ctx.defaults, PREVIEW_MONTHS), lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits },
    { onTimeBps: ctx.onTime.bps, lateDelayDays: ctx.lateDelayDays },
  )
  if (!r.ok) return null
  const best = forecastView(r.value.best, { kind: 'pot' }).at(-1)
  const late = r.value.realistic ? forecastView(r.value.realistic, { kind: 'pot' }).at(-1) : null
  if (!best) return null
  const end = best.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  return (
    <Link href="/projections" className="bg-card ring-border/70 hover:shadow-hover block rounded-2xl p-4 ring-1 transition-shadow">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <TrendingUp className="size-3.5" aria-hidden /> Estimated interest from today to the end of {end}
      </p>
      <p className="text-xl font-semibold"><Money amount={best.interestToDate} variant="display" /></p>
      <p className="text-muted-foreground text-xs">
        {late ? <>If some pay late: <Money amount={late.interestToDate} variant="display" /> · </> : null}
        if you keep lending like the last 6 months
      </p>
      <p className="text-brand mt-2 flex items-center gap-1 text-xs font-medium">
        See projections <ChevronRight className="size-3.5" aria-hidden />
      </p>
    </Link>
  )
}
