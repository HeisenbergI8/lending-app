import { type BasisPoints, type Centavos, bpsOf, centavos, checkedProduct } from './centavos.ts'
import { shortfalls } from './floating.ts'
import { type CapitalShare, DEFAULT_RELEND, type RelendHabit } from './forecast-history.ts'
import { type InterestCollection } from './interest.ts'
import { type RowArrival, type ScheduledRow, scheduleArrivals } from './projection.ts'
import { splitByWeight, splitLoan } from './split.ts'
import { DAYS_PER_WEEK, addDays, daysBetween, dueDateAfterWeeks, firstOfMonth, monthKey } from './weeks.ts'
import { MIN_WEEKLY_WEEKS } from './weekly.ts'

/**
 * THE PROJECTIONS ESTIMATE. Month by month, what every lender's pot would do if
 * the running loans come back as scheduled and the Admin keeps lending the way
 * a plan describes.
 *
 * IT INVENTS NO MONEY RULE. How a loan's money comes back is scheduleArrivals
 * (projection.ts), the same function the lender page's "Available on" uses. What
 * a pretend loan earns, and the Admin's cut on it, is splitLoan (split.ts) — the
 * function the loan form stores real loans with. Who is short of cash is
 * shortfalls (floating.ts), the check a real new loan must pass. The only things
 * decided here are the order of events in a month and the realistic scenario.
 *
 * NOTHING HERE IS STORED. A saved plan stores its inputs (ProjectionPlan); every
 * figure is recomputed on read, so a plan always projects from today's loans.
 */

export const MAX_HORIZON_MONTHS = 60
export const DEFAULT_HORIZON_MONTHS = 24
export const MAX_LOANS_PER_MONTH = 50
/** Below this, a lender's re-lend amount waits for next month rather than becoming a tiny loan. ₱1,000. */
export const MIN_RELEND_CENTAVOS = 100_000

export type PlannedMove = {
  lenderId: string
  type: 'DEPOSIT' | 'WITHDRAWAL'
  amount: Centavos
  /** 1st of the month, local midday. */
  fromMonth: Date
  /** False: once, in fromMonth. True: every month from fromMonth through untilMonth. */
  everyMonth: boolean
  /** Inclusive. Null with everyMonth means "to the end of the horizon". */
  untilMonth: Date | null
}

export type Plan = {
  horizonMonths: number
  newLoansPerMonth: number
  loanAmount: Centavos
  termWeeks: number
  borrowerRateBps: BasisPoints
  adminCutBps: BasisPoints
  collection: InterestCollection
  relend: boolean
  moves: readonly PlannedMove[]
}

export type ForecastLender = { id: string; isSelf: boolean; floatingNow: Centavos }

/**
 * One LoanFunding row on a running loan. Its capital and earnings come back to
 * `lenderId`; its adminCut comes back to the Admin's pot (isSelf).
 */
export type RealRow = ScheduledRow & { lenderId: string }

export type ForecastInput = {
  today: Date
  plan: Plan
  lenders: readonly ForecastLender[]
  realRows: readonly RealRow[]
  shares: readonly CapitalShare[]
  /** Per lender, from relendHabits. A lender missing here uses DEFAULT_RELEND. */
  habits: ReadonlyMap<string, RelendHabit>
}

export type Scenario =
  | { kind: 'best' }
  /** onTimeBps of every arrival lands on its day; the rest lateDelayDays later. */
  | { kind: 'realistic'; onTimeBps: BasisPoints; lateDelayDays: number }

export type Warning = {
  lenderId: string
  /** What asked for the money: the month's planned loans, or a planned withdrawal. */
  cause: 'loans' | 'withdrawal'
  asked: Centavos
  /** What the lender had at that moment. Can be negative. */
  available: Centavos
}

export type LenderMonth = {
  /** This pot's own earnings that come back during the month. */
  interest: Centavos
  /** The Admin cut that comes back during the month. Non-zero on the Admin's pot only. */
  adminCut: Centavos
  capitalBack: Centavos
  /** Capital lent out to pretend loans on the 1st. */
  lent: Centavos
  /** Cash at the end of the month. Negative when the plan overdrew it — never clamped. */
  cash: Centavos
  /** Capital in borrowers' hands at the end of the month, real and pretend. */
  out: Centavos
}

export type MonthResult = {
  month: Date
  plannedLoans: number
  /** Capital re-lent on the 1st, all lenders. Per lender it is inside LenderMonth.lent. */
  relent: Centavos
  byLender: ReadonlyMap<string, LenderMonth>
  warnings: Warning[]
}

export type Simulation = {
  months: MonthResult[]
  /** Owed on running loans before today and still unpaid. Assumed in NEITHER line, as in projectFloating. */
  lateNow: Centavos
  /** Why pretend loans could not be made at all, or null. Real loans are still projected. */
  refused: string | null
}

