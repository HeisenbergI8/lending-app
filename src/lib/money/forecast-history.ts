import { type BasisPoints, type Centavos, BPS_DENOMINATOR, centavos } from './centavos.ts'
import { type InterestBasis, type InterestCollection } from './interest.ts'
import { type ScheduledRow, scheduleArrivals } from './projection.ts'
import { DAYS_PER_WEEK, daysBetween, firstOfMonth } from './weeks.ts'
import { weeklyDueDates } from './weekly.ts'

/**
 * What the Projections estimate learns from real history. Every figure here is
 * an INPUT to an estimate, and the page prints each one beside what it was
 * computed from ("from 14 loans since 1 May 2026") so the Admin can judge it.
 *
 * THE WINDOW is "since the 1st of the month six months before this one", not
 * "today minus 183 days": a month-aligned start cannot roll over (31 August
 * minus six months is not a date), and the estimate's own step is a month.
 */
export const HISTORY_MONTHS = 6

export function historyWindowStart(today: Date): Date {
  return firstOfMonth(today, -HISTORY_MONTHS)
}

// ---------------------------------------------------------------- lender split

export type ShareFunding = { lenderId: string; principal: Centavos; startOn: Date }
export type CapitalShare = { lenderId: string; weight: Centavos }

/**
 * Each lender's capital put into loans started in the window — the weights a
 * pretend loan is split by (split.ts splitByWeight).
 *
 * The server passes every LoanFunding row on a NON-DELETED loan, ACTIVE or PAID,
 * of either InterestBasis: capital left the lender's pot either way. Lenders not
 * in `current` (deleted since) are dropped, and the rest share 100% between them.
 * The Admin's own pot is a lender like any other here (isSelf is not consulted).
 *
 * Empty when nothing was lent in the window. The caller must refuse to project
 * pretend loans then, because there is nothing to split by — see the page.
 */
export function capitalShares(
  rows: readonly ShareFunding[],
  today: Date,
  current: ReadonlySet<string>,
): CapitalShare[] {
  const from = historyWindowStart(today)
  const byLender = new Map<string, number>()
  for (const row of rows) {
    if (!current.has(row.lenderId)) continue
    if (daysBetween(from, row.startOn) < 0 || daysBetween(row.startOn, today) < 0) continue
    byLender.set(row.lenderId, (byLender.get(row.lenderId) ?? 0) + row.principal)
  }
  return [...byLender]
    .filter(([, weight]) => weight > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lenderId, weight]) => ({ lenderId, weight: centavos(weight) }))
}

// ---------------------------------------------------------------- on time

/**
 * One loan as the on-time measure needs it. Built by the server from Loan,
 * its live Payments and its LoanExtensions. dueOn is Loan.dueOn — the date an
 * extension moved it TO, because an extension is agreed, not late (owner,
 * 2026-11-08), exactly as trackRecord reads it.
 */
export type HistoryLoan = {
  interestCollection: InterestCollection
  startOn: Date
  dueOn: Date
  termDays: number
  /** paidOn of the live settling Payment (weekNumber null). */
  settledOn: Date | null
  /** paidOn of each live weekly Payment, by weekNumber. */
  weekPaidOn: ReadonlyMap<number, Date>
  /** Closed by an extension whose capital carried on as a new loan. Not counted, as in trackRecord. */
  closedByExtension: boolean
}

/** One amount that was due on a day, and when (if ever) it arrived. */
export type DueRecord = { dueOn: Date; paidOn: Date | null }

/**
 * Every amount this loan was due to hand over, each with its due day.
 *
 * AT_END: one, on dueOn. WEEKLY: weeks 1..N-1 on their own week dates, then the
 * settling payment on dueOn. An extended loan is measured against its EXTENDED
 * due date, the same as src/lib/track-record.ts — a loan extended from 4 weeks
 * to 8 and paid at week 8 is on time. See plan §1.3.
 */
