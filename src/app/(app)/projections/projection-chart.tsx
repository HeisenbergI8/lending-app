import Link from 'next/link'

import { type Centavos, formatPesos } from '@/lib/money/centavos.ts'
import { type ViewMonth } from '@/lib/money/forecast.ts'

export type ChartLine = {
  key: string
  label: string
  /** var(--series-N). Never a status colour. */
  color: string
  dashed: boolean
  points: ViewMonth[]
}

const W = 600
const H = 200

/**
 * Running total of ESTIMATED interest, month by month, for one or more plans.
 *
 * WHAT IS DRAWN: ViewMonth.interestToDate from lib/money/forecast.ts — interest
 * that comes back from today through the end of each month, in the chosen view.
 * Best case solid, realistic dashed, same colour per plan.
 *
 * WHY THE TEXT IS HTML, NOT SVG: the drawing stretches to the card's width
 * (preserveAspectRatio="none"), so SVG text would shrink to an unreadable few
 * pixels on a phone. Lines keep their weight with non-scaling-stroke; every
 * label sits in ordinary HTML around the drawing, at a readable size.
 */
export function ProjectionChart({
  lines,
  selected,
  hrefFor,
  target,
  flagged,
}: {
  lines: ChartLine[]
  selected: string
  hrefFor: (monthKey: string) => string
  target: Centavos | null
  /** Month keys with a cash warning on the first plan. */
  flagged: ReadonlySet<string>
}) {
  const months = lines[0]?.points ?? []
  const top = Math.max(1, target ?? 0, ...lines.flatMap((l) => l.points.map((p) => p.interestToDate)))
  const x = (i: number) => (i / Math.max(1, months.length - 1)) * W
  const y = (v: number) => H - (v / top) * H
  const short = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' })
  const ticks = [...new Set([0, Math.floor((months.length - 1) / 2), months.length - 1])].filter((i) => months[i])

  return (
    <figure className="space-y-2">
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>{formatPesos(top as Centavos)}</span>
        <span>Tap a month to see its figures</span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-44 w-full overflow-visible sm:h-56"
          role="img"
          aria-label="Estimated interest, running total by month"
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="currentColor" strokeOpacity={0.08} vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={H} y2={H} stroke="currentColor" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />
          {target !== null ? (
            <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="currentColor" strokeOpacity={0.45} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ) : null}
          {months.map((m, i) =>
            flagged.has(m.key) ? (
              <line key={`f-${m.key}`} x1={x(i)} x2={x(i)} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            ) : null,
          )}
          {lines.map((line) => (
            <polyline
              key={line.key}
              fill="none"
              stroke={line.color}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeDasharray={line.dashed ? '6 4' : undefined}
              vectorEffect="non-scaling-stroke"
              points={line.points.map((p, i) => `${x(i)},${y(p.interestToDate)}`).join(' ')}
            />
          ))}
          {months.map((m, i) =>
            m.key === selected ? (
              <line key={`s-${m.key}`} x1={x(i)} x2={x(i)} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
            ) : null,
          )}
        </svg>
        {/* Tap targets: one column per month, laid over the drawing in HTML so each is a real link. */}
        <div className="absolute inset-0 flex">
          {months.map((m) => (
            <Link key={m.key} href={hrefFor(m.key)} scroll={false} aria-label={`Show ${m.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}`} className="flex-1" />
          ))}
        </div>
      </div>
      <div className="text-muted-foreground relative h-4 text-xs">
        {ticks.map((i, n) => (
          <span
            key={months[i].key}
            className="absolute whitespace-nowrap"
            style={{
              left: `${(i / Math.max(1, months.length - 1)) * 100}%`,
              transform: n === 0 ? 'none' : n === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {short(months[i].month)}
          </span>
        ))}
      </div>
      {flagged.size > 0 ? <p className="text-muted-foreground text-xs">Dashed upright lines mark months with a cash warning.</p> : null}
    </figure>
  )
}

/** The legend: a drawn swatch of each line, so solid and dashed read without colour alone. */
export function ChartLegend({ lines }: { lines: ChartLine[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {lines.map((l) => (
        <li key={l.key} className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden className="shrink-0">
            <line x1="1" x2="21" y1="3" y2="3" stroke={l.color} strokeWidth="2.5" strokeDasharray={l.dashed ? '4 3' : undefined} />
          </svg>
          <span>{l.label}</span>
        </li>
      ))}
    </ul>
  )
}