type Amounts = { capital: number; interest: number; adminCut: number }
type Template = { rows: (ScheduledRow & { lenderId: string })[] }

/** Calendar months from `from`'s month to `on`'s month. */
function monthIndex(from: Date, on: Date): number {
  return (on.getFullYear() - from.getFullYear()) * 12 + (on.getMonth() - from.getMonth())
}

/**
 * One pretend loan of `capital` starting on `startOn`, split by `weights`, priced
 * by splitLoan. A planned loan is weighted by the 6-month shares; a re-lend loan
 * by one lender alone ([{ lenderId, weight: 1 }]).
 */
function pretendLoan(
  input: ForecastInput,
  startOn: Date,
  capital: Centavos,
  weights: readonly CapitalShare[],
): Template | string {
  const { plan, lenders } = input
  if (weights.length === 0) return 'No loans were made in the last 6 months, so there is nothing to split new loans by.'
  if (plan.collection === 'WEEKLY' && plan.termWeeks < MIN_WEEKLY_WEEKS) {
    return `Interest collected weekly needs at least ${MIN_WEEKLY_WEEKS} weeks.`
  }
  if (plan.adminCutBps > plan.borrowerRateBps) return 'The Admin cut is larger than the rate charged.'
  const shares = weights
  const parts = splitByWeight(capital, shares.map((s) => ({ key: s.lenderId, weight: s.weight })))
  const self = new Set(lenders.filter((l) => l.isSelf).map((l) => l.id))
  const fundings = shares
    .filter((s) => (parts.get(s.lenderId) as number) > 0)
    .map((s) => ({
      lenderId: s.lenderId,
      principal: parts.get(s.lenderId) as Centavos,
      // The Admin's own pot earns the whole rate and pays no cut — the same
      // rule FunderInput.isSelf gives a real loan (server/loans/terms.ts).
      lenderRateBps: self.has(s.lenderId) ? plan.borrowerRateBps : plan.borrowerRateBps - plan.adminCutBps,
      adminCutBps: self.has(s.lenderId) ? 0 : plan.adminCutBps,
    }))
  const split = splitLoan({ capital, borrowerRateBps: plan.borrowerRateBps, weeks: plan.termWeeks, fundings })
  if (!split.ok) return `These loan settings cannot be split (${split.error.kind}).`
  const dueOn = dueDateAfterWeeks(startOn, plan.termWeeks)
  return {
    rows: split.value.lenders.map((share) => ({
      lenderId: share.lenderId,
      interestCollection: plan.collection,
      startOn,
      dueOn,
      termDays: plan.termWeeks * DAYS_PER_WEEK,
      principal: share.principal,
      earnings: share.earnings,
      adminCut: share.adminCut,
      paidWeeks: new Set<number>(),
    })),
  }
}

function moveApplies(move: PlannedMove, month: Date): boolean {
  const i = monthIndex(move.fromMonth, month)
  if (i < 0) return false
  if (!move.everyMonth) return i === 0
  return move.untilMonth === null || monthIndex(month, move.untilMonth) >= 0
}

