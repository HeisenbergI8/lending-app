import { type Centavos, formatPesos } from '@/lib/money/centavos.ts'
import { cn } from '@/lib/utils'

/**
 * A peso amount.
 *
 * Two variants, and the difference is not cosmetic:
 *
 *   COLUMN  in a table. tabular-nums gives every digit the width of a zero, so
 *           figures align down the column and the decimal points stack. That
 *           alignment is the whole reason a ledger can be scanned rather than read.
 *
 *   DISPLAY standing alone — a stat tile, a total on a card. Deliberately NOT
 *           tabular: at display size, equal-width digits make a number like
 *           ₱121 look gappy. Proportional figures are correct here.
 *
 * `muted` is for a zero or a figure that is present but not the point.
 */
export function Money({
  amount,
  variant = 'column',
  muted = false,
  className,
}: {
  amount: Centavos
  variant?: 'column' | 'display'
  muted?: boolean
  className?: string
}) {
  const formatted = formatPesos(amount)
  return (
    <span
      className={cn(
        variant === 'column' ? 'money-column' : 'tracking-tight',
        muted && 'text-muted-foreground',
        className,
      )}
      // The screen reader gets the same string; nothing is conveyed by alignment alone.
      aria-label={formatted}
    >
      {formatted}
    </span>
  )
}
