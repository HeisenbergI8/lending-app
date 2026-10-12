import { type Centavos, centavos } from './centavos.ts'

/**
 * A lender's starting capital, and the rule that keeps it from going below zero.
 *
 * THE OWNER'S RULE (2026-10-12): starting capital has a history. It is the
 * opening figure typed before the history began, plus every top-up, minus every
 * reduction. A top-up is fresh money from outside the lending and is ALSO a
 * deposit; a reduction is stake handed back and is ALSO a withdrawal. Both are
 * LenderTransaction rows with `isCapital` set, so they are edited, deleted and
 * restored exactly like any other money in or out.
 */

export type CapitalMove = { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; capital: boolean }

/** Opening figure plus top-ups minus reductions. Only `capital` moves count; pass live rows only. */
export function startingCapital(opening: number, moves: readonly CapitalMove[]): Centavos {
  let total = opening
  for (const move of moves) {
    if (!move.capital) continue
    total += move.type === 'DEPOSIT' ? move.amount : -move.amount
  }
  return centavos(total)
}

/** The sentence to show when a change would take starting capital below zero, or null. */
export function capitalRefusal(total: number): string | null {
  return total < 0 ? 'That would take starting capital below zero. Reduce it by less, or remove a reduction first.' : null
}

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
