import { type Centavos, centavos } from './centavos.ts'
import { DAYS_PER_WEEK, addDays } from './weeks.ts'

/**
 * Collecting a loan's interest week by week instead of all at the end.
 *
 * THIS IS NOT A THIRD INTEREST BASIS. Every figure here is carved out of
 * numbers the loan was already created with — LoanFunding.earningsCentavos and
 * LoanFunding.adminCutCentavos, fixed the day the loan was made by split.ts.
 * Nothing recalculates from a rate, so a default rate changed next year cannot
 * reach back into a week that has already been collected. What changes is WHEN
 * the money is released, never how much it is.
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE DESIGN, and reversing it breaks one of
 * the two invariants. Each funder's own total is sliced across the weeks, and a
 * week's interest is then DEFINED as the sum of that week's funder slices. Done
 * the other way round — slice the loan's interest, then divide each week between
 * the funders — a funder's weeks stop summing to what they are owed, and the
 * loan pays somebody a centavo it never charged.
 *
 *   funder slices sum to the week       because the week IS that sum
 *   a funder's weeks sum to their total because the last week is a subtraction
 *   every week sums to the interest     because split.ts already guaranteed the
 *                                       funder totals do
 *
 * THE REMAINDER LANDS ON THE FINAL WEEK, which is the rule FEATURES.md section
 * 5 sets and the same rule split.ts already follows. Weeks 1 to N-1 are exactly
 * equal; the final week may be a few centavos larger. That is safe rather than
 * merely tidy, because the final week is handed over in one payment with the
 * capital: the uneven week is never released on its own, so what has been paid
 * out part-way through a loan is always an exact multiple of a whole-centavo
 * figure. See releasedOnFunding, which is the one rule for money that has
 * actually reached somebody.
 */

/** A loan runs at least two weeks to be worth collecting weekly. One week is just a loan. */
export const MIN_WEEKLY_WEEKS = 2

/**
 * One amount split into `weeks` whole-centavo parts that sum back to it exactly.
 *
 * Not largest-remainder, and deliberately: every week of a weekly loan is the
 * same money on the same terms, so there is nothing to rank them by. The parts
 * are equal and the last one carries whatever did not divide.
 */
export function weeklySlices(total: Centavos, weeks: number): Centavos[] {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`A weekly schedule runs a whole number of weeks, at least one. Got ${weeks}`)
  }
  if (total < 0) throw new Error(`A weekly schedule splits a non-negative amount, got ${total}`)

  const base = Math.floor(total / weeks)
  const slices = Array.from({ length: weeks - 1 }, () => centavos(base))
  slices.push(centavos(total - base * (weeks - 1)))
  return slices
}

/** One funder's stake in a weekly loan, read off the row that was stored at creation. */
export type WeeklyFunder = {
  lenderId: string
  /** LoanFunding.earningsCentavos — what this funder's own capital earns over the whole term. */
  earnings: Centavos
  /** LoanFunding.adminCutCentavos — the Admin's cut on this row. Zero on the Admin's own row. */
  adminCut: Centavos
}

/** What one week of a weekly loan releases, and to whom. */
export type WeeklyInstalment = {
  /** 1-based. Week N is the last, and is collected with the capital. */
  week: number
  /** Interest charged for this week. The sum of the two figures below. */
  interest: Centavos
  /** Straight into each funder's floating the day the week is paid. */
  lenders: { lenderId: string; earnings: Centavos }[]
  /** Straight into Admin earnings the day the week is paid. */
  adminCut: Centavos
}

/**
 * The whole schedule, built from the funding rows a loan already carries.
 *
 * `funders` is every LoanFunding row on the loan, and the Admin's cut is taken
 * from those same rows rather than from a rate — exactly as adminTakeOnLoan
 * does, so the two can never disagree about what the Admin is owed.
 */
