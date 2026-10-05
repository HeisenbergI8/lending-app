import { type Centavos, centavos } from './centavos.ts'
import { type InterestCollection } from './interest.ts'
import { DAYS_PER_WEEK, daysBetween } from './weeks.ts'
import { weeklyDueDates, weeklySlices } from './weekly.ts'

/**
 * A lender's floating funds ON A CHOSEN DAY, if every borrower pays on time.
 *
 *   floating on D = floating today + everything scheduled to come back to this
 *                   pot from today through D
 *
 * "Comes back" is exactly what lib/money/floating.ts adds to floating when a
 * payment is recorded, so a projection to a day after every loan ends lands on
 * the same figure the ledger will show once they are all paid:
 *
 *   loan collected at the end — on its due date, this pot's capital, its own
 *     earnings, and (Admin pot only) the Admin cut on other lenders' capital;
 *   loan collected weekly — on each unpaid week's date, that week's slice of
 *     the earnings and of the cut, and the capital with the last week. Slices
 *     come from weeklySlices, the same split releasedOnFunding uses.
 *
 * MONEY ALREADY LATE IS NOT ASSUMED. An unpaid date before today has no day it
 * is going to arrive on, so it is reported apart (`late`) and left out of the
 * projection rather than counted as if it will turn up.
 *
 * Nothing that has not happened yet is invented: no new loans, deposits or
 * withdrawals. Those move the real figure the day they are recorded.
 */

export type ProjectedRow = {
  loanId: string
  borrowerName: string
  interestCollection: InterestCollection
  /** Calendar days at local midday (storedCalendarDate), never the raw column. */
  startOn: Date
  dueOn: Date
  termDays: number
  /** This pot's capital in the loan. Zero on a row that only carries the Admin cut. */
  principal: Centavos
  /** This pot's own earnings on the row (LoanFunding.earningsCentavos). */
  earnings: Centavos
  /** The Admin cut this pot receives on the row: the Admin pot only, else zero. */
  adminCut: Centavos
  /** Weeks with a live payment. Empty on a loan collected at the end. */
  paidWeeks: ReadonlySet<number>
}

export type Arrival = {
  loanId: string
  borrowerName: string
  on: Date
  capital: Centavos
  interest: Centavos
  adminCut: Centavos
  /** True when it is the last week (or the whole loan) — the capital comes with it. */
  final: boolean
}

export type Projection = {
  floatingNow: Centavos
  /** floatingNow plus every arrival from today through the chosen day. */
  projected: Centavos
  capital: Centavos
  interest: Centavos
  adminCuts: Centavos
  /** In date order, one per loan and day. */
  arrivals: Arrival[]
  /** Owed on dates before today and still unpaid: NOT in `projected`. */
  late: Centavos
}

export function projectFloating(
  floatingNow: Centavos,
  rows: readonly ProjectedRow[],
  today: Date,
  on: Date,
): Projection {
  const arrivals: Arrival[] = []
  let late = 0

  const add = (row: ProjectedRow, day: Date, capital: number, interest: number, adminCut: number, final: boolean) => {
    if (capital + interest + adminCut === 0) return
    if (daysBetween(today, day) < 0) {
      late += capital + interest + adminCut
      return
    }
    if (daysBetween(day, on) < 0) return
    // One line per loan per day, even when two rows of it reach this pot (a
    // loan the Admin funded alongside someone else: own row + cut on theirs).
    const same = arrivals.find((a) => a.loanId === row.loanId && a.on.getTime() === day.getTime())
    if (same) {
      same.capital = centavos(same.capital + capital)
      same.interest = centavos(same.interest + interest)
      same.adminCut = centavos(same.adminCut + adminCut)
      same.final ||= final
      return
    }
    arrivals.push({
      loanId: row.loanId,
      borrowerName: row.borrowerName,
      on: day,
      capital: centavos(capital),
      interest: centavos(interest),
      adminCut: centavos(adminCut),
      final,
    })
  }

  for (const row of rows) {
    if (row.interestCollection === 'WEEKLY') {
      const weeks = row.termDays / DAYS_PER_WEEK
      const earnings = weeklySlices(row.earnings, weeks)
      const cuts = weeklySlices(row.adminCut, weeks)
      weeklyDueDates(row.startOn, weeks).forEach((day, index) => {
        const week = index + 1
        if (row.paidWeeks.has(week)) return
        const last = week === weeks
        add(row, day, last ? row.principal : 0, earnings[index], cuts[index], last)
      })
    } else {
      add(row, row.dueOn, row.principal, row.earnings, row.adminCut, true)
    }
  }

  arrivals.sort((a, b) => a.on.getTime() - b.on.getTime() || a.borrowerName.localeCompare(b.borrowerName))
  const sum = (pick: (a: Arrival) => number) => centavos(arrivals.reduce((total, a) => total + pick(a), 0))
  const capital = sum((a) => a.capital)
  const interest = sum((a) => a.interest)
  const adminCuts = sum((a) => a.adminCut)

  return {
    floatingNow,
    projected: centavos(floatingNow + capital + interest + adminCuts),
    capital,
    interest,
    adminCuts,
    arrivals,
    late: centavos(late),
  }
}
