import { cn } from '@/lib/utils'

/**
 * A headline number.
 *
 * Contract from the visualization guidance: a label in sentence case with no
 * trailing colon, then the value in semibold sans, then an optional note.
 *
 * The value uses PROPORTIONAL figures. tabular-nums belongs in columns that must
 * align vertically; at this size it gives every digit the width of a zero and a
 * number like 121 reads loose and gappy.
 *
 * A dashboard gets exactly ONE hero tile, and here the hero is FILLED rather
 * than merely larger. Size alone was not carrying it: five white cards in a
 * column all read as equally important, which is the flatness the screens were
 * criticised for. A solid brand surface says "start here" before a single figure
 * is read.
 *
 * `tone` still exists only for loan state, and it OVERRIDES the brand fill: a
 * hero showing overdue money must be red, because the one thing a filled card
 * must never do is make a problem look like a feature.
 */

export type ChipTint = 'indigo' | 'sky' | 'mint' | 'violet' | 'amber'

const CHIP: Record<ChipTint, string> = {
  indigo: 'text-chip-indigo bg-chip-indigo/10',
  sky: 'text-chip-sky bg-chip-sky/10',
  mint: 'text-chip-mint bg-chip-mint/10',
  violet: 'text-chip-violet bg-chip-violet/10',
  amber: 'text-chip-amber bg-chip-amber/10',
}

/**
 * The soft rounded square behind a stat's icon.
 *
 * Decoration, and deliberately a different ramp from the four status colours —
 * so nobody has to work out whether the lilac one means something. It never
 * does; the status badge beside it is the only thing that carries state.
 */
export function IconChip({
  icon: Icon,
  tint = 'indigo',
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  tint?: ChipTint
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-[0.7rem]',
        CHIP[tint],
        className,
      )}
      aria-hidden
    >
      <Icon className="size-[1.125rem]" />
    </span>
  )
}

export function StatTile({
  label,
  value,
  note,
  hero = false,
  tone,
  icon: Icon,
  tint = 'indigo',
  className,
}: {
  label: string
  value: React.ReactNode
  note?: string
  hero?: boolean
  tone?: 'critical' | 'good'
  icon?: React.ComponentType<{ className?: string }>
  tint?: ChipTint
  className?: string
}) {
  if (hero) {
    const critical = tone === 'critical'
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl p-5 sm:p-6',
          'shadow-rest transition-shadow duration-200',
          critical
            ? 'bg-status-critical-fill text-white'
            : 'bg-brand text-brand-foreground',
          className,
        )}
      >
        {/* A single soft highlight so the fill is a surface with light on it
            rather than a flat rectangle of colour. Purely optical. */}
        <span
          className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10 blur-2xl"
          aria-hidden
        />

        <div className="relative flex items-center gap-2 text-xs font-medium tracking-wide text-white/90 uppercase">
          {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
          {label}
        </div>

        <div className="relative mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {value}
        </div>

        {note ? <div className="relative mt-1.5 text-sm text-white/85">{note}</div> : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'bg-card ring-border/70 rounded-2xl p-3 ring-1 lg:p-4',
        'shadow-rest hover:shadow-hover transition-[box-shadow,transform] duration-200',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        {Icon ? <IconChip icon={Icon} tint={tone === 'critical' ? 'amber' : tint} /> : null}
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground truncate text-xs font-medium">{label}</div>
          <div
            className={cn(
              'mt-0.5 font-semibold tracking-tight',
              // The supporting step climbs in three stages rather than one,
              // because a peso amount is a LONG string — "₱223,500.00" is eleven
              // characters — and the column it sits in does NOT simply get wider
              // with the screen: from `md` the sidebar takes 224px back. Sized in
              // one jump it was clipped mid-figure on every phone AND on iPad
              // Mini and iPad Air. A number reading "₱12,000.0" is worse than a
              // small one.
              'text-lg md:text-xl lg:text-2xl',
              tone === 'critical' && 'text-status-critical',
              tone === 'good' && 'text-status-good',
            )}
          >
            {value}
          </div>
        </div>
      </div>

      {note ? <div className="text-muted-foreground mt-2 text-xs">{note}</div> : null}
    </div>
  )
}

/**
 * The supporting tiles beneath the hero.
 *
 * TWO ACROSS ON A PHONE, three from `sm` up.
 *
 * This was an even 3-up at every width, and on a phone that is not enough room
 * for money. A third of a 375px screen leaves about 87px inside the tile's
 * padding, and "₱223,500.00" needs 124px — so the figure ran out of its tile and
 * was cut off mid-number on every phone in the device list, and on iPad Mini
 * besides. A ledger that displays ₱12,000.0 where it means ₱12,000.00 is worse
 * than one that takes a second line.
 *
 * The third tile spans both columns rather than sitting alone in the left half:
 * three items in a two-column grid always leave one odd slot, and a half-width
 * tile with a hole beside it reads as something failing to load.
 *
 * The hero sits ABOVE this rather than inside it, which is what keeps that
 * arithmetic to the one case handled here.
 */
export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:gap-4',
        // nth-child(3):last-child, NOT last-child — the span is only right when
        // there are exactly three tiles. With two, or with four, the grid already
        // divides evenly and a spanning last tile would be the odd one out.
        // Written this way the rule simply stops applying instead of going wrong.
        '[&>*:nth-child(3):last-child]:col-span-2 sm:[&>*:nth-child(3):last-child]:col-span-1',
        className,
      )}
    >
      {children}
    </div>
  )
}
