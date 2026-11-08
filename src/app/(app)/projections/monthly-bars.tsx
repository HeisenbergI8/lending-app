import { compactPesos } from '@/lib/money/compact.ts'
import { type SimpleMonth } from '@/lib/money/simple-forecast.ts'

/**
 * Estimated interest per month, one bar each. HTML, not SVG: the bars are plain
 * boxes sized by percentage, so they and their labels stay readable at any width.
 *
 * WHAT IS DRAWN: SimpleMonth.interest from lib/money/simple-forecast.ts —
 * interest that comes in DURING each month, in the chosen view. An estimate.
 */
export function MonthlyBars({ months }: { months: readonly SimpleMonth[] }) {
  const top = Math.max(1, ...months.map((m) => m.interest))
  const label = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short' })
  // Every month gets a name up to a year; past that, every third, so they never crowd.
  const every = months.length > 12 ? 3 : 1
  return (
    <figure className="space-y-1" aria-label="Estimated interest each month">
      <div className="text-muted-foreground text-xs">{compactPesos(top)}</div>
      <div className="border-border/70 flex h-40 items-end gap-1 border-b sm:h-48">
        {months.map((m) => (
          <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${m.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}: ${compactPesos(m.interest)}`}>
            <div className="bg-brand/80 w-full rounded-t-sm" style={{ height: `${(m.interest / top) * 100}%`, minHeight: m.interest > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground flex gap-1 text-[0.65rem]" aria-hidden>
        {months.map((m, i) => (
          <span key={m.key} className="min-w-0 flex-1 text-center">{i % every === 0 ? label(m.month) : ''}</span>
        ))}
      </div>
    </figure>
  )
}
