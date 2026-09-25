// Review of src/lib/money/weeks.ts — the date rules the weekly schedule is built
// on. Every weekly due date goes through addDays, and the reason is a trap that
// has already cost time on this project.

export const DAYS_PER_WEEK = 7

/**
 * IMPORTANT — THE TRAP, and a weekly loan has twenty chances to fall into it
 * instead of one. Quoted in full because the plan cites it.
 *
 * "Postgres `date` columns hold no time and no zone, so the driver has to pick a
 *  calendar day out of the instant it is given, and it picks the UTC one. In
 *  Manila, local midnight on 5 January is 4 January 16:00 UTC, so a date built
 *  the obvious way is written as the day before and reads back as the day before
 *  — for every date in the app, shifting a due date and tipping a loan into
 *  overdue a day early.
 *
 *  Midday is the fix because it is twelve hours from either edge: no time zone on
 *  earth is far enough from UTC to push it into a different day."
 */
export function calendarDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

/** Add whole days to a date, keeping it a calendar date — at midday, as above. */
export function addDays(date: Date, days: number): Date {
  return calendarDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}
// IMPORTANT: weeklyDueDates() must build every date through this and nothing else.
// A loop doing `new Date(start); d.setDate(d.getDate() + 7 * i)` looks equivalent
// and writes twenty dates one day early. The new test asserts getHours() === 12 on
// every date for exactly this reason.

/**
 * The whole-weeks rule. This is what guarantees termDays / 7 is exact on a
 * WEEKLY_RATE loan, which is what lets weeklySchedule take a week count at all.
 *
 * "a 30-day gap is 4.29 weeks, and rounding that silently would change what the
 *  borrower owes — ₱8,400 at four weeks against ₱10,500 at five."
 */
export function weeksBetween(start: Date, due: Date): Result<number, WeeksError> {
  // err 'due-before-start' | 'same-day' | 'not-whole-weeks' (with the two valid
  // dates either side, so the form can offer them).
}

/**
 * NOTE: the fixed-amount twin, and the reason a FIXED_AMOUNT loan can never be
 * collected weekly. "NO WHOLE-WEEK RULE HERE, and that is the point of it."
 * termDays on such a loan may be 3, so termDays / 7 is not an integer and there
 * is no schedule to build. terms.ts refuses it; weekly.ts throws if it ever
 * arrives, which would mean the refusal was bypassed.
 */
export function termDaysBetween(start: Date, due: Date): Result<number, TermError> {}

/**
 * The inverse. weeklyDueDates could have been written in terms of this, and is
 * not — it takes a week index rather than a total, and this one throws below 1.
 */
export function dueDateAfterWeeks(start: Date, weeks: number): Date {
  return addDays(start, weeks * DAYS_PER_WEEK)
}

/**
 * IMPORTANT — the layering rule that decides where a refusal sentence may live.
 * CONVENTIONS.md: "A client component must not import from src/server/ ...
 * Anything both sides need lives in src/lib/ (form-state.ts, describeWeeksError
 * in money/weeks.ts). The live '= 4 weeks' badge and the server action therefore
 * run the SAME functions, so they cannot disagree about a set of dates."
 *
 * QUESTION: the two new refusals ("a loan collected weekly runs at least two
 * weeks", "a fixed-amount loan cannot be collected weekly") are proposed in
 * server/loans/terms.ts, which the form cannot import. That is why the plan hides
 * the checkbox instead of showing a live error. If a live error is wanted, the
 * sentences have to move here — which would be following the established pattern
 * rather than departing from it.
 */
export function describeWeeksError(error: WeeksError): string {}

/** "4 weeks" / "2 weeks 3 days" / "3 days". Weeks first, because every rate is
 *  quoted per week. Used by the Excel backup and both borrower reports. */
export function describeTerm(days: number): string {}

/** NOTE: parseCalendarDate reads the parts back and compares them, because
 *  `new Date(2026, 1, 31)` is 3 March rather than an error. The conversion form
 *  takes one date per ticked week from the browser, so every one of them goes
 *  through this or through server/forms.ts date(), which does the same check. */
export function parseCalendarDate(raw: string): Date | null {}