export function weeklySchedule(funders: WeeklyFunder[], weeks: number): WeeklyInstalment[] {
  const earningSlices = funders.map((funder) => weeklySlices(funder.earnings, weeks))
  const cutSlices = funders.map((funder) => weeklySlices(funder.adminCut, weeks))

  return Array.from({ length: weeks }, (_unused, index) => {
    const lenders = funders.map((funder, row) => ({
      lenderId: funder.lenderId,
      earnings: earningSlices[row][index],
    }))
    const adminCut = centavos(cutSlices.reduce((total, slices) => total + slices[index], 0))

    return {
      week: index + 1,
      // Added up from the parts, never divided down from the loan's interest.
      // This is the direction that keeps both invariants — see the file comment.
      interest: centavos(lenders.reduce((total, share) => total + share.earnings, 0) + adminCut),
      lenders,
      adminCut,
    }
  })
}

/**
 * What one funder has received after the FIRST `paid` weeks, with no gaps.
 *
 * NOT FOR MONEY ON A REAL LOAN, and the floating funds query no longer uses it —
 * releasedOnFunding does. It takes a COUNT, so it cannot tell "weeks 1 and 2"
 * from "weeks 1 and 3", and it silently reproduces the bug fixed on 2026-09-25:
 * a loan with a skipped week reports the wrong figure. Gaps are ordinary here —
 * converting a loan records the weeks that really were paid, and undoing one
 * leaves a hole.
 *
 * Kept because it states the shape of the schedule — weeks 1 to N-1 are equal
 * and the last carries the remainder — and the tests use it to prove
 * releasedOnFunding agrees with summing the slices. Reach for releasedOnFunding.
 */
export function realisedThrough(total: Centavos, weeks: number, paid: number): Centavos {
  if (paid <= 0) return centavos(0)
  if (paid >= weeks) return total
  return centavos(Math.floor(total / weeks) * paid)
}

/**
 * The day each week falls due.
 *
 * The first is one week after the start date and the last is the due date
 * itself, which FEATURES.md section 5 states and which follows from the
 * whole-weeks rule that already governs every weekly-rate loan: N weeks after
 * the start IS the due date, or the loan would never have saved.
 *
 * Through addDays, so every date comes back at local midday. A date built any
 * other way is written to a Postgres `date` column as the day before — the trap
 * in weeks.ts, and a weekly loan has twenty chances to fall into it instead of
 * one.
 */
export function weeklyDueDates(startOn: Date, weeks: number): Date[] {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`A weekly schedule runs a whole number of weeks, at least one. Got ${weeks}`)
  }
  return Array.from({ length: weeks }, (_unused, index) =>
    addDays(startOn, (index + 1) * DAYS_PER_WEEK),
  )
}

/**
 * The earliest week nobody has paid, and the day it was due.
 *
 * THE ONE RULE BEHIND EVERY "OVERDUE" ON A WEEKLY LOAN. A missed week stays
 * owed and the next piles on top of it, so the date that matters is the
 * EARLIEST unpaid one, not the most recent. Two weeks behind and three weeks
 * behind are both chased from the same day.
 *
 * `paidWeeks` is the set of week numbers with a live payment against them.
 * A set rather than a count, because a converted loan can have gaps — the
 * Admin ticks off the weeks that really were paid, and week 3 paid with week 2
 * missed is a thing that happens.
 *
 * Returns null when every week is paid, which on a weekly loan means the whole
 * loan is settled.
 */
export function nextUnpaidWeek(
  startOn: Date,
  weeks: number,
  paidWeeks: ReadonlySet<number>,
): { week: number; dueOn: Date } | null {
  for (let week = 1; week <= weeks; week += 1) {
    if (paidWeeks.has(week)) continue
    return { week, dueOn: addDays(startOn, week * DAYS_PER_WEEK) }
  }
  return null
}

/**
 * How many of the first `weeks` weeks are paid with no gap before them.
 *
 * NOT USED FOR MONEY, and it must not be. It was, until 2026-09-25, and that is
 * exactly the bug releasedOnFunding's comment describes: an unbroken run is not
 * how much was collected the moment a week has been skipped. Anything deciding
 * pesos sums the weeks that were actually paid.
 *
 * Kept because "how far has this loan got without missing one" is a real
 * question about a borrower's behaviour, and because deleting it would leave the
 * next person to re-derive it and reach for it again for the wrong reason.
 */
