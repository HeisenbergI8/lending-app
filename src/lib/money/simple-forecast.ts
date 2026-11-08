import { type Centavos, centavos } from './centavos.ts'
import { accruedBetween } from './accrual.ts'
import { type ScheduledRow, scheduleArrivals } from './projection.ts'
import { addDays, daysBetween, firstOfMonth, monthKey } from './weeks.ts'

/**
 * THE PROJECTION, KEPT SIMPLE (owner, 2026-11-08): "carry on the way you have
 * been", read straight from the loan history — no pretend loans, no plans.
 *
 * For each month ahead, the interest is the LARGER of
 *   known    what the loans running today will pay in that month (their stored
 *            earnings and cut, on their due dates — scheduleArrivals), and
 *   usual    the interest a month the lending has earned over the last
 *            HISTORY_MONTHS FULL months, divided by the months. A month's
 *            interest is each loan's stored earnings and cut SPREAD ACROSS THE
 *            DAYS IT RAN (accruedBetween), the way the lender page's "Interest
 *            earned" counts it (owner, 2026-11-08), so a loan running September
 *            to October counts in both, and the two screens agree on a month.
 * A NEW BOOK (owner, 2026-11-08): when the first loan ever recorded is inside
 * the window, the months before it are not months of no lending, just months
 * before the app was used. The average then runs from the first loan's month
 * (historyFrom / historyMonths), and grows to the full window by itself. If
 * the first loan came after the 1st, that month was part empty and would drag
 * the average down, so the average starts the month after it — when there is
 * a full month after it to start from.
 * A book whose first loan is THIS month has no full month yet: its usual is
 * the whole interest of this month's loans, by start date.
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
 * PACE (owner, 2026-11-08): slow / usual / busy. The whole pot's month-by-month
 * interest over the last HISTORY_MONTHS FULL months (from the first loan's
 * month, if lending began later); slow is the slowest of them ÷ their average,
 * busy the busiest ÷ the average. Every lender's return is multiplied by that
 * one factor, so the lenders still add up to the whole pot.
 * BORROWER CEILING, PER LENDER (owner, 2026-11-08): money only earns when a
 * borrower takes it, and a new borrower earns a lender nothing unless that
 * lender funds the loan. So each lender's return part is held to
 *   (their busiest month's borrowers + extra) × what one of their borrowers
 *   earns them a month,
 * own and cut apart. A lender's borrowers in a month are the borrowers whose
 * loans that lender funded and that earned in that month. The busiest month
 * counts this month so far too, so the ceiling rises by itself as soon as a
 * month has more borrowers than before. `extraBorrowers` is the page's what-if:
 * borrowers the viewed lender would fund on top (the whole pot shares them out
 * by the size of the pots). MAX_MONTHLY_RETURN still bounds a return, as a
 * crash guard.
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

/** A funding row of a loan that started on or before today; its interest is spread over termDays from startOn. */
export type HistoryRow = { loanId: string; borrowerId: string; lenderId: string; startOn: Date; termDays: number; earnings: Centavos; adminCut: Centavos }

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
  /** What-if: borrowers this view's lender would fund on top of their busiest month. */
  extraBorrowers?: number
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
}

