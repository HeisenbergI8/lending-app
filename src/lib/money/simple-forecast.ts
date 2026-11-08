import { type Centavos, centavos } from './centavos.ts'
import { HISTORY_MONTHS, historyWindowStart } from './forecast-history.ts'
import { type ScheduledRow, scheduleArrivals } from './projection.ts'
import { daysBetween, firstOfMonth, monthKey } from './weeks.ts'

/**
 * THE PROJECTION, KEPT SIMPLE (owner, 2026-11-08): "carry on the way you have
 * been", read straight from the loan history — no pretend loans, no plans.
 *
 * For each month ahead, the interest is the LARGER of
 *   known    what the loans running today will pay in that month (their stored
 *            earnings and cut, on their due dates — scheduleArrivals), and
 *   usual    the interest a month that new lending has earned over the last
 *            HISTORY_MONTHS months: loans started in the window, their stored
 *            earnings and cut, divided by the months.
 * The larger, not the sum: the loans running today ARE part of the usual pace,
 * so adding both would count the same lending twice; taking only the known
 * figure would drop to nothing once today's loans end. The current month counts
 * from today only, so it uses the known figure alone.
 *
 * WHOSE MONEY: a lender sees their own earnings only; the Admin sees its own
 * earnings PLUS the Admin cut; the whole pot sees everything.
 *
 * THE POT at a month's end is today's capital (floating + out on loan) plus the
 * interest counted so far. No deposits or withdrawals are assumed, as asked.
 * Money already overdue today is in neither figure, and is reported apart.
 */

export type Whose = { kind: 'pot' } | { kind: 'lender'; lenderId: string }

/** A funding row of a loan running today. Capital and earnings are the funder's; the cut is the Admin's. */
export type RunningRow = ScheduledRow & { lenderId: string }

/** A funding row of a loan STARTED in the history window. Continuation loans are left out by the caller. */
export type HistoryRow = { lenderId: string; startOn: Date; earnings: Centavos; adminCut: Centavos }

export type SimpleInput = {
  today: Date
  months: number
  adminId: string | null
  /** Floating funds + capital out on loan today, per lender. */
  capitalNow: ReadonlyMap<string, Centavos>
  running: readonly RunningRow[]
  history: readonly HistoryRow[]
}

export type SimpleMonth = {
  month: Date
  key: string
  interest: Centavos
  /** Which figure the month used — shown so the Admin can see why a month is what it is. */
  basis: 'known' | 'usual'
  /** Today's capital plus interest counted from today through the end of this month. */
  pot: Centavos
}

export type SimpleForecast = {
  months: SimpleMonth[]
  /** The usual interest a month from new lending, in this view. */
  usual: Centavos
  total: Centavos
  /** Overdue today and not counted. */
  overdue: Centavos
  /** New loans in the window, for the "based on" line. */
  basedOnLoans: number
}

/** What part of a row's money belongs to the chosen view. */
function share(whose: Whose, adminId: string | null, lenderId: string, own: number, cut: number): number {
  if (whose.kind === 'pot') return own + cut
  return (lenderId === whose.lenderId ? own : 0) + (whose.lenderId === adminId ? cut : 0)
}

export function simpleForecast(input: SimpleInput, whose: Whose, basedOnLoans: number): SimpleForecast {
  const { today, adminId } = input
  const start = firstOfMonth(today)
  const months = Math.max(1, input.months)
  const index = (d: Date) => (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth())

  const known = Array.from({ length: months }, () => 0)
  let overdue = 0
  for (const row of input.running) {
    for (const a of scheduleArrivals(row)) {
      const mine = share(whose, adminId, row.lenderId, a.interest, a.adminCut)
      const capital = whose.kind === 'pot' || row.lenderId === whose.lenderId ? a.capital : 0
      if (daysBetween(today, a.on) < 0) {
        overdue += mine + capital
        continue
      }
      const m = index(a.on)
      if (m >= 0 && m < months) known[m] += mine
    }
  }

  const from = historyWindowStart(today)
  const recent = input.history.filter((r) => daysBetween(from, r.startOn) >= 0 && daysBetween(r.startOn, today) >= 0)
  const usual = Math.round(recent.reduce((s, r) => s + share(whose, adminId, r.lenderId, r.earnings, r.adminCut), 0) / HISTORY_MONTHS)

  const capitalNow =
    whose.kind === 'pot'
      ? [...input.capitalNow.values()].reduce((s, v) => s + v, 0)
      : (input.capitalNow.get(whose.lenderId) ?? 0)

  let running = 0
  const out: SimpleMonth[] = known.map((k, m) => {
    const useUsual = m > 0 && usual > k
    const interest = useUsual ? usual : k
    running += interest
    const month = firstOfMonth(start, m)
    return { month, key: monthKey(month), interest: centavos(interest), basis: useUsual ? 'usual' : 'known', pot: centavos(capitalNow + running) }
  })

  return { months: out, usual: centavos(usual), total: centavos(running), overdue: centavos(overdue), basedOnLoans }
}