export function dueRecords(loan: HistoryLoan): DueRecord[] {
  if (loan.closedByExtension) return []
  const settleDue = loan.dueOn
  if (loan.interestCollection !== 'WEEKLY') return [{ dueOn: settleDue, paidOn: loan.settledOn }]
  const weeks = loan.termDays / DAYS_PER_WEEK
  const dates = weeklyDueDates(loan.startOn, weeks)
  return [
    ...dates.slice(0, -1).map((dueOn, index) => ({ dueOn, paidOn: loan.weekPaidOn.get(index + 1) ?? null })),
    { dueOn: settleDue, paidOn: loan.settledOn },
  ]
}

export type OnTime = {
  /** Due amounts in the window, due before today. */
  counted: number
  onTime: number
  /** floor(10000 x onTime / counted). Null when nothing was due in the window. */
  bps: BasisPoints | null
  from: Date
}

/**
 * The share of due amounts that arrived ON OR BEFORE their due day.
 *
 * Counted: due on or after the window start and BEFORE today (an amount due
 * today has not had its whole day yet). Not on time: paid after its due day, or
 * still unpaid. Paying ON the due day is on time, as in trackRecord. A count of
 * amounts, not pesos — one large late loan should not swing it. See plan §1.3.
 */
export function onTimeRate(records: readonly DueRecord[], today: Date): OnTime {
  const from = historyWindowStart(today)
  let counted = 0
  let onTime = 0
  for (const r of records) {
    if (daysBetween(from, r.dueOn) < 0 || daysBetween(r.dueOn, today) <= 0) continue
    counted += 1
    if (r.paidOn !== null && daysBetween(r.dueOn, r.paidOn) <= 0) onTime += 1
  }
  return { counted, onTime, bps: counted === 0 ? null : Math.floor((BPS_DENOMINATOR * onTime) / counted), from }
}

/**
 * How many days late a late amount typically arrived: the median over amounts
 * in the window that WERE paid, after their due day. Null when none were.
 * The realistic line moves the not-on-time share of every arrival by this much.
 * Unpaid amounts are not in it — they have no lateness yet, only a count above.
 */
export function lateDelayDays(records: readonly DueRecord[], today: Date): number | null {
  const from = historyWindowStart(today)
  const late = records
    .filter((r) => r.paidOn !== null && daysBetween(from, r.dueOn) >= 0 && daysBetween(r.dueOn, today) > 0)
    .map((r) => daysBetween(r.dueOn, r.paidOn as Date))
    .filter((days) => days > 0)
    .sort((a, b) => a - b)
  if (late.length === 0) return null
  return late[Math.floor((late.length - 1) / 2)]
}

// ---------------------------------------------------------------- defaults

export type DefaultsLoan = {
  startOn: Date
  interestBasis: InterestBasis
  interestCollection: InterestCollection
  borrowerRateBps: number | null
  /** adminCutBps of every NON-self funding row on the loan. */
  cutBps: number[]
}

export type Defaults = {
  borrowerRateBps: BasisPoints
  adminCutBps: BasisPoints
  collection: InterestCollection
  /** WEEKLY_RATE loans started in the window. Zero means every figure is the fallback. */
  basedOn: number
}

/** The most common value; a tie goes to the one seen on the most recent loan. */
function mostCommon<T>(valuesNewestFirst: T[]): T | null {
  const counts = new Map<T, number>()
  for (const v of valuesNewestFirst) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | null = null
  let bestCount = 0
  for (const [v, n] of counts) if (n > bestCount) [best, bestCount] = [v, n]
  return best
}

/**
 * The rate, cut and collection style a new plan starts with — the MOST COMMON
 * over WEEKLY_RATE loans started in the window. Most common rather than the
 * average: an average of 7% and 6% is 6.5%, a rate nobody charged.
 * FIXED_AMOUNT loans are left out entirely: they have no rate (their *RateBps
 * columns are NULL) and are never WEEKLY.
 */
export function historyDefaults(
  loans: readonly DefaultsLoan[],
  today: Date,
  fallback: { borrowerRateBps: BasisPoints; adminCutBps: BasisPoints },
): Defaults {
  const from = historyWindowStart(today)
  const rated = loans
    .filter((l) => l.interestBasis === 'WEEKLY_RATE' && l.borrowerRateBps !== null)
    .filter((l) => daysBetween(from, l.startOn) >= 0 && daysBetween(l.startOn, today) >= 0)
    .sort((a, b) => b.startOn.getTime() - a.startOn.getTime())
  return {
    borrowerRateBps: mostCommon(rated.map((l) => l.borrowerRateBps as number)) ?? fallback.borrowerRateBps,
    adminCutBps: mostCommon(rated.flatMap((l) => l.cutBps)) ?? fallback.adminCutBps,
    collection: mostCommon(rated.map((l) => l.interestCollection)) ?? 'AT_END',
    basedOn: rated.length,
  }
}

