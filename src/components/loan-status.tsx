import { AlertTriangle, CalendarClock, CheckCircle2, Clock } from 'lucide-react'

import { type LoanState } from '@/lib/loan-state.ts'
import { cn } from '@/lib/utils'

/**
 * A loan's state, as a badge.
 *
 * ALWAYS an icon and a word, never a bare coloured dot. On a light surface the
 * warning and serious steps sit below 3:1 contrast by design; the icon and the
 * label are what carry the meaning, so a reader who cannot separate the hues
 * loses nothing. That is the rule the whole status palette depends on.
 *
 * The rule that decides the state lives in lib/loan-state.ts — it is a fact
 * about loans, not about badges.
 */

const PRESENTATION: Record<
  LoanState,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  paid: {
    label: 'Paid',
    icon: CheckCircle2,
    className: 'text-status-good bg-status-good-bg',
  },
  overdue: {
    label: 'Overdue',
    icon: AlertTriangle,
    className: 'text-status-critical bg-status-critical-bg',
  },
  'due-today': {
    label: 'Due today',
    icon: CalendarClock,
    className: 'text-status-serious bg-status-serious-bg',
  },
  'due-soon': {
    label: 'Due soon',
    icon: Clock,
    className: 'text-status-warning bg-status-warning-bg',
  },
  active: {
    label: 'Active',
    icon: Clock,
    // Brand rather than grey. Active is a loan that is running, and grey reads
    // as switched off — the one impression this badge must not give. It borrows
    // the app's colour so it stays clear of the four due/overdue hues.
    className: 'text-brand-strong bg-brand-bg',
  },
}

export function LoanStatusBadge({
  state,
  className,
}: {
  state: LoanState
  className?: string
}) {
  const { label, icon: Icon, className: tone } = PRESENTATION[state]
  return (
    <span
      className={cn(
        // A soft filled pill with no outline. The border was doing the same job
        // as the tint and only made the badge louder than the figure beside it.
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  )
}