export type SimpleForecast = {
  months: SimpleMonth[]
  /** The usual interest a month from lending, in this view (the Admin's includes the cut). */
  usual: Centavos
  /** The Admin view only: the part of `usual` that is the Admin cut, earned on other lenders' money. */
  usualCut: Centavos
  /** This view's own earnings ÷ its money today, in basis points a month (the Admin cut is not in it). Null with no money. */
  monthlyReturnBps: number | null
  /** True when some lender's return was held to MAX_MONTHLY_RETURN. */
  capped: boolean
  /** Where the average starts (the window's start, or the first loan's month if later) and how many FULL months it divides by (0: this month only). */
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
  /** Loans that earned this view interest in the averaged months, for the "based on" line. */
  basedOnLoans: number
  /** This view's busiest month by borrowers (this month so far included), and the extra borrowers asked for. */
  busiestBorrowers: number
  extraBorrowers: number
  /** What one of this view's borrowers earns it a month (the Admin's includes the cut). */
  perBorrower: Centavos
  /** The first month held down by the borrower ceiling, if any. */
  heldFrom: Date | null
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
 * the lenders' figures always add up to the whole pot. The pace factor scales the
 * return, and each lender's borrower ceiling (see the top of this file) bounds it.
 */
export function simpleForecast(input: SimpleInput, whose: Whose): SimpleForecast {
  const { today, adminId } = input
  const start = firstOfMonth(today)
  const months = Math.max(1, input.months)
  const index = (d: Date) => (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth())
  const ids = [...new Set([...input.capitalNow.keys(), ...input.running.map((r) => r.lenderId), ...(adminId ? [adminId] : [])])]
  const mine = (id: string) => whose.kind === 'pot' || whose.lenderId === id
  const getsCut = whose.kind === 'pot' || (adminId !== null && whose.kind === 'lender' && whose.lenderId === adminId)
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

  // The average starts at the window, or at the first loan's month if that is later — or
  // the month after it, when the first loan came after the 1st and a full month follows.
  const firstLoan =
    input.firstLoanOn ?? input.history.reduce<Date | null>((a, r) => (a === null || daysBetween(r.startOn, a) > 0 ? r.startOn : a), null)
  const firstIdx = firstLoan === null ? -HISTORY_MONTHS : Math.min(0, Math.max(-HISTORY_MONTHS, index(firstLoan)))
  const partFirst = firstLoan !== null && index(firstLoan) === firstIdx && firstLoan.getDate() !== 1 && firstIdx + 1 < 0
  const startIdx = partFirst ? firstIdx + 1 : firstIdx
  // FULL months only: this month is not over, and its loans are already in `known`.
  // A book whose first loan is this month has no full month yet, so it uses this one.
  const historyMonths = startIdx === 0 ? 0 : -startIdx

  // USUAL: what each lender's money earned in each month of the window, spread across
  // the days each loan ran. Also the whole pot's full months (the PACE), and the
  // loans that earned this view something.
  const usualOwn = new Map(ids.map((id) => [id, 0]))
  const usualCut = new Map(ids.map((id) => [id, 0]))
  const potMonths = Array.from({ length: HISTORY_MONTHS }, () => 0) // full months only, oldest first
  const loans = new Set<string>()
  // Each lender's borrowers, month by month: `${lenderId} ${monthIndex}` → borrower ids.
  const borrowersIn = new Map<string, Set<string>>()
  // The borrowers who earned THIS view something, month by month (this month last), for the page.
  const viewBorrowers = Array.from({ length: HISTORY_MONTHS + 1 }, () => new Set<string>())
  for (let m = -HISTORY_MONTHS; m <= 0; m += 1) {
    const monthFrom = firstOfMonth(start, m)
    const monthTo = m === 0 ? today : addDays(firstOfMonth(start, m + 1), -1)
    for (const r of input.history) {
      const own = accruedBetween(r.earnings, r.startOn, r.termDays, monthFrom, monthTo)
      const cut = accruedBetween(r.adminCut, r.startOn, r.termDays, monthFrom, monthTo)
      if (own + cut === 0) continue
      const key = `${r.lenderId} ${m}`
      borrowersIn.set(key, (borrowersIn.get(key) ?? new Set<string>()).add(r.borrowerId))
      if ((mine(r.lenderId) && own > 0) || (getsCut && cut > 0)) viewBorrowers[m + HISTORY_MONTHS].add(r.borrowerId)
      if (m === 0) continue
      potMonths[m + HISTORY_MONTHS] += own + cut
      if (m < startIdx) continue
      usualOwn.set(r.lenderId, (usualOwn.get(r.lenderId) ?? 0) + own)
      usualCut.set(r.lenderId, (usualCut.get(r.lenderId) ?? 0) + cut)
      if ((mine(r.lenderId) && own > 0) || (getsCut && cut > 0)) loans.add(r.loanId)
    }
  }
  // Borrower-months behind the average, per lender: what one borrower earns them a month.
  const borrowerMonths = new Map(ids.map((id) => [id, 0]))
  const busiest = new Map(ids.map((id) => [id, 0]))
  for (const [key, set] of borrowersIn) {
    const id = key.slice(0, key.lastIndexOf(' '))
    const m = Number(key.slice(key.lastIndexOf(' ') + 1))
    busiest.set(id, Math.max(busiest.get(id) ?? 0, set.size))
    if (m >= startIdx && m < 0) borrowerMonths.set(id, (borrowerMonths.get(id) ?? 0) + set.size)
  }
  for (const id of ids) {
    usualOwn.set(id, (usualOwn.get(id) as number) / Math.max(1, historyMonths))
    usualCut.set(id, (usualCut.get(id) as number) / Math.max(1, historyMonths))
  }
  if (historyMonths === 0) {
    // A new book: this month's loans, their whole interest, by start date. A few days
    // of spread would understate the month.
    for (const r of input.history) {
      if (index(r.startOn) !== 0 || daysBetween(r.startOn, today) < 0) continue
      usualOwn.set(r.lenderId, (usualOwn.get(r.lenderId) ?? 0) + r.earnings)
      usualCut.set(r.lenderId, (usualCut.get(r.lenderId) ?? 0) + r.adminCut)
      if ((mine(r.lenderId) && r.earnings > 0) || (getsCut && r.adminCut > 0)) loans.add(r.loanId)
    }
    for (const [key, set] of borrowersIn) {
      if (!key.endsWith(' 0')) continue
      const id = key.slice(0, key.lastIndexOf(' '))
      borrowerMonths.set(id, set.size)
    }
  }
  const basedOnLoans = loans.size
  // Per borrower, in a month of the average (a borrower-month): own and cut apart.
  const perOwn = (id: string) => ((borrowerMonths.get(id) as number) > 0 ? ((usualOwn.get(id) as number) * Math.max(1, historyMonths)) / (borrowerMonths.get(id) as number) : 0)
  const perCut = (id: string) => ((borrowerMonths.get(id) as number) > 0 ? ((usualCut.get(id) as number) * Math.max(1, historyMonths)) / (borrowerMonths.get(id) as number) : 0)
  // The what-if borrowers go to the viewed lender; on the whole pot, shared by the size of the pots.
  const extraBorrowers = Math.max(0, Math.floor(input.extraBorrowers ?? 0))
  const capitalSum = ids.reduce((s, id) => s + Math.max(0, input.capitalNow.get(id) ?? 0), 0)
  const extraFor = (id: string) =>
    whose.kind === 'lender' ? (id === whose.lenderId ? extraBorrowers : 0) : capitalSum > 0 ? (extraBorrowers * Math.max(0, input.capitalNow.get(id) ?? 0)) / capitalSum : 0
  const ceilOwn = new Map(ids.map((id) => [id, ((busiest.get(id) as number) + extraFor(id)) * perOwn(id)]))
  const ceilCut = new Map(ids.map((id) => [id, ((busiest.get(id) as number) + extraFor(id)) * perCut(id)]))
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

  const pots = new Map(capital0)
  const monthlyIn = input.monthlyIn ?? 0
  const monthlyOut = input.monthlyOut ?? 0

  let total = 0
  let heldFrom: Date | null = null
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
      const wantOwn = pot * ownRate(id)
      const wantCut = pot * cutRate(id)
      const retOwn = Math.min(wantOwn, ceilOwn.get(id) as number)
      const retCut = Math.min(wantCut, ceilCut.get(id) as number)
      const held = (mine(id) && retOwn < wantOwn - 0.5) || (getsCut && retCut < wantCut - 0.5)
      if (m > 0 && heldFrom === null && held) heldFrom = firstOfMonth(start, m)
      const own = Math.max(k.own[m], m === 0 ? 0 : Math.round(retOwn))
      const cut = Math.max(k.cut[m], m === 0 ? 0 : Math.round(retCut))
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
  // For the page: the borrowers who earned this view something, and what one earns it a month.
  const averaged = historyMonths > 0 ? viewBorrowers.slice(startIdx + HISTORY_MONTHS, HISTORY_MONTHS) : [viewBorrowers[HISTORY_MONTHS]]
  const viewBorrowerMonths = averaged.reduce((s, set) => s + set.size, 0)
  const perBorrowerView = viewBorrowerMonths > 0 ? (usual * Math.max(1, historyMonths)) / viewBorrowerMonths : 0
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
    busiestBorrowers: Math.max(...viewBorrowers.map((set) => set.size)),
    extraBorrowers,
    perBorrower: centavos(Math.round(perBorrowerView)),
    heldFrom,
  }
}

/** What part of a row's money belongs to the chosen view (used for overdue money). */
function viewShare(whose: Whose, adminId: string | null, lenderId: string, own: number, cut: number): number {
  if (whose.kind === 'pot') return own + cut
  return (lenderId === whose.lenderId ? own : 0) + (whose.lenderId === adminId ? cut : 0)
}
