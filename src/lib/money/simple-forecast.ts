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
 * A NEW BOOK (owner, 2026-11-08): when the first loan ever recorded is inside
 * the window, the months before it are not months of no lending, just months
 * before the app was used. The average then runs from the first loan's month
 * (historyFrom / historyMonths), and grows to the full window by itself.
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
 * BORROWERS ARE LIMITED (owner, 2026-11-08). Two things keep the estimate
 * honest about how many borrowers there are, both read from the same history:
 *   PACE     slow / usual / busy. The whole pot's month-by-month interest from
 *            new lending over the last HISTORY_MONTHS FULL months (from the
 *            first loan's month, if lending began later); slow is the
 *            slowest of them ÷ their average, busy the busiest ÷ the average.
 *            Every lender's return is multiplied by that one factor, so the
 *            lenders still add up to the whole pot.
 *   CEILING  a lender's pot can grow, but borrowers may not grow with it: a
 *            lender's return part never goes above the most they earned from
 *            new loans in any one month of the window (own and cut apart), and
 *            all lenders together never above the whole pot's busiest full
 *            month (shared back by size). Money past that point has no borrower, earns nothing, and
 *            is reported as `idle`.
 * A pot cannot go below zero; a month that would take more out than is there
 * takes what there is.
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
  /** The first loan ever recorded (any date). Omitted: the earliest history row. */
  firstLoanOn?: Date | null
  /** How strong lending is assumed to be. Defaults to 'usual'. */
  pace?: Pace
}

export type Pace = 'slow' | 'usual' | 'busy'
export const PACES: readonly Pace[] = ['slow', 'usual', 'busy']

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
  /** This view's own money with no borrower this month: past the busiest month it has ever had. */
  idle: Centavos
}

export type SimpleForecast = {
  months: SimpleMonth[]
  /** The usual interest a month from new lending, in this view (the Admin's includes the cut). */
  usual: Centavos
  /** The Admin view only: the part of `usual` that is the Admin cut, earned on other lenders' money. */
  usualCut: Centavos
  /** This view's own earnings ÷ its money today, in basis points a month (the Admin cut is not in it). Null with no money. */
  monthlyReturnBps: number | null
  /** True when some lender's return was held to MAX_MONTHLY_RETURN. */
  capped: boolean
  /** Where the average starts (the window's start, or the first loan's month if later) and how many months it divides by. */
  historyFrom: Date
  historyMonths: number
  /** The pace used, and its factor on the usual return (1 for usual). */
  pace: Pace
  paceFactor: number
  /** The money this view had today: the pot the compounding starts from. */
  capitalNow: Centavos
  total: Centavos
  /** Overdue today and not counted. */
  overdue: Centavos
  /** New loans in the window, for the "based on" line. */
  basedOnLoans: number
}

/**
 * The most a month can return: money lent at the top weekly rate (7%) all
 * month, 7% × 52 weeks ÷ 12. A lender who has taken most of their money out
 * would otherwise show their old earnings over almost nothing — a return so
 * large that compounding it would leave safe arithmetic and crash the page.
 */
export const MAX_MONTHLY_RETURN = (0.07 * 52) / 12

/** Grows per lender. `own` is the lender's earnings; `cut` is the Admin cut their capital generates. */
type Stream = { own: number[]; cut: number[] }

