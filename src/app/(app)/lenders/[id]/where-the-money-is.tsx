import Link from 'next/link'

import { Money } from '@/components/money.tsx'
import { type Centavos } from '@/lib/money/centavos.ts'

export type MoneyPart = {
  key: string
  label: string
  amount: Centavos
  /** A CSS colour, from the theme tokens so it holds in both themes. */
  color: string
  /** Selects this part: the same page with `?part=` set. */
  href: string
  /** The one thing to do next with this part, shown under the chart once it is selected. */
  next: { label: string; href: string }
}

/** One ring segment of the donut, from angle a0 to a1 (radians, clockwise from 12 o'clock). */
function segment(a0: number, a1: number): string {
  const R = 78
  const r = 54
  const at = (radius: number, angle: number) => `${80 + radius * Math.sin(angle)} ${80 - radius * Math.cos(angle)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${at(R, a0)} A${R} ${R} 0 ${large} 1 ${at(R, a1)} L${at(r, a1)} A${r} ${r} 0 ${large} 0 ${at(r, a0)} Z`
}

/**
 * Where this pot's money is right now, as one donut — the parts of Pot total.
 *
 * Every part is a link. Tapping one selects it (`?part=`), which fades the
 * others, puts its figure in the middle, and offers the one next step for it.
 * Server-rendered links rather than client state, so a selection is a URL and
 * the "Out with" list below can filter on the same parameter.
 *
 * A part below zero (Floating, when more is out than was put in) draws no
 * slice — a negative slice is not a shape — but keeps its legend row, in red,
 * so the figure is never hidden. Shares are of the parts that ARE drawn.
 */
export function WhereTheMoneyIs({
  parts,
  potTotal,
  selected,
  clearHref,
}: {
  parts: MoneyPart[]
  potTotal: Centavos
  selected: string | null
  clearHref: string
}) {
  const drawn = parts.filter((part) => part.amount > 0)
  const sum = drawn.reduce((total, part) => total + part.amount, 0)
  const chosen = parts.find((part) => part.key === selected) ?? null
  const gap = drawn.length > 1 ? 0.035 : 0
  const share = (amount: number) => (sum > 0 ? Math.round((Math.max(0, amount) / sum) * 100) : 0)

  const slices = drawn.map((part, index) => {
    const before = drawn.slice(0, index).reduce((total, earlier) => total + earlier.amount, 0)
    const start = (before / sum) * Math.PI * 2
    const end = ((before + part.amount) / sum) * Math.PI * 2
    return { part, d: segment(start + gap / 2, Math.max(start + gap / 2 + 0.001, end - gap / 2)) }
  })

  return (
    <section id="where" className="bg-card scroll-mt-4 space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Where the money is</h2>
        {chosen ? (
          <Link href={clearHref} scroll={false} className="text-brand text-xs font-medium">
            Show all
          </Link>
        ) : (
          <span className="text-muted-foreground text-xs">Tap a part to see more</span>
        )}
      </div>

      <div className="grid grid-cols-[136px_minmax(0,1fr)] items-center gap-4">
        <div className="relative size-[136px]">
          {sum > 0 ? (
            <svg viewBox="0 0 160 160" className="size-full overflow-visible" role="img" aria-label="Where the money is, by part">
              {slices.map(({ part, d }) => (
                <Link key={part.key} href={part.href} scroll={false} aria-label={part.label}>
                  <path
                    d={d}
                    fill={part.color}
                    className="transition-opacity duration-200"
                    opacity={chosen && chosen.key !== part.key ? 0.22 : 1}
                  />
                </Link>
              ))}
            </svg>
          ) : (
            <div className="border-border size-full rounded-full border-[22px]" />
          )}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
            <span className="text-muted-foreground text-[0.65rem] leading-tight">{chosen ? chosen.label : 'Pot total'}</span>
            <span className="text-sm font-semibold tabular-nums" style={chosen ? { color: chosen.color } : undefined}>
              <Money amount={chosen ? chosen.amount : potTotal} variant="display" />
            </span>
            {chosen && chosen.amount > 0 ? <span className="text-muted-foreground text-[0.6rem]">{share(chosen.amount)}%</span> : null}
          </div>
        </div>

        <ul className="min-w-0 space-y-0.5">
          {parts.map((part) => (
            <li key={part.key}>
              <Link
                href={part.href}
                scroll={false}
                aria-current={chosen?.key === part.key ? 'true' : undefined}
                className={`hover:bg-muted/60 grid grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2 rounded-lg px-2 py-1.5 transition-opacity ${
                  chosen?.key === part.key ? 'bg-muted/60' : ''
                } ${chosen && chosen.key !== part.key ? 'opacity-45' : ''}`}
              >
                <span className="size-2.5 rounded-full" style={{ background: part.color }} />
                <span className="text-muted-foreground truncate text-xs">{part.label}</span>
                <span />
                <span className={`text-sm font-semibold ${part.amount < 0 ? 'text-status-critical' : part.amount === 0 ? 'text-muted-foreground font-normal' : ''}`}>
                  <Money amount={part.amount} variant="display" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {chosen ? (
        <Link href={chosen.next.href} className="text-brand block text-sm font-medium">
          {chosen.next.label}
        </Link>
      ) : null}
    </section>
  )
}