// ---------------------------------------------------------------- re-lending habits

/** Money handed back to one lender's pot on a day: capital + own earnings, or the cut on the Admin pot. */
export type ReturnEvent = { lenderId: string; on: Date; amount: Centavos }
export type LendEvent = { lenderId: string; on: Date; principal: Centavos }

/** One funding row of a loan, as scheduleArrivals reads it. paidWeeks is ignored here. */
export type ReturnFunding = ScheduledRow & { lenderId: string }

/**
 * What each live payment on one loan handed back, per pot.
 *
 * Each payment's share comes from scheduleArrivals — the projection's own rule —
 * so a weekly row is that week's slice and the settling row is the capital plus
 * the last slice. The Admin cut goes to the Admin pot.
 *
 * A loan CLOSED BY AN EXTENSION ("interest paid now") handed back its interest
 * only: its capital carried on as the continuation loan without leaving the
 * borrower. So capital is left out of its settling payment.
 */
export function returnEvents(
  loan: { rows: readonly ReturnFunding[]; payments: readonly { weekNumber: number | null; paidOn: Date }[]; closedByExtension: boolean },
  adminId: string | null,
): ReturnEvent[] {
  const out: ReturnEvent[] = []
  for (const row of loan.rows) {
    const arrivals = scheduleArrivals({ ...row, paidWeeks: new Set() })
    for (const p of loan.payments) {
      const a = p.weekNumber === null ? arrivals.find((x) => x.final) : arrivals[p.weekNumber - 1]
      if (!a) continue
      const capital = p.weekNumber === null && loan.closedByExtension ? 0 : a.capital
      if (capital + a.interest > 0) out.push({ lenderId: row.lenderId, on: p.paidOn, amount: centavos(capital + a.interest) })
      if (a.adminCut > 0 && adminId !== null) out.push({ lenderId: adminId, on: p.paidOn, amount: a.adminCut })
    }
  }
  return out
}

export type RelendHabit = {
  /** Share of returned money this lender re-lent. An UPPER BOUND — see plan §1.4. */
  shareBps: BasisPoints
  /** Months from a return to this lender's next lending, as measured. 0 = the same month. */
  lagMonths: number
  /** 'default' when there was too little history: the page must say so, by name. */
  basis: 'history' | 'default'
  /** Months with a return in the window — printed beside the figure. */
  returnMonths: number
}

export const MIN_RETURN_MONTHS = 2
export const DEFAULT_RELEND: RelendHabit = { shareBps: BPS_DENOMINATOR, lagMonths: 1, basis: 'default', returnMonths: 0 }

const monthNumber = (d: Date) => d.getFullYear() * 12 + d.getMonth()

/**
 * Each lender's own re-lending habit over the window (owner, 2026-11-08).
 *
 *   share  min(100%, lent / returned), lending counted from the first month
 *          with a return onward
 *   lag    median, over months with a return, of months until this lender next
 *          lent anything (0 if the same month); default when they never did
 *
 * Fewer than MIN_RETURN_MONTHS months with a return: DEFAULT_RELEND (100%, one
 * month), marked basis 'default'. A lender with returns who never lent again
 * gets share 0 — that IS their history.
 *
 * KNOWN LIMIT: lending paid for by a fresh deposit looks like re-lending, so
 * the share errs high. Deposits are not subtracted because the deposit rows on
 * this account were entered loan by loan after the fact (schema, Lender).
 */