/**
 * Month by month, PER LENDER (audit, 2026-11-08): each lender's pot grows at
 * their OWN monthly return — their usual earnings ÷ their money today — and the
 * Admin cut grows with the capital that generates it: each lender's usual cut ÷
 * that lender's money, applied to that lender's pot and paid to the Admin. So
 * the cut is never compounded as if it came from the Admin's own money, and
 * the lenders' figures always add up to the whole pot. The pace factor and each
 * lender's busiest-month ceiling (see the top of this file) bound the return.
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
  // Also each lender's busiest month (the CEILING) and the whole pot's full months (the PACE).
  const from = historyWindowStart(today)
  const usualOwn = new Map(ids.map((id) => [id, 0]))
  const usualCut = new Map(ids.map((id) => [id, 0]))
  const byMonth = new Map<string, { own: number; cut: number }>() // `${lenderId} ${monthIndex}`
  const potMonths = Array.from({ length: HISTORY_MONTHS }, () => 0) // full months only, oldest first
  let potThisMonth = 0 // the current month so far: in the ceiling, not in the pace
  for (const r of input.history) {
    if (daysBetween(from, r.startOn) < 0 || daysBetween(r.startOn, today) < 0) continue
    usualOwn.set(r.lenderId, (usualOwn.get(r.lenderId) ?? 0) + r.earnings)
    usualCut.set(r.lenderId, (usualCut.get(r.lenderId) ?? 0) + r.adminCut)
    const m = index(r.startOn)
    const key = `${r.lenderId} ${m}`
    const b = byMonth.get(key) ?? { own: 0, cut: 0 }
    byMonth.set(key, { own: b.own + r.earnings, cut: b.cut + r.adminCut })
    if (m < 0) potMonths[m + HISTORY_MONTHS] += r.earnings + r.adminCut
    else potThisMonth += r.earnings + r.adminCut
  }
  // The average starts at the window, or at the first loan's month if that is later.
  const firstLoan =
    input.firstLoanOn ?? input.history.reduce<Date | null>((a, r) => (a === null || daysBetween(r.startOn, a) > 0 ? r.startOn : a), null)
  const startIdx = firstLoan === null ? -HISTORY_MONTHS : Math.min(0, Math.max(-HISTORY_MONTHS, index(firstLoan)))
  const historyMonths = Math.max(1, -startIdx)
  for (const id of ids) {
    usualOwn.set(id, (usualOwn.get(id) as number) / historyMonths)
    usualCut.set(id, (usualCut.get(id) as number) / historyMonths)
  }
  const ceilOwn = new Map(ids.map((id) => [id, 0]))
  const ceilCut = new Map(ids.map((id) => [id, 0]))
  for (const [key, b] of byMonth) {
    const id = key.slice(0, key.lastIndexOf(' '))
    ceilOwn.set(id, Math.max(ceilOwn.get(id) ?? 0, b.own))
    ceilCut.set(id, Math.max(ceilCut.get(id) ?? 0, b.cut))
  }
  const potCeil = Math.max(...potMonths, potThisMonth)
  const pace = input.pace ?? 'usual'
  // Months before the first loan are not slow months, just before lending began.
  const lent = potMonths.slice(startIdx + HISTORY_MONTHS)
  const potAverage = lent.length > 0 ? lent.reduce((a, b) => a + b, 0) / lent.length : 0
  const paceFactor =
    pace === 'usual' || potAverage <= 0 ? 1 : (pace === 'slow' ? Math.min(...lent) : Math.max(...lent)) / potAverage
  const capital0 = new Map(ids.map((id) => [id, input.capitalNow.get(id) ?? 0]))
  const raw = (usual: Map<string, number>, id: string) =>
    (capital0.get(id) as number) > 0 ? (usual.get(id) as number) / (capital0.get(id) as number) : 0
  let capped = false
  const cap = (r: number) => {
    if (r <= MAX_MONTHLY_RETURN) return r
    capped = true
    return MAX_MONTHLY_RETURN
  }
  const ownRates = new Map(ids.map((id) => [id, cap(raw(usualOwn, id))]))
  const cutRates = new Map(ids.map((id) => [id, cap(raw(usualCut, id))]))
  const ownRate = (id: string) => (ownRates.get(id) as number) * paceFactor
  const cutRate = (id: string) => (cutRates.get(id) as number) * paceFactor

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
    let idle = 0
    const credit = new Map(ids.map((id) => [id, 0]))
    // The return part is held to each lender's busiest month, and all of it together
    // to the whole pot's busiest month (shared back by size): past that, there are
    // no borrowers for the money. Same for every view, so the parts add up.
    const ret = new Map(ids.map((id) => {
      const pot = Math.max(0, pots.get(id) as number)
      return [id, {
        own: m === 0 ? 0 : Math.min(pot * ownRate(id), ceilOwn.get(id) as number),
        cut: m === 0 ? 0 : Math.min(pot * cutRate(id), ceilCut.get(id) as number),
      }]
    }))
    const retSum = [...ret.values()].reduce((s, r) => s + r.own + r.cut, 0)
    const scale = retSum > potCeil ? potCeil / retSum : 1
    for (const id of ids) {
      const k = known.get(id) as Stream
      const pot = Math.max(0, pots.get(id) as number)
      const r = ret.get(id) as { own: number; cut: number }
      const own = Math.max(k.own[m], Math.round(r.own * scale))
      const cut = Math.max(k.cut[m], Math.round(r.cut * scale))
      if (m > 0 && mine(id) && ownRate(id) > 0) idle += Math.max(0, pot - (r.own * scale) / ownRate(id))
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
      idle: centavos(Math.round(idle)),
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
    capped,
    historyFrom: firstOfMonth(start, startIdx),
    historyMonths,
    pace,
    paceFactor,
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
