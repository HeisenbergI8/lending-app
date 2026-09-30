/**
 * "Sep 30" for a date in the current year, "Sep 30, 2025" for any other.
 *
 * Lists are read against today, so this year's dates don't need the year
 * repeated on every row — but a date from another year always shows it, so a
 * 2026 record read in 2027 still says 2026.
 */
const withYear = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
const withoutYear = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short' })

export function formatListDate(date: Date, today: Date = new Date()): string {
  return date.getFullYear() === today.getFullYear() ? withoutYear.format(date) : withYear.format(date)
}
