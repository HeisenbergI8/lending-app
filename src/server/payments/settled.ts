/**
 * "Was this loan settled, and when?" — asked from twenty-one places.
 *
 * Before weekly loans this was a to-one relation and the answer was
 * `loan.payment`. Payment.loanId is no longer unique, so Prisma hands back an
 * array, and every caller would otherwise write the same two narrowings by
 * hand: pick the row with no week number, then drop it if it was undone.
 *
 * TWO THINGS ARE BEING NARROWED AND THEY ARE NOT THE SAME THING.
 *
 *   weekNumber: null  — the payment that SETTLES the loan. A weekly interest
 *                       payment is a real payment and is not this one.
 *
 *   deletedAt: null   — undoing a payment soft-deletes the row rather than
 *                       destroying it, so an undone payment is still attached
 *                       to its loan and reads as money that came back. This is
 *                       the same trap CONVENTIONS.md names; it has simply moved
 *                       from a to-one to an array.
 *
 * SETTLING is used in the QUERY wherever Prisma allows it, so the weekly rows
 * never travel. The functions below are for the places that already have the
 * rows in hand, and for the ones that need the weekly rows too.
 */

/** The where fragment that keeps only the settling payment. At most one row, by partial unique index. */
export const SETTLING = { weekNumber: null } as const

type PaymentRow = { weekNumber: number | null; deletedAt: Date | null }

/** The same narrowing applied to rows already fetched. */
export function settlingPayment<T extends PaymentRow>(payments: T[]): T | null {
  return payments.find((row) => row.weekNumber === null && row.deletedAt === null) ?? null
}

/**
 * The day a loan was settled, or null while it is still running.
 *
 * The single most-repeated line in src/server/ before this file existed.
 */
export function settledOn<T extends PaymentRow & { paidOn: Date }>(payments: T[]): Date | null {
  return settlingPayment(payments)?.paidOn ?? null
}

/** The week numbers with a live payment against them. Feeds nextUnpaidWeek. */
export function paidWeekNumbers(payments: PaymentRow[]): Set<number> {
  const weeks = new Set<number>()
  for (const row of payments) {
    if (row.weekNumber !== null && row.deletedAt === null) weeks.add(row.weekNumber)
  }
  return weeks
}

/** Every live weekly instalment on a loan, earliest first. Empty on an AT_END loan. */
export function liveWeeklyPayments<T extends PaymentRow>(payments: T[]): T[] {
  return payments
    .filter((row) => row.weekNumber !== null && row.deletedAt === null)
    .sort((a, b) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0))
}
