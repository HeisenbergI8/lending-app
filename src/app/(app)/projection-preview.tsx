import Link from 'next/link'
import { ChevronRight, TrendingUp } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { simpleForecast } from '@/lib/money/simple-forecast.ts'
import { type ProjectionContext, simpleInput } from '@/server/projections/queries.ts'

const PREVIEW_MONTHS = 12

/**
 * WHAT THE FIGURES ARE (label-truth): simpleForecast (lib/money/simple-forecast.ts)
 * for the whole pot over 12 calendar months, the current one counting as the
 * first: each month the larger of what running loans pay and the usual pace of
 * the last 6 months. "A month" is that total over the 12 months. An estimate,
 * and the card says so. Money already overdue today is not in it.
 */
export function ProjectionPreview({ ctx }: { ctx: ProjectionContext }) {
  const f = simpleForecast(simpleInput(ctx, PREVIEW_MONTHS), { kind: 'pot' }, ctx.newLoans)
  const last = f.months.at(-1)
  if (!last) return null
  const end = last.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  return (
    <Link href="/projections" className="bg-card ring-border/70 hover:shadow-hover block rounded-2xl p-4 ring-1 transition-shadow">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <TrendingUp className="size-3.5" aria-hidden /> Estimated interest, whole pot, a month
      </p>
      <p className="text-xl font-semibold"><Money amount={centavos(Math.round(f.total / f.months.length))} variant="display" /></p>
      <p className="text-muted-foreground text-xs">
        <Money amount={f.total} variant="display" /> from today to the end of {end}, if you keep lending like the last 6 months
      </p>
      <p className="text-brand mt-2 flex items-center gap-1 text-xs font-medium">
        See projections <ChevronRight className="size-3.5" aria-hidden />
      </p>
    </Link>
  )
}
