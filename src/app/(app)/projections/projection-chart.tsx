import Link from 'next/link'

import { type Centavos } from '@/lib/money/centavos.ts'
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
 * "₱21.6K", "₱1.64M": axis and callout labels only, where a full ₱1,636,023.20
 * would not fit beside a phone-width chart. Never used for a figure the Admin
 * acts on — those go through <Money> in the tiles above.
 */
export function compactPesos(c: number): string {
  const pesos = c / 100
  const abs = Math.abs(pesos)
  const fmt = (n: number, unit: string) => `₱${Number(n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)).toLocaleString('en-PH')}${unit}`
  if (abs >= 1e9) return fmt(pesos / 1e9, 'B')
  if (abs >= 1e6) return fmt(pesos / 1e6, 'M')
  if (abs >= 1e3) return fmt(pesos / 1e3, 'K')
  return `₱${Math.round(pesos).toLocaleString('en-PH')}`
}

/**
 * Running total of ESTIMATED interest, month by month, for one or more plans.
 *
 * WHAT IS DRAWN: ViewMonth.interestToDate from lib/money/forecast.ts — interest
 * that comes back from today through the end of each month, in the chosen view.
 * Best case solid with a soft fill, realistic dashed, same colour per plan.
 *
 * WHY THE TEXT AND DOTS ARE HTML, NOT SVG: the drawing stretches to the card's
 * width (preserveAspectRatio="none"), so SVG text would shrink to a few pixels
 * on a phone and SVG circles would squash into ellipses. Lines keep their weight
 * with non-scaling-stroke; labels and dots sit in HTML over the drawing, placed
 * by percentage, so they stay round and readable at any width.
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
  const top = niceTop(Math.max(1, target ?? 0, ...lines.flatMap((l) => l.points.map((p) => p.interestToDate))))
  const xPct = (i: number) => (i / Math.max(1, months.length - 1)) * 100
  const yPct = (v: number) => 100 - (v / top) * 100
  const x = (i: number) => (xPct(i) / 100) * W
  const y = (v: number) => (yPct(v) / 100) * H
  const short = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' })
  const ticks = [...new Set([0, Math.floor((months.length - 1) / 2), months.length - 1])].filter((i) => months[i])
  const at = months.findIndex((m) => m.key === selected)
  const first = lines[0]
  const picked = at >= 0 && first ? first.points[at] : null

  return (
    <figure className="space-y-2">
      <div className="flex gap-2 pt-2">
        {/* Y axis: three readable amounts, top / middle / zero. */}
        <div className="text-muted-foreground relative w-12 shrink-0 text-[0.7rem]" aria-hidden>
          {[1, 0.5, 0].map((f) => (
            <span key={f} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(1 - f) * 100}%` }}>
              {compactPesos(top * f)}
            </span>
          ))}
        </div>

        <div className="relative h-48 min-w-0 flex-1 sm:h-60">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 block h-full w-full overflow-visible"
            role="img"
            aria-label={`Estimated interest, running total by month. ${picked ? `${compactPesos(picked.interestToDate)} by the end of ${picked.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}.` : ''}`}
          >
            {[0, 0.5].map((f) => (
              <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="currentColor" strokeOpacity={0.08} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} x2={W} y1={H} y2={H} stroke="currentColor" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />
            {months.map((m, i) =>
              flagged.has(m.key) ? (
                <rect key={`f-${m.key}`} x={x(i) - W / Math.max(2, months.length) / 2} y={0} width={W / Math.max(2, months.length)} height={H} fill="currentColor" fillOpacity={0.05} />
              ) : null,
            )}
            {/* A soft fill under each solid line: the area reads as "money piling up". */}
            {lines.filter((l) => !l.dashed).map((line) => (
              <polygon
                key={`a-${line.key}`}
                fill={line.color}
                fillOpacity={lines.length > 2 ? 0.05 : 0.1}
                points={`0,${H} ${line.points.map((p, i) => `${x(i)},${y(p.interestToDate)}`).join(' ')} ${x(line.points.length - 1)},${H}`}
              />
            ))}
            {target !== null ? (
              <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            ) : null}
            {lines.map((line) => (
              <polyline
                key={line.key}
                fill="none"
                stroke={line.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={line.dashed ? '6 5' : undefined}
                vectorEffect="non-scaling-stroke"
                points={line.points.map((p, i) => `${x(i)},${y(p.interestToDate)}`).join(' ')}
              />
            ))}
            {at >= 0 ? <line x1={x(at)} x2={x(at)} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" /> : null}
          </svg>

          {target !== null ? (
            <span className="bg-card text-muted-foreground absolute right-0 -translate-y-full rounded px-1 text-[0.7rem]" style={{ top: `${yPct(target)}%` }}>
              Goal {compactPesos(target)}
            </span>
          ) : null}

          {/* A dot on every line at the chosen month, and the first line's value above it. */}
          {at >= 0
            ? lines.map((line) => (
                <span
                  key={`d-${line.key}`}
                  className="bg-card pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px]"
                  style={{ left: `${xPct(at)}%`, top: `${yPct(line.points[at].interestToDate)}%`, borderColor: line.color }}
                  aria-hidden
                />
              ))
            : null}
          {picked ? (
            <span
              className="bg-foreground text-background pointer-events-none absolute rounded-md px-2 py-1 text-xs font-semibold whitespace-nowrap shadow"
              style={{
                left: `${xPct(at)}%`,
                top: `${yPct(picked.interestToDate)}%`,
                transform: `translate(${xPct(at) < 20 ? '0' : xPct(at) > 80 ? '-100%' : '-50%'}, calc(-100% - 10px))`,
              }}
              aria-hidden
            >
              {/* Says estimate, and whose line it is when plans are compared. */}
              Est. {compactPesos(picked.interestToDate)}{lines.length > 2 ? ` · ${first.label.split(':')[0]}` : ''}
            </span>
          ) : null}

          {/* Tap targets: one column per month, laid over the drawing in HTML so each is a real link. */}
          <div className="absolute inset-0 flex">
            {months.map((m) => (
              <Link
                key={m.key}
                href={hrefFor(m.key)}
                scroll={false}
                aria-label={`Show ${m.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}`}
                className="hover:bg-foreground/5 flex-1"
              />
            ))}
          </div>
        </div>
      </div>

      <div className="text-muted-foreground relative ml-14 h-4 text-[0.7rem]" aria-hidden>
        {ticks.map((i, n) => (
          <span
            key={months[i].key}
            className="absolute whitespace-nowrap"
            style={{
              left: `${xPct(i)}%`,
              transform: n === 0 ? 'none' : n === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {i === 0 ? 'Now' : short(months[i].month)}
          </span>
        ))}
      </div>
      {flagged.size > 0 ? <p className="text-muted-foreground ml-14 text-xs">Shaded columns are months with a cash warning.</p> : null}
    </figure>
  )
}

/** Round the top of the axis up to 1, 2 or 5 × a power of ten, so the labels are tidy numbers. */
function niceTop(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

/** The legend: a drawn swatch of each line, so solid and dashed read without colour alone. */
export function ChartLegend({ lines }: { lines: ChartLine[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-xs sm:flex-row sm:flex-wrap sm:gap-x-4">
      {lines.map((l) => (
        <li key={l.key} className="flex items-center gap-2">
          <svg width="24" height="8" aria-hidden className="shrink-0">
            <line x1="2" x2="22" y1="4" y2="4" stroke={l.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={l.dashed ? '4 4' : undefined} />
          </svg>
          <span>{l.label}</span>
        </li>
      ))}
    </ul>
  )
}
