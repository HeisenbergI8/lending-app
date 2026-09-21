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
    className: 'text-status-good bg-status-good-bg border-status-good/25',
  },
  overdue: {
    label: 'Overdue',
    icon: AlertTriangle,
    className: 'text-status-critical bg-status-critical-bg border-status-critical/30',
  },
  'due-today': {
    label: 'Due today',
    icon: CalendarClock,
    className: 'text-status-serious bg-status-serious-bg border-status-serious/30',
  },
  'due-soon': {
    label: 'Due soon',
    icon: Clock,
    className: 'text-status-warning bg-status-warning-bg border-status-warning/35',
  },
  active: {
    label: 'Active',
    icon: Clock,
    className: 'text-muted-foreground bg-muted border-transparent',
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
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  )
}
