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

/**
 * "November 01, 2026": the way Dex-E writes a date, spelled out so nobody has
 * to read a 2026-11-01. Takes a "YYYY-MM-DD" day as stored, read as that day
 * (not shifted by the time zone).
 */
const spelled = new Intl.DateTimeFormat('en-US', { month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC' })

export function spellDate(iso: string): string {
  const [y, m, d] = iso.split(/[-‑–]/).map(Number)
  if (!y || !m || !d || m > 12 || d > 31) return iso
  return spelled.format(new Date(Date.UTC(y, m - 1, d)))
}

/** Every "2026-11-26" in a piece of text spelled out. Models sometimes write it with a non-breaking hyphen (‑). */
export function spellDatesIn(text: string): string {
  return text.replace(/\b\d{4}[-‑–]\d{2}[-‑–]\d{2}\b/g, spellDate)
}
