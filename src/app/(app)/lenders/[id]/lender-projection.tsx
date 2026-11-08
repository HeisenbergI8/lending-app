import Link from 'next/link'
import { ChevronRight, TrendingUp } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { IconChip } from '@/components/stat-tile.tsx'
import { RANGES, rangeLabel } from '@/lib/money/forecast.ts'
import { simpleForecast } from '@/lib/money/simple-forecast.ts'
import { projectionContext, simpleInput } from '@/server/projections/queries.ts'

/** The lender page offers the shorter time frames; the Projections page has them all. */
const LENDER_RANGES = RANGES.filter((r) => r <= 12)

/**
 * "What will this lender earn if things carry on" — on their own page, with
 * nothing to set up (owner, 2026-11-08).
 *
 * WHAT THE FIGURE IS (label-truth): simpleForecast (lib/money/simple-forecast.ts),
 * kind 'lender': each month the larger of what this lender's running loans pay
 * and their usual interest a month over the last 6 months; the total is from
 * today to the end of the chosen time frame. A lender's OWN earnings only; on
 * the Admin's own page, the Admin's earnings plus the Admin cut. The pot is
 * their capital today plus that interest. An estimate, and the card says so.
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
  /** The Admin's own pot: its figure is the Admin's own-money interest PLUS the Admin cut (simpleForecast). */
  isSelf: boolean
  range: number
  rangeHref: (months: number) => string
}) {
  const ctx = await projectionContext(userId)
  const f = simpleForecast(simpleInput(ctx, range), { kind: 'lender', lenderId }, ctx.auto.basedOn)
  const best = f.months.at(-1)
  if (!best) return null
  const perMonth = Math.round(f.total / f.months.length)
  const end = best.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

  return (
    <section id="projection" aria-labelledby="projection-title" className="bg-card ring-border/70 scroll-mt-4 space-y-3 rounded-2xl p-4 ring-1">
      <div className="flex items-start gap-3">
        <IconChip icon={TrendingUp} tint="violet" />
        <div className="min-w-0">
          <h2 id="projection-title" className="text-base font-semibold">Projected interest</h2>
          <p className="text-muted-foreground text-sm">If lending carries on like the last 6 months. An estimate.</p>
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
          {isSelf ? 'The Admin’s estimated interest, own money plus the Admin cut' : `${lenderName}’s estimated interest (their own earnings)`}, from today to the end of {end}
        </p>
        <p className="text-2xl font-semibold tracking-tight"><Money amount={f.total} variant="display" /></p>
        <p className="text-muted-foreground text-xs">
          About <Money amount={centavos(perMonth)} variant="display" /> a month · pot by then <Money amount={best.pot} variant="display" /> (capital + earnings)
        </p>
      </div>

      <Link
        href={`/projections?view=lender&lender=${encodeURIComponent(lenderId)}&range=${range}`}
        className="text-brand inline-flex min-h-11 items-center gap-1 text-sm font-medium"
      >
        Month by month <ChevronRight className="size-4" aria-hidden />
      </Link>
    </section>
  )
}
