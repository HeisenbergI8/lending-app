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
 * COMPOUNDING (owner, 2026-11-08), PER LENDER: each lender's usual earnings a
 * month ÷ their money today is their monthly RETURN, and from next month on
 * their pot earns it as it stands, so interest left in earns interest. The Admin
 * cut follows the capital that earns it: each lender's usual cut ÷ their money,
 * applied to their pot, paid to the Admin. See simpleForecast. A month still never earns less than what the running
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
  /** The usual interest a month from new lending, in this view (the Admin's includes the cut). */
  usual: Centavos
  /** The Admin view only: the part of `usual` that is the Admin cut, earned on other lenders' money. */
  usualCut: Centavos
  /** This view's own earnings ÷ its money today, in basis points a month (the Admin cut is not in it). Null with no money. */
  monthlyReturnBps: number | null
  /** The money this view had today: the pot the compounding starts from. */
  capitalNow: Centavos
  total: Centavos
  /** Overdue today and not counted. */
  overdue: Centavos
  /** New loans in the window, for the "based on" line. */
  basedOnLoans: number
}

/** Grows per lender. `own` is the lender's earnings; `cut` is the Admin cut their capital generates. */
type Stream = { own: number[]; cut: number[] }

/**
 * Month by month, PER LENDER (audit, 2026-11-08): each lender's pot grows at
 * their OWN monthly return — their usual earnings ÷ their money today — and the
 * Admin cut grows with the capital that generates it: each lender's usual cut ÷
 * that lender's money, applied to that lender's pot and paid to the Admin. So
 * the cut is never compounded as if it came from the Admin's own money, and
 * the lenders' figures always add up to the whole pot.
 */
