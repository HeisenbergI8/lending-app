import { type Centavos, centavos } from './centavos.ts'
import { type InterestCollection } from './interest.ts'
import { DAYS_PER_WEEK, daysBetween } from './weeks.ts'
import { weeklyDueDates, weeklySchedule } from './weekly.ts'

/**
 * What falls due between two days, inclusive — the dashboard's "Due this week".
 *
 * WHAT IS OWED ON A DATE IN THE WINDOW, NOT WHAT IS ALREADY LATE. Money whose
 * date has passed is the Overdue tile's; counting it here as well would let the
 * two tiles add up to more than is owed.
 *
 *   Collected at the end — the whole total (capital + interest) when the due
 *   date is in the window.
 *
 *   Collected weekly — each UNPAID week whose date is in the window, at that
 *   week's interest, and the capital with it when the week is the last. A week
 *   already paid is not owed, and a missed earlier week is overdue, not due.
 *
 * Every loan given is unpaid (status ACTIVE) and not deleted; that is the
 * query's job, not this function's.
 */
export type DueLoan = {
  borrowerId: string
  interestCollection: InterestCollection
  /** Calendar days at local midday — storedCalendarDate, never the raw column. */
  startOn: Date
  dueOn: Date
  termDays: number
  capital: Centavos
  total: Centavos
  fundings: { lenderId: string; earnings: Centavos; adminCut: Centavos }[]
  /** Week numbers with a live (not undone) payment. */
  paidWeeks: ReadonlySet<number>
}

export function dueInWindow(
  loans: readonly DueLoan[],
  from: Date,
  to: Date,
): { total: Centavos; loans: number; borrowers: number } {
  const inWindow = (day: Date) => daysBetween(from, day) >= 0 && daysBetween(day, to) >= 0

  let total = 0
  let count = 0
  const people = new Set<string>()

  for (const loan of loans) {
    let owed = 0

    if (loan.interestCollection === 'WEEKLY') {
      const weeks = loan.termDays / DAYS_PER_WEEK
      const schedule = weeklySchedule(loan.fundings, weeks)
      const dates = weeklyDueDates(loan.startOn, weeks)
      schedule.forEach((instalment, index) => {
        if (loan.paidWeeks.has(instalment.week) || !inWindow(dates[index])) return
        owed += instalment.interest + (instalment.week === weeks ? loan.capital : 0)
      })
    } else if (inWindow(loan.dueOn)) {
      owed = loan.total
    }

    if (owed > 0) {
      total += owed
      count += 1
      people.add(loan.borrowerId)
    }
  }

  return { total: centavos(total), loans: count, borrowers: people.size }
}
