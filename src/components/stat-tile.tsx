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
 * A dashboard gets exactly ONE hero tile. More than one and neither is the
 * headline — the eye has nowhere to land, which is the whole job of a hero.
 *
 * `tone` exists only for loan state. It is never decoration.
 */
export function StatTile({
  label,
  value,
  note,
  hero = false,
  tone,
  icon: Icon,
  className,
}: {
  label: string
  value: React.ReactNode
  note?: string
  hero?: boolean
  tone?: 'critical' | 'good'
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-card rounded-xl border p-4 transition-colors',
        hero && 'p-5 sm:p-6',
        className,
      )}
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
        {label}
      </div>

      <div
        className={cn(
          'mt-1.5 font-semibold tracking-tight',
          // Calm on a phone, dense on a laptop: the hero shrinks less than the rest.
          hero ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl',
          tone === 'critical' && 'text-status-critical',
          tone === 'good' && 'text-status-good',
        )}
      >
        {value}
      </div>

      {note ? <div className="text-muted-foreground mt-1 text-xs">{note}</div> : null}
    </div>
  )
}

/**
 * The supporting tiles beneath the hero.
 *
 * An even 3-up at every width. The hero sits ABOVE this rather than inside it:
 * a hero spanning two columns of a four-column grid leaves an odd number of
 * slots for the rest, and the last tile wraps onto its own line with a gap
 * beside it. Taking the hero out of the grid removes the arithmetic entirely.
 */
export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-3 gap-2.5 sm:gap-3 lg:gap-4', className)}>{children}</div>
  )
}