export function simulate(input: ForecastInput, scenario: Scenario): Simulation {
  const { today, plan, lenders } = input
  const start = firstOfMonth(today)
  const horizon = Math.min(Math.max(plan.horizonMonths, 1), MAX_HORIZON_MONTHS)
  const adminId = lenders.find((l) => l.isSelf)?.id ?? null

  const cash = new Map(lenders.map((l) => [l.id, l.floatingNow as number]))
  const out = new Map(lenders.map((l) => [l.id, 0]))
  // incoming[month][lenderId] — money that will come back during that month.
  const incoming = Array.from({ length: horizon }, () => new Map<string, Amounts>())
  // relendQueue[month][lenderId] — returned money a lender will re-lend on that month's 1st.
  const relendQueue = Array.from({ length: horizon }, () => new Map<string, number>())
  const pool = new Map(lenders.map((l) => [l.id, 0]))
  let lateNow = 0

  const credit = (month: number, lenderId: string, part: Amounts) => {
    if (month < 0 || month >= horizon) return // past the horizon: not lost, just not drawn
    const now = incoming[month].get(lenderId) ?? { capital: 0, interest: 0, adminCut: 0 }
    now.capital += part.capital
    now.interest += part.interest
    now.adminCut += part.adminCut
    incoming[month].set(lenderId, now)
  }

  /** Book one arrival `times` over, splitting it by scenario. Capital+interest to the funder, cut to the Admin. */
  const book = (lenderId: string, a: RowArrival, times: number) => {
    const scale = (x: Centavos) => centavos(checkedProduct(x, times))
    const whole = { on: a.on, capital: scale(a.capital), interest: scale(a.interest), adminCut: scale(a.adminCut) }
    const pieces =
      scenario.kind === 'best'
        ? [whole]
        : (() => {
            const onTime = {
              on: whole.on,
              capital: bpsOf(whole.capital, scenario.onTimeBps),
              interest: bpsOf(whole.interest, scenario.onTimeBps),
              adminCut: bpsOf(whole.adminCut, scenario.onTimeBps),
            }
            return [
              onTime,
              {
                on: addDays(whole.on, scenario.lateDelayDays),
                capital: whole.capital - onTime.capital,
                interest: whole.interest - onTime.interest,
                adminCut: whole.adminCut - onTime.adminCut,
              },
            ]
          })()
    for (const p of pieces) {
      const m = monthIndex(start, p.on)
      credit(m, lenderId, { capital: p.capital, interest: p.interest, adminCut: 0 })
      if (p.adminCut > 0) {
        if (adminId === null) throw new Error('An Admin cut with no Admin pot to receive it.')
        credit(m, adminId, { capital: 0, interest: 0, adminCut: p.adminCut })
      }
    }
  }

  for (const row of input.realRows) {
    out.set(row.lenderId, (out.get(row.lenderId) ?? 0) + row.principal)
    for (const a of scheduleArrivals(row)) {
      if (daysBetween(today, a.on) < 0) {
        lateNow += a.capital + a.interest + a.adminCut
        continue
      }
      book(row.lenderId, a, 1)
    }
  }

  const months: MonthResult[] = []
  let refused: string | null = null

  for (let m = 0; m < horizon; m += 1) {
    const month = firstOfMonth(start, m)
    const warnings: Warning[] = []
    const lent = new Map<string, number>()

    for (const move of plan.moves) {
      if (!moveApplies(move, month) || !cash.has(move.lenderId)) continue
      const have = cash.get(move.lenderId) as number
      if (move.type === 'WITHDRAWAL' && move.amount > have) {
        warnings.push({ lenderId: move.lenderId, cause: 'withdrawal', asked: move.amount, available: centavos(have) })
      }
      cash.set(move.lenderId, have + (move.type === 'DEPOSIT' ? move.amount : -move.amount))
    }

    const make = (template: Template, count: number) => {
      for (const row of template.rows) {
        const principal = checkedProduct(row.principal, count)
        cash.set(row.lenderId, (cash.get(row.lenderId) ?? 0) - principal)
        out.set(row.lenderId, (out.get(row.lenderId) ?? 0) + principal)
        lent.set(row.lenderId, (lent.get(row.lenderId) ?? 0) + principal)
        for (const a of scheduleArrivals(row)) book(row.lenderId, a, count)
      }
    }

    let planned = 0
    if (m >= 1 && plan.newLoansPerMonth > 0) {
      const template = pretendLoan(input, month, plan.loanAmount, input.shares)
      if (typeof template === 'string') {
        refused ??= template
      } else {
        planned = Math.min(plan.newLoansPerMonth, MAX_LOANS_PER_MONTH)
        const asked = template.rows.map((r) => ({ lenderId: r.lenderId, principal: centavos(checkedProduct(r.principal, planned)) }))
        for (const s of shortfalls(asked, (id) => centavos(cash.get(id) ?? 0))) {
          warnings.push({ lenderId: s.lenderId, cause: 'loans', asked: s.asked, available: s.floating })
        }
        make(template, planned) // still projected, as agreed: warned, not skipped
      }
    }

    // RE-LENDING, PER LENDER (owner, 2026-11-08). Each lender re-lends only from
    // their own queue and only up to their own cash, so one lender short of
    // cash never holds back another, and re-lending alone never causes a warning.
    let relent = 0
    if (plan.relend) {
      for (const l of lenders) {
        const waiting = (pool.get(l.id) as number) + (relendQueue[m].get(l.id) ?? 0)
        const amount = Math.min(waiting, Math.max(0, cash.get(l.id) as number))
        if (amount >= MIN_RELEND_CENTAVOS) {
          const template = pretendLoan(input, month, centavos(amount), [{ lenderId: l.id, weight: centavos(1) }])
          if (typeof template === 'string') {
            refused ??= template
          } else {
            make(template, 1)
            relent += amount
            pool.set(l.id, waiting - amount)
            continue
          }
        }
        pool.set(l.id, waiting)
      }
    }

    const byLender = new Map<string, LenderMonth>()
    for (const l of lenders) {
      const back = incoming[m].get(l.id) ?? { capital: 0, interest: 0, adminCut: 0 }
      const total = back.capital + back.interest + back.adminCut
      const c = (cash.get(l.id) as number) + total
      cash.set(l.id, c)
      out.set(l.id, (out.get(l.id) as number) - back.capital)
      if (plan.relend && total > 0) {
        const habit = input.habits.get(l.id) ?? DEFAULT_RELEND
        const when = m + Math.max(1, habit.lagMonths)
        if (when < horizon) relendQueue[when].set(l.id, (relendQueue[when].get(l.id) ?? 0) + bpsOf(centavos(total), habit.shareBps))
      }
      byLender.set(l.id, {
        interest: centavos(back.interest),
        adminCut: centavos(back.adminCut),
        capitalBack: centavos(back.capital),
        lent: centavos(lent.get(l.id) ?? 0),
        cash: centavos(c),
        out: centavos(out.get(l.id) as number),
      })
    }
    months.push({ month, plannedLoans: planned, relent: centavos(relent), byLender, warnings })
  }

  return { months, lateNow: centavos(lateNow), refused }
}

