import Link from 'next/link'
import { ChevronRight, TrendingUp } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { IconChip } from '@/components/stat-tile.tsx'
import { RANGES, automaticPlan, forecastSafely, forecastView, rangeLabel } from '@/lib/money/forecast.ts'
import { projectionContext } from '@/server/projections/queries.ts'

/** The lender page offers the shorter time frames; the Projections page has them all. */
const LENDER_RANGES = RANGES.filter((r) => r <= 12)

/**
 * "What will this lender earn if things carry on" — on their own page, with
 * nothing to set up (owner, 2026-11-08).
 *
 * WHAT THE FIGURE IS (label-truth): forecastView(..., { kind: 'lender' }) of the
 * AUTOMATIC plan — the running loans plus new loans at the usual pace, split by
 * each lender's last-6-months share — interestToDate at the end of the chosen
 * time frame. This lender's OWN earnings only, not the Admin cut on their
 * capital. An estimate, and the card says so. Re-lending is off (see
 * automaticPlan), so nothing here compounds.
 */
export async function LenderProjection({
  userId,
  lenderId,
  lenderName,
  isSelf,
  range,
  rangeHref,
}: {
  userId: string
  lenderId: string
  lenderName: string
  /** The Admin's own pot: its figure is the Admin's OWN-money interest, not the Admin cut. */
  isSelf: boolean
  range: number
  rangeHref: (months: number) => string
}) {
  const ctx = await projectionContext(userId)
  const plan = automaticPlan(ctx.auto, ctx.defaults, range)
  const r = forecastSafely(
    { today: ctx.today, plan, lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits },
    { onTimeBps: ctx.onTime.bps, lateDelayDays: ctx.lateDelayDays },
  )
  if (!r.ok) return null
  const view = { kind: 'lender' as const, lenderId }
  const best = forecastView(r.value.best, view).at(-1)
  const late = r.value.realistic ? forecastView(r.value.realistic, view).at(-1) : null
  if (!best) return null
  const end = best.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

  return (
    <section id="projection" aria-labelledby="projection-title" className="bg-card ring-border/70 scroll-mt-4 space-y-3 rounded-2xl p-4 ring-1">
      <div className="flex items-start gap-3">
        <IconChip icon={TrendingUp} tint="violet" />
        <div className="min-w-0">
          <h2 id="projection-title" className="text-base font-semibold">Projected interest</h2>
          <p className="text-muted-foreground text-sm">If lending carries on like the last 6 months, without re-lending on top. An estimate.</p>
        </div>
      </div>

      <nav aria-label="How far ahead" className="flex flex-wrap gap-2">
        {LENDER_RANGES.map((m) => (
          <Link
            key={m}
            href={rangeHref(m)}
            scroll={false}
            aria-current={m === range ? 'page' : undefined}
            className="ring-border hover:bg-muted aria-[current=page]:bg-brand aria-[current=page]:text-brand-foreground aria-[current=page]:ring-brand inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ring-1"
          >
            {rangeLabel(m)}
          </Link>
        ))}
      </nav>

      <div>
        <p className="text-muted-foreground text-xs">
          {isSelf ? 'Estimated interest on the Admin’s own money (not the Admin cut)' : `${lenderName}’s estimated interest`}, from today to the end of {end}
        </p>
        <p className="text-2xl font-semibold tracking-tight"><Money amount={best.interestToDate} variant="display" /></p>
        {late ? (
          <p className="text-muted-foreground text-xs">
            If some pay late, like before: <Money amount={late.interestToDate} variant="display" />
          </p>
        ) : null}
      </div>

      <Link
        href={`/projections?view=lender&lender=${encodeURIComponent(lenderId)}&range=${range}`}
        className="text-brand inline-flex min-h-11 items-center gap-1 text-sm font-medium"
      >
        Month by month, or customize <ChevronRight className="size-4" aria-hidden />
      </Link>
    </section>
  )
}
