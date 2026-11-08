import { type Centavos, centavos } from './centavos.ts'
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
 * COMPOUNDING (owner, 2026-11-08): the usual pace is turned into a monthly
 * RETURN — usual interest a month ÷ this view's money today — and from next
 * month on, each month earns that return on the pot as it stands, so interest
 * left in earns interest. A month still never earns less than what the running
 * loans are known to pay in it. Money added or taken out each month (from next
 * month) moves the pot, and so the interest after it.
 *
 * ASSUMES the money keeps being lent out at the same rate as lately: enough
 * borrowers for all of it. A pot cannot go below zero; a month that would take
 * more out than is there takes what there is.
 *
 * THE POT at a month's end is the pot before it plus that month's interest,
 * plus what was added, minus what was taken out. Money already overdue today
 * is in neither figure, and is reported apart.
 */

/** How far back "the way you have been lending" looks. */
export const HISTORY_MONTHS = 6

/**
 * The 1st of the month HISTORY_MONTHS before this one: a month-aligned start
 * cannot roll over (31 August minus six months is not a date).
 */
export function historyWindowStart(today: Date): Date {
  return firstOfMonth(today, -HISTORY_MONTHS)
}

/** The time frames offered: months, the current one counting as the first. */
export const RANGES = [3, 6, 12, 24] as const
export const DEFAULT_RANGE = 12

export function rangeLabel(months: number): string {
  return months === 12 ? '1 year' : months === 24 ? '2 years' : `${months} months`
}

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
  /** Added to this view's pot each month, from next month. */
  monthlyIn?: Centavos
  /** Taken out of this view's pot each month, from next month. */
  monthlyOut?: Centavos
}

export type SimpleMonth = {
  month: Date
  key: string
  interest: Centavos
  /** Which figure the month used — shown so the Admin can see why a month is what it is. */
  basis: 'known' | 'usual'
  /** Taken out this month: less than asked only when the pot ran out. */
  takenOut: Centavos
  /** The pot at the month's end: before + interest + added − taken out. */
  pot: Centavos
}

export type SimpleForecast = {
  months: SimpleMonth[]
  /** The usual interest a month from new lending, in this view. */
  usual: Centavos
  /** usual ÷ this view's money today, in basis points a month. Null with no money today. */
  monthlyReturnBps: number | null
  /** The money this view had today: the pot the compounding starts from. */
  capitalNow: Centavos
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

  const rate = capitalNow > 0 ? usual / capitalNow : 0
  const monthlyIn = input.monthlyIn ?? 0
  const monthlyOut = input.monthlyOut ?? 0

  let total = 0
  let pot = capitalNow
  const out: SimpleMonth[] = known.map((k, m) => {
    const earned = m === 0 ? 0 : Math.round(Math.max(0, pot) * rate)
    const useUsual = m > 0 && earned > k
    const interest = useUsual ? earned : k
    total += interest
    pot += interest
    let takenOut = 0
    if (m > 0) {
      pot += monthlyIn
      takenOut = Math.min(monthlyOut, Math.max(0, pot))
      pot -= takenOut
    }
    const month = firstOfMonth(start, m)
    return {
      month,
      key: monthKey(month),
      interest: centavos(interest),
      basis: useUsual ? 'usual' : 'known',
      takenOut: centavos(takenOut),
      pot: centavos(pot),
    }
  })

  return {
    months: out,
    usual: centavos(usual),
    monthlyReturnBps: capitalNow > 0 ? Math.floor((usual * 10_000) / capitalNow) : null,
    capitalNow: centavos(capitalNow),
    total: centavos(total),
    overdue: centavos(overdue),
    basedOnLoans,
  }
}
