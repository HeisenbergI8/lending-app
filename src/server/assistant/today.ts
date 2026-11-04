/**
 * Today in the Philippines, as YYYY-MM-DD. The server runs on UTC, where it is
 * still yesterday until 8am Manila time, and "starting today" must mean the
 * Admin's today.
 */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** A YYYY-MM-DD date moved by whole days, on the calendar (no time zone involved). */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
