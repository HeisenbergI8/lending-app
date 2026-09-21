import { type Centavos, centavos, formatPesos } from '@/lib/money/centavos.ts'
import { cn } from '@/lib/utils'

/**
 * The two charts this app draws, in plain HTML.
 *
 * NOT SVG, and not a charting library. Every figure here sits next to peso
 * amounts and month names, and text in an SVG scales with the drawing: on a
 * narrow phone the month labels came out smaller than everything around them.
 * Laid out as boxes, the text is ordinary text at an ordinary size.
 *
 * COLOUR CARRIES MEANING HERE, unlike the decorative chips. Series 1 is the
 * money that is working — out on loan, the capital handed over. Series 2 is what
 * comes of it — the idle cash it returned to, the interest it earned. The same
 * slot means the same thing on every chart in the app, so the legend does not
 * have to be re-learned per screen.
 *
 * Identity is never colour alone: both charts carry a legend, and every bar has
 * a title the browser shows on hover and a screen reader reads out.
 */

export type Series = { label: string; note?: string }

/** A month's two figures. `base` sits on the floor, `top` stacks on it. */
export type Column = { label: string; base: Centavos; top: Centavos }

const SERIES_FILL = ['bg-series-1', 'bg-series-2'] as const

/**
 * The key. Present whenever two things are drawn, without exception.
 *
 * The swatch carries the colour and the text stays in ordinary ink — a label
 * painted in the series colour is both harder to read and one more thing that
 * looks like it means something.
 */
export function ChartLegend({ series, className }: { series: [Series, Series]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {series.map((item, index) => (
        <li key={item.label} className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span className={cn('size-2.5 shrink-0 rounded-[3px]', SERIES_FILL[index])} aria-hidden />
          {item.label}
          {item.note ? <span className="text-muted-foreground/70">{item.note}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * One bar split in two — part, and the rest of the whole.
 *
 * For a pair of figures that add up to something, where the interesting thing is
 * the proportion rather than a trend. Two numbers alone cannot show you that the
 * interest is a fifth of what changed hands; the bar does it at a glance.
 *
 * The 2px gap between the segments is the surface showing through. A border
 * drawn round each one would add ink that is not data.
 */
export function SplitBar({
  series,
  values,
  className,
}: {
  series: [Series, Series]
  values: [Centavos, Centavos]
  className?: string
}) {
  const total = values[0] + values[1]

  if (total <= 0) {
    return (
      <div className={cn('bg-muted h-6 rounded-[4px]', className)} aria-hidden />
    )
  }

  const share = (value: number) => `${Math.max(0, (value / total) * 100)}%`

  return (
    <div
      className={cn('flex h-6 gap-0.5', className)}
      role="img"
      aria-label={`${series[0].label} ${formatPesos(values[0])}, ${series[1].label} ${formatPesos(values[1])}`}
    >
      {values[0] > 0 ? (
        <div
          className={cn(SERIES_FILL[0], 'rounded-l-[4px]', values[1] === 0 && 'rounded-r-[4px]')}
          style={{ width: share(values[0]) }}
          title={`${series[0].label}: ${formatPesos(values[0])}`}
        />
      ) : null}
      {values[1] > 0 ? (
        <div
          className={cn(SERIES_FILL[1], 'rounded-r-[4px]', values[0] === 0 && 'rounded-l-[4px]')}
          style={{ width: share(values[1]) }}
          title={`${series[1].label}: ${formatPesos(values[1])}`}
        />
      ) : null}
    </div>
  )
}

/**
 * Months across the bottom, two stacked figures per month.
 *
 * Every column is drawn against the tallest one in the set, so the shape is the
 * comparison. Only the tallest is labelled with its figure: a number over every
 * column is noise, and the rest are in the table underneath, which is there for
 * screen readers and is the honest answer to "what exactly was March".
 *
 * Columns are capped at 24px wide rather than filling their slot. A bar that
 * fills its share of the width turns the gaps into bars of their own.
 */
export function StackedColumns({
  columns,
  series,
  height = 'h-36',
  className,
}: {
  columns: Column[]
  series: [Series, Series]
  height?: string
  className?: string
}) {
  const totals = columns.map((column) => Math.max(0, column.base + column.top))
  const peak = Math.max(...totals, 0)

  if (peak === 0) {
    return (
      <p className={cn('text-muted-foreground bg-card/60 border-border rounded-xl border border-dashed p-6 text-center text-sm', className)}>
        Nothing to plot for these months yet.
      </p>
    )
  }

  const tallest = totals.indexOf(peak)

  return (
    <figure className={cn('space-y-2', className)}>
      {/* THREE ROWS, not one. The value label lives in its own row above the
          bars rather than inside a column with them: a bar's height is a
          percentage of the plot area, so a label sharing that box would push the
          tallest column — the 100% one, which is always the labelled one — out
          of the top of the chart. Same flex rules and the same gap in every row,
          so the three stay in step. */}
      <div className="flex gap-1">
        {columns.map((column, index) => (
          <div key={column.label} className="text-muted-foreground min-w-0 flex-1 truncate text-center text-[0.6rem] tabular-nums">
            {index === tallest ? formatPesos(centavos(totals[index])) : '\u00a0'}
          </div>
        ))}
      </div>

      <div className={cn('flex items-end gap-1', height)}>
        {columns.map((column, index) => {
          const total = totals[index]
          // The column's height is the TOTAL, and the base is drawn only up to
          // it. When the top figure is negative — a lender whose money is out
          // beyond what they put in — the column is honestly shorter than the
          // base alone rather than taller than the truth.
          const base = Math.min(Math.max(0, column.base), total)
          const top = Math.max(0, total - base)
          const label = `${column.label} · ${series[0].label} ${formatPesos(column.base)} · ${series[1].label} ${formatPesos(column.top)}`

          return (
            // The SLOT is flex-1 so it lines up with the label rows; the bar
            // inside it is capped at 24px and centred. A bar that filled its
            // whole slot would turn the gaps between them into bars of their own.
            <div key={column.label} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={label}>
              <div
                className="mx-auto flex w-full max-w-6 flex-col justify-end gap-0.5"
                style={{ height: `${(total / peak) * 100}%` }}
              >
                {top > 0 ? (
                  <div className={cn(SERIES_FILL[1], 'rounded-t-[4px]')} style={{ height: `${(top / total) * 100}%` }} />
                ) : null}
                {base > 0 ? (
                  <div className={cn(SERIES_FILL[0], top === 0 && 'rounded-t-[4px]')} style={{ height: `${(base / total) * 100}%` }} />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-border flex gap-1 border-t pt-1.5">
        {columns.map((column) => (
          <div key={column.label} className="text-muted-foreground min-w-0 flex-1 truncate text-center text-[0.6rem]">
            {column.label}
          </div>
        ))}
      </div>

      <ChartLegend series={series} />

      {/* The figures themselves, for anyone who cannot see the columns. */}
      <table className="sr-only">
        <caption>
          {series[0].label} and {series[1].label}, by month
        </caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>{series[0].label}</th>
            <th>{series[1].label}</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.label}>
              <th>{column.label}</th>
              <td>{formatPesos(column.base)}</td>
              <td>{formatPesos(column.top)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