export function simpleForecast(input: SimpleInput, whose: Whose, basedOnLoans: number): SimpleForecast {
  const { today, adminId } = input
  const start = firstOfMonth(today)
  const months = Math.max(1, input.months)
  const index = (d: Date) => (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth())
  const ids = [...new Set([...input.capitalNow.keys(), ...input.running.map((r) => r.lenderId), ...(adminId ? [adminId] : [])])]
  const blank = (): Stream => ({ own: Array.from({ length: months }, () => 0), cut: Array.from({ length: months }, () => 0) })

  // KNOWN: what running loans pay, by the lender whose capital it is.
  const known = new Map(ids.map((id) => [id, blank()]))
  let overdue = 0
  for (const row of input.running) {
    for (const a of scheduleArrivals(row)) {
      if (daysBetween(today, a.on) < 0) {
        overdue += viewShare(whose, adminId, row.lenderId, a.capital + a.interest, a.adminCut)
        continue
      }
      const m = index(a.on)
      if (m < 0 || m >= months) continue
      const k = known.get(row.lenderId) as Stream
      k.own[m] += a.interest
      k.cut[m] += a.adminCut
    }
  }

  // USUAL: a month of new lending over the window, by the lender whose capital it is.
  const from = historyWindowStart(today)
  const usualOwn = new Map(ids.map((id) => [id, 0]))
  const usualCut = new Map(ids.map((id) => [id, 0]))
  for (const r of input.history) {
    if (daysBetween(from, r.startOn) < 0 || daysBetween(r.startOn, today) < 0) continue
    usualOwn.set(r.lenderId, (usualOwn.get(r.lenderId) ?? 0) + r.earnings / HISTORY_MONTHS)
    usualCut.set(r.lenderId, (usualCut.get(r.lenderId) ?? 0) + r.adminCut / HISTORY_MONTHS)
  }
  const capital0 = new Map(ids.map((id) => [id, input.capitalNow.get(id) ?? 0]))
  const ownRate = (id: string) => ((capital0.get(id) as number) > 0 ? (usualOwn.get(id) as number) / (capital0.get(id) as number) : 0)
  const cutRate = (id: string) => ((capital0.get(id) as number) > 0 ? (usualCut.get(id) as number) / (capital0.get(id) as number) : 0)

  const mine = (id: string) => whose.kind === 'pot' || whose.lenderId === id
  const getsCut = whose.kind === 'pot' || (adminId !== null && whose.kind === 'lender' && whose.lenderId === adminId)
  const pots = new Map(capital0)
  const monthlyIn = input.monthlyIn ?? 0
  const monthlyOut = input.monthlyOut ?? 0

  let total = 0
  const out: SimpleMonth[] = []
  for (let m = 0; m < months; m += 1) {
    // Interest on the pots as they stood at the start of the month.
    let interest = 0
    let fromKnown = 0
    let fromReturn = 0
    const credit = new Map(ids.map((id) => [id, 0]))
    for (const id of ids) {
      const k = known.get(id) as Stream
      const pot = Math.max(0, pots.get(id) as number)
      const own = m === 0 ? k.own[m] : Math.max(k.own[m], Math.round(pot * ownRate(id)))
      const cut = m === 0 ? k.cut[m] : Math.max(k.cut[m], Math.round(pot * cutRate(id)))
      credit.set(id, (credit.get(id) as number) + own)
      if (adminId) credit.set(adminId, (credit.get(adminId) as number) + cut)
      const counted = (mine(id) ? own : 0) + (getsCut ? cut : 0)
      interest += counted
      fromKnown += (mine(id) ? k.own[m] : 0) + (getsCut ? k.cut[m] : 0)
      fromReturn += counted
    }
    for (const id of ids) pots.set(id, (pots.get(id) as number) + (credit.get(id) as number))

    // Money in and out, from next month, on the money in this view: one lender's
    // pot, or for the whole pot shared across lenders by the size of their pots.
    let takenOut = 0
    if (m > 0 && (monthlyIn > 0 || monthlyOut > 0)) {
      const inView = ids.filter((id) => mine(id))
      const sizes = inView.map((id) => Math.max(0, pots.get(id) as number))
      const sum = sizes.reduce((a, b) => a + b, 0)
      inView.forEach((id, n) => {
        const weight = sum > 0 ? sizes[n] / sum : 1 / inView.length
        const after = (pots.get(id) as number) + monthlyIn * weight
        const take = Math.min(monthlyOut * weight, Math.max(0, after))
        takenOut += take
        pots.set(id, after - take)
      })
    }
    total += interest
    const viewPot = ids.filter((id) => mine(id)).reduce((s, id) => s + (pots.get(id) as number), 0)
    const month = firstOfMonth(start, m)
    out.push({
      month,
      key: monthKey(month),
      interest: centavos(interest),
      basis: m === 0 || fromKnown >= fromReturn ? 'known' : 'usual',
      takenOut: centavos(Math.round(takenOut)),
      pot: centavos(Math.round(viewPot)),
    })
  }

  const viewCapital = ids.filter((id) => mine(id)).reduce((s, id) => s + (capital0.get(id) as number), 0)
  const viewOwn = ids.filter((id) => mine(id)).reduce((s, id) => s + (usualOwn.get(id) as number), 0)
  const viewCut = getsCut ? ids.reduce((s, id) => s + (usualCut.get(id) as number), 0) : 0
  const usual = Math.round(viewOwn + viewCut)
  // The return shown is on the view's OWN money: the Admin's cut is earned on others' capital, so it is reported apart.
  const ownForReturn = whose.kind === 'pot' ? usual : Math.round(viewOwn)
  return {
    months: out,
    usual: centavos(usual),
    usualCut: centavos(Math.round(whose.kind === 'pot' ? 0 : viewCut)),
    monthlyReturnBps: viewCapital > 0 ? Math.floor((ownForReturn * 10_000) / viewCapital) : null,
    capitalNow: centavos(viewCapital),
    total: centavos(total),
    overdue: centavos(overdue),
    basedOnLoans,
  }
}

/** What part of a row's money belongs to the chosen view (used for overdue money). */
function viewShare(whose: Whose, adminId: string | null, lenderId: string, own: number, cut: number): number {
  if (whose.kind === 'pot') return own + cut
  return (lenderId === whose.lenderId ? own : 0) + (whose.lenderId === adminId ? cut : 0)
}
