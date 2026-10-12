/** What the Money history filter offers, and which lines each one shows. */
export const HISTORY_FILTERS = [
  { key: 'in', label: 'Money in', kinds: ['deposit'] },
  { key: 'withdrawals', label: 'Withdrawals', kinds: ['withdrawal'] },
  { key: 'lent', label: 'Lent out', kinds: ['lent'] },
  { key: 'back', label: 'Paid back', kinds: ['repaid', 'interest', 'cut'] },
] as const

export type HistoryFilterKey = (typeof HISTORY_FILTERS)[number]['key']

/** The filter named in the URL, or null for "All" (including anything unrecognised). */
export function parseHistoryFilter(raw: string | undefined): HistoryFilterKey | null {
  return HISTORY_FILTERS.find((filter) => filter.key === raw)?.key ?? null
}

/** Keep only the lines the chosen filter covers. Every kind belongs to exactly one filter. */
export function filterHistory<T extends { kind: string }>(events: readonly T[], filter: HistoryFilterKey | null): T[] {
  if (filter === null) return [...events]
  const kinds: readonly string[] = HISTORY_FILTERS.find((entry) => entry.key === filter)!.kinds
  return events.filter((event) => kinds.includes(event.kind))
}