export function consecutivePaidWeeks(weeks: number, paidWeeks: ReadonlySet<number>): number {
  let run = 0
  while (run < weeks && paidWeeks.has(run + 1)) run += 1
  return run
}

/** One funding row's stored earnings and cut, as the database holds them. */
export type ReleasableFunding = { earnings: Centavos; adminCut: Centavos }

/**
 * What a funding row has actually released, given the weeks collected on it.
 *
 * THE ONE ANSWER TO "HOW MUCH OF THIS LOAN HAS REACHED ANYBODY". Every figure in
 * the app that says "collected" comes through here — the lender ledgers behind
 * Floating and Earned, the dashboard's interest, the loans list's still-to-collect,
 * a borrower's balance, the loan page's own tiles and all five reports. Two
 * implementations would be a second opinion about the same pesos, which is the
 * thing CONVENTIONS.md says must not happen.
 *
 * IT SUMS THE WEEKS THAT WERE ACTUALLY PAID, and that is a correction made on
 * 2026-09-25 rather than the original design. It used to take the UNBROKEN RUN
 * of paid weeks and multiply, which is exact whenever nobody has skipped a week
 * and wrong the moment somebody has: weeks 1, 2, 4 and 5 paid is four weeks of
 * money, and the run is two. That understated by two weeks here while the loan
 * page — which lists the weeks and could see all four — counted four, so the
 * same loan reported two different collected figures on two screens.
 *
 * Summing the slices is exact in both cases and needs nothing the callers did
 * not already have: they all pass the set of week numbers, never a count. A gap
 * is not an edge case either — converting a loan records the weeks that really
 * were paid, and undoing a week recorded by mistake leaves one in the middle.
 */
export function releasedOnFunding(
  funding: ReleasableFunding,
  weeks: number,
  paidWeeks: ReadonlySet<number>,
): { earnings: Centavos; adminCut: Centavos } {
  const earningSlices = weeklySlices(funding.earnings, weeks)
  const cutSlices = weeklySlices(funding.adminCut, weeks)

  let earnings = 0
  let adminCut = 0
  for (const week of paidWeeks) {
    // A week number outside the term cannot be collected. It should not exist,
    // and silently adding a slice from nowhere is not how to find out that it
    // does.
    if (!Number.isInteger(week) || week < 1 || week > weeks) continue
    earnings += earningSlices[week - 1]
    adminCut += cutSlices[week - 1]
  }

  return { earnings: centavos(earnings), adminCut: centavos(adminCut) }
}

/** A collected week, with the day it was handed over. */
export type CollectedInstalment = WeeklyInstalment & { paidOn: Date }

/**
 * The weeks that were actually collected on a loan, each with its date and its
 * per-funder split.
 *
 * WHAT THE REPORTS NEED AND realisedThrough CANNOT GIVE THEM. That function
 * answers "how much has reached this funder by now", which is a cumulative
 * figure with no dates in it. A statement covering March has to know which weeks
 * landed in March and whose money each one was, so it needs the instalments
 * themselves.
 *
 * Built from the SAME weeklySchedule every other figure comes from, so a
 * statement cannot disagree with the loan page about what a week was worth. The
 * dates come from the Payment rows, because when a week was actually handed over
 * is a fact about the payment and not about the schedule — a week due in
 * February and paid in March belongs in March.
 */
export function collectedInstalments(
  funders: WeeklyFunder[],
  weeks: number,
  paid: { week: number; paidOn: Date }[],
): CollectedInstalment[] {
  const schedule = weeklySchedule(funders, weeks)

  return paid
    .filter((row) => row.week >= 1 && row.week <= weeks)
    .map((row) => ({ ...schedule[row.week - 1], paidOn: row.paidOn }))
    .sort((a, b) => a.week - b.week)
}