export type View = { kind: 'admin-cut' } | { kind: 'lender'; lenderId: string } | { kind: 'pot' }

export type ViewMonth = {
  month: Date
  /** "2027-01" — the `?month=` value. */
  key: string
  /** Interest that comes back DURING this month, in this view. */
  interest: Centavos
  /** Running total from today through the end of this month. Not from the start of time. */
  interestToDate: Centavos
  /** Idle cash at month end, in this view. Null on the Admin-cut view, which is not a pot. */
  cash: Centavos | null
  /**
   * POT SIZE at month end: cash + capital out on loan (real and pretend), in
   * this view. Interest still to come is NOT in it — only money that exists.
   * Null on the Admin-cut view. Capital on loans already overdue today stays in
   * `out` (it is still owed), so this matches a pot that has not written it off.
   */
  potSize: Centavos | null
  warnings: Warning[]
}

/**
 * One line of the chart.
 *
 *   admin-cut   the Admin cut alone (LenderMonth.adminCut on the Admin's pot).
 *               NOT the Admin's earnings as a lender — pick the Admin under
 *               "per lender" for those. Two different figures, two views.
 *   lender      that pot's own earnings; its cash.
 *   pot         every pot's earnings plus the Admin cut; all cash summed.
 *
 * Warnings: the lender view shows its own lender's; the other two show all,
 * because any lender short of cash means the plan as written cannot happen.
 */
export function forecastView(sim: Simulation, view: View): ViewMonth[] {
  let running = 0
  return sim.months.map((m) => {
    const rows = [...m.byLender.entries()]
    const pick =
      view.kind === 'lender' ? rows.filter(([id]) => id === view.lenderId) : rows
    const interest =
      view.kind === 'admin-cut'
        ? pick.reduce((s, [, r]) => s + r.adminCut, 0)
        : view.kind === 'lender'
          ? pick.reduce((s, [, r]) => s + r.interest, 0)
          : pick.reduce((s, [, r]) => s + r.interest + r.adminCut, 0)
    running += interest
    const cash = pick.reduce((s, [, r]) => s + r.cash, 0)
    const out = pick.reduce((s, [, r]) => s + r.out, 0)
    return {
      month: m.month,
      key: monthKey(m.month),
      interest: centavos(interest),
      interestToDate: centavos(running),
      cash: view.kind === 'admin-cut' ? null : centavos(cash),
      potSize: view.kind === 'admin-cut' ? null : centavos(cash + out),
      warnings: view.kind === 'lender' ? m.warnings.filter((w) => w.lenderId === view.lenderId) : m.warnings,
    }
  })
}

export function monthOf(series: readonly ViewMonth[], key: string): ViewMonth | null {
  return series.find((m) => m.key === key) ?? null
}

/** What "when do I reach ₱X" measures — the user picks (owner, 2026-11-08). */
export type TargetKind = 'interest' | 'pot'

/**
 * The first month that reaches `target`, or null inside the horizon.
 *   interest  the running total of estimated interest from today (interestToDate)
 *   pot       the pot size at month end (cash + capital out); never met on the
 *             Admin-cut view, where potSize is null — the page hides the option there
 */
export function reachTarget(series: readonly ViewMonth[], target: Centavos, kind: TargetKind): ViewMonth | null {
  return (
    series.find((m) => (kind === 'interest' ? m.interestToDate >= target : m.potSize !== null && m.potSize >= target)) ?? null
  )
}

/** Both lines for one plan. `realistic` is null when history gave no on-time rate. */
export function forecast(
  input: ForecastInput,
  history: { onTimeBps: BasisPoints | null; lateDelayDays: number | null },
): { best: Simulation; realistic: Simulation | null } {
  return {
    best: simulate(input, { kind: 'best' }),
    realistic:
      history.onTimeBps === null
        ? null
        : simulate(input, { kind: 'realistic', onTimeBps: history.onTimeBps, lateDelayDays: history.lateDelayDays ?? FALLBACK_LATE_DAYS }),
  }
}

/** Used only when amounts were late but none of the late ones has been paid yet. Flagged in the plan. */
export const FALLBACK_LATE_DAYS = 30