export function relendHabits(
  returns: readonly ReturnEvent[],
  lends: readonly LendEvent[],
  today: Date,
  lenderIds: readonly string[],
): Map<string, RelendHabit> {
  const from = historyWindowStart(today)
  const inWindow = (d: Date) => daysBetween(from, d) >= 0 && daysBetween(d, today) >= 0
  const byMonth = (events: { lenderId: string; on: Date; amount: number }[], id: string) => {
    const m = new Map<number, number>()
    for (const e of events) if (e.lenderId === id && inWindow(e.on) && e.amount > 0) m.set(monthNumber(e.on), (m.get(monthNumber(e.on)) ?? 0) + e.amount)
    return m
  }
  const habits = new Map<string, RelendHabit>()
  for (const id of lenderIds) {
    const back = byMonth([...returns], id)
    const lent = byMonth(lends.map((l) => ({ lenderId: l.lenderId, on: l.on, amount: l.principal })), id)
    const returnMonths = [...back.keys()].sort((a, b) => a - b)
    if (returnMonths.length < MIN_RETURN_MONTHS) {
      habits.set(id, { ...DEFAULT_RELEND, returnMonths: returnMonths.length })
      continue
    }
    const first = returnMonths[0]
    const totalBack = [...back.values()].reduce((s, v) => s + v, 0)
    const totalLent = [...lent].filter(([m]) => m >= first).reduce((s, [, v]) => s + v, 0)
    const lentMonths = [...lent.keys()].sort((a, b) => a - b)
    const lags = returnMonths
      .flatMap((m) => {
        const next = lentMonths.find((x) => x >= m)
        return next === undefined ? [] : [next - m]
      })
      .sort((a, b) => a - b)
    habits.set(id, {
      shareBps: Math.min(BPS_DENOMINATOR, Math.floor((BPS_DENOMINATOR * totalLent) / totalBack)),
      lagMonths: lags.length === 0 ? DEFAULT_RELEND.lagMonths : lags[Math.floor((lags.length - 1) / 2)],
      basis: 'history',
      returnMonths: returnMonths.length,
    })
  }
  return habits
}

// ---------------------------------------------------------------- the automatic plan

export type HabitLoan = {
  startOn: Date
  capital: Centavos
  termDays: number
  /** A continuation loan (made by an "interest paid now" extension) moved no new capital. */
  continuation: boolean
}

export type AutoPlan = {
  newLoansPerMonth: number
  loanAmount: Centavos
  termWeeks: number
  /** New loans started in the window — printed beside the plan ("from 8 loans since 1 May"). */
  basedOn: number
}

/** Rounded to the nearest ₱1,000, so the plan reads as a figure a person would choose. */
const ROUND_TO = 100_000

/**
 * THE PLAN NOBODY HAS TO TYPE (owner, 2026-11-08): "carry on lending the way
 * you have been". From the new loans started in the history window:
 *
 *   loans a month   their count over HISTORY_MONTHS, rounded; at least 1 when
 *                   there were any, so a light lender is not projected as none
 *   amount          their average capital, to the nearest ₱1,000 (at least ₱1,000)
 *   length          the most common whole-week term; 4 weeks when none is whole
 *
 * Continuation loans are left out: they are the same money carried on, not new
 * lending. With no new loans in the window the plan makes none, and the page
 * projects the running loans alone.
 */
export function autoPlan(loans: readonly HabitLoan[], today: Date): AutoPlan {
  const from = historyWindowStart(today)
  const recent = loans
    .filter((l) => !l.continuation && daysBetween(from, l.startOn) >= 0 && daysBetween(l.startOn, today) >= 0)
    .sort((a, b) => b.startOn.getTime() - a.startOn.getTime())
  if (recent.length === 0) return { newLoansPerMonth: 0, loanAmount: centavos(0), termWeeks: 4, basedOn: 0 }
  const average = recent.reduce((s, l) => s + l.capital, 0) / recent.length
  const weeks = mostCommon(recent.filter((l) => l.termDays % DAYS_PER_WEEK === 0).map((l) => l.termDays / DAYS_PER_WEEK))
  return {
    newLoansPerMonth: Math.max(1, Math.round(recent.length / HISTORY_MONTHS)),
    loanAmount: centavos(Math.max(ROUND_TO, Math.round(average / ROUND_TO) * ROUND_TO)),
    termWeeks: weeks ?? 4,
    basedOn: recent.length,
  }
}
