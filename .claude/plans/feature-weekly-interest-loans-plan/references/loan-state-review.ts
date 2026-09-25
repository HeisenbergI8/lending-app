// Review of src/lib/loan-state.ts (54 lines) — COPY 1 OF 4 of the overdue rule.

/**
 * The claim this feature makes false for one kind of loan:
 *
 * "OVERDUE IS NOT STORED ANYWHERE. It is ACTIVE with a due date in the past — a
 *  fact about today, not a state someone has to remember to write down. A stored
 *  flag would need a job to flip it, and would be wrong every night until that
 *  job ran."
 *
 * NOTE: the plan does NOT store overdue. It stores nextDueOn, the DATE the
 * comparison is made against, which is a fact about the payments rather than
 * about today and moves only when a payment is written. The sentence above stays
 * true; the column it compares against is the thing that changes.
 */

export type LoanState = 'paid' | 'overdue' | 'due-today' | 'due-soon' | 'active'
export const DUE_SOON_DAYS = 3

export function loanState(
  status: 'ACTIVE' | 'PAID',
  dueOn: Date,          // IMPORTANT: the parameter the plan widens the meaning of.
  now: Date = new Date(),
): LoanState {
  if (status === 'PAID') return 'paid'

  // "Calendar days, not elapsed milliseconds. A loan due today must read 'due
  //  today' whether it is checked at breakfast or at one minute to midnight, and
  //  a daylight-saving shift must not move a due date by a day."
  const days = Math.round((startOfDay(dueOn) - startOfDay(now)) / DAY_MS)

  if (days < 0) return 'overdue'
  if (days === 0) return 'due-today'
  if (days <= DUE_SOON_DAYS) return 'due-soon'
  return 'active'
}

// IMPORTANT — THE HIGHEST-RISK CHANGE IN THE PLAN, and it is here.
//
// The rule does not change. What changes is which date the eleven callers pass.
// Because the parameter keeps its type AND its name, every existing call site
// compiles unchanged after the widening. A site that is missed reads a weekly
// loan three weeks behind as Active, and nothing complains — not the compiler,
// not the tests, not the screen.
//
// Two ways out, and one must be chosen deliberately:
//   a) rename the parameter (e.g. `nextDueOn`) so a positional call still
//      compiles but a reviewer grepping for the old name finds every site; or
//   b) work the call-site table in Phase 4 Step 4.1 top to bottom and tick each.
//
// Option (a) does not actually break the calls — they are positional. So the only
// real protection is the table. This is why the issue is filed High.

// NOTE: this file exists in lib/ rather than beside the badge for the reason
// CONVENTIONS.md gives twice: "src/components/*.tsx cannot be imported by
// `node --test`. Node strips types but does not compile JSX. Any rule that
// deserves a test therefore lives in src/lib/ — loan-state.ts is the worked
// example." The new weekly rules follow it into src/lib/money/weekly.ts.

// NOTE: tests/ui/loan-status.test.ts covers this function and knows nothing about
// weekly loans. It should stay green, which is the evidence that nothing changed
// for the loans that already exist.
