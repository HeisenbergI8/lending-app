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

const W = 640
const H = 220
const PAD = { left: 8, right: 8, top: 12, bottom: 24 }

/**
 * Running total of ESTIMATED interest, month by month, for one or more plans.
 *
 * WHAT IS DRAWN: ViewMonth.interestToDate from lib/money/forecast.ts — interest
 * that comes back from today through the end of each month, in the chosen view.
 * Not money in hand, not floating funds, and not interest earned on paper: a
 * month's figure is what would be COLLECTED in it. Best case solid, realistic
 * dashed, same colour per plan.
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
  const x = (i: number) => PAD.left + (i / Math.max(1, months.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => H - PAD.bottom - (v / top) * (H - PAD.top - PAD.bottom)
  const step = months.length > 1 ? x(1) - x(0) : W

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-72 w-full" role="img" aria-label="Estimated interest, running total by month">
      {target !== null ? (
        <line x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 4" />
      ) : null}
      {lines.map((line) => (
        <polyline
          key={line.key}
          fill="none"
          stroke={line.color}
          strokeWidth={2}
          strokeDasharray={line.dashed ? '6 4' : undefined}
          points={line.points.map((p, i) => `${x(i)},${y(p.interestToDate)}`).join(' ')}
        />
      ))}
      {months.map((m, i) => (
        <Link key={m.key} href={hrefFor(m.key)} scroll={false} aria-label={`Show ${m.key}`}>
          <rect x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" />
          {m.key === selected ? <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity={0.5} /> : null}
          {flagged.has(m.key) ? <path d={`M${x(i)} ${H - 6} l-4 -7 h8 z`} fill="currentColor" aria-hidden /> : null}
        </Link>
      ))}
      <text x={PAD.left} y={PAD.top} className="fill-muted-foreground text-[10px]">
        {formatPesos(top as Centavos)}
      </text>
      {/* Month labels on the first, middle and last points: enough to read the axis without crowding a phone. */}
      {[...new Set([0, Math.floor((months.length - 1) / 2), months.length - 1])].filter((i) => months[i]).map((i, n, all) => (
        <text
          key={months[i].key}
          x={x(i)}
          y={H - 6}
          textAnchor={n === 0 ? 'start' : n === all.length - 1 ? 'end' : 'middle'}
          className="fill-muted-foreground text-[10px]"
        >
          {months[i].month.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}
        </text>
      ))}
    </svg>
  )
}
