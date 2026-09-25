// Review of src/components/loan-status.tsx (74 lines) — the badge, and the colour
// rule the weekly schedule must not break.

/**
 * "ALWAYS an icon and a word, never a bare coloured dot. On a light surface the
 *  warning and serious steps sit below 3:1 contrast by design; the icon and the
 *  label are what carry the meaning, so a reader who cannot separate the hues
 *  loses nothing. That is the rule the whole status palette depends on."
 *
 * IMPORTANT for this feature: the schedule is twenty rows of almost identical
 * figures, distinguished mainly by state. It is the single place in the app where
 * colour is most tempting as the only channel, and the most costly place to use
 * it that way. Every row needs its icon and its word.
 */

const PRESENTATION: Record<LoanState, { label: string; icon; className: string }> = {
  paid:         { label: 'Paid',      icon: CheckCircle2,   className: 'text-status-good ...' },
  overdue:      { label: 'Overdue',   icon: AlertTriangle,  className: 'text-status-critical ...' },
  'due-today':  { label: 'Due today', icon: CalendarClock,  className: 'text-status-serious ...' },
  'due-soon':   { label: 'Due soon',  icon: Clock,          className: 'text-status-warning ...' },
  active:       { label: 'Active',    icon: Clock,          className: 'text-brand-strong ...' },
}
// NOTE: `active` deliberately uses the BRAND colour, not one of the four status
// tokens and not grey — "grey reads as switched off, the one impression this badge
// must not give. It borrows the app's colour so it stays clear of the four
// due/overdue hues."

// IMPORTANT — CONVENTIONS.md, and the reason the plan adds no fifth tone:
//   "Colour means loan state and nothing else. Four reserved tokens — good,
//    warning, serious, critical — and they are never borrowed for an accent, a
//    chart series or decoration."
//
// A weekly row is always one of the existing five states. The one row that is
// genuinely different — the final week, handed over with the capital — says so in
// WORDS on the row rather than getting a colour of its own. Adding a sixth tone
// for it would be borrowing the palette for something that is not a loan state.

/**
 * "The rule that decides the state lives in lib/loan-state.ts — it is a fact
 *  about loans, not about badges."
 */
export function LoanStatusBadge({ state, className }: { state: LoanState; className?: string }) {}
// NOTE: takes a LoanState, never a date, so it needs NO CHANGE for this feature.
// Every caller already resolves the state upstream, which is exactly why the
// loanState widening in Phase 4 reaches the badge for free — and also why a
// missed call site is invisible here rather than caught.
