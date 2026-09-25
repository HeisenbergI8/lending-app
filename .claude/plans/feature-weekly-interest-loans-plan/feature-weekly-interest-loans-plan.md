# Plan: Weekly-interest loans

## 1. Plan Overview

- **Plan Type:** feature
- **Description:** Let a weekly-rate loan collect its interest week by week while the capital stays
  out until the end, without changing any arithmetic the loan was created with. Adds a collection
  mode to `Loan`, generalises `Payment` from one-per-loan to one-per-collection, derives the weekly
  schedule from figures already stored, releases each paid week's money immediately into the right
  pot, re-derives Overdue from the earliest unpaid week, carries the change through every screen and
  report, and provides a conversion flow for a loan already in the database.
- **Date:** 2026-09-24

### 1.1 What was read, and what it settles

Every claim below traces to a review in `references/`. Four facts from the real code and the real
database shape this plan and are worth stating before the phases:

1. **`Payment.loanId` is a plain `UNIQUE INDEX`, not a partial one.** Confirmed against the live
   database on 2026-09-24: `Payment_loanId_key ON public."Payment" USING btree ("loanId")`. There is
   no `weekNumber`, no partial predicate, nothing to widen. It has to be dropped.
2. **`Loan.payment` is a Prisma to-one relation**, and Prisma can only declare one because of that
   index. Dropping the index turns it into `payments Payment[]`, which breaks **21 read sites** — all
   compile errors, none silent. They are enumerated in section 3.
3. **Overdue is derived in four places, not one.** `loanState()` is the rule, but three other places
   re-express it rather than call it, and one of those three is SQL. See Phase 4.
4. **Angel's loan in the database is NOT the loan section 5 of FEATURES.md describes.** See
   Follow Ups — this is the one thing that needs an answer before Phase 7 is implemented.

### 1.2 The arithmetic, decided once

The spec says the weeks must sum to the stored interest to the centavo, and the task adds that each
week's per-funder split must sum to that week. Those are two invariants, and independent rounding
cannot satisfy both. The resolution, which the whole plan rests on:

```
weeklySlices(total, weeks) = [ floor(total/weeks) x (weeks-1) , total - (weeks-1)*floor(total/weeks) ]
```

applied **per funder**, to each funder's already-stored `earningsCentavos` and `adminCutCentavos` —
never to the loan's `interestCentavos` directly. **Week k's interest is then DEFINED as the sum of
that week's funder slices.** That ordering is what makes both invariants hold:

| Invariant | Why it holds |
| --- | --- |
| Funder slices sum to the week | The week *is* that sum. True by construction. |
| A funder's weeks sum to their stored earnings | The final week is a subtraction, not a rounding. |
| All weeks sum to `Loan.interestCentavos` | `split.ts` already guarantees the funder totals do. |

**Where the remainder lands:** entirely on the **final** week, which FEATURES.md §5 states and which
the largest-remainder rule in `split.ts` already models. Weeks 1..N-1 are all exactly equal. The
final week can exceed them by at most `2 x (funding rows) - 1` centavos.

**The consequence that makes this safe:** the final week is collected in February *together with the
capital* (§5, settled decision 6). So the remainder is never partially released. Money realised after
`k` paid weeks, for any `k <= N-1`, is exactly `k * floor(funder.earnings / N)` — one integer
multiplication over a column that never moves. Nothing accumulates, nothing drifts, and **no
per-week allocation needs to be stored anywhere.**

### 1.3 Schema shape, and what it costs

Rejected: a `LoanWeek` schedule table. It would need its own proof-file relation (`ProofFile.paymentId`
is an FK to `Payment`), its own soft-delete, its own Recently Deleted section and its own purge
branch — four systems duplicated to hold figures §1.2 shows are derivable.

Chosen: **generalise `Payment`.**

| Change | Cost |
| --- | --- |
| `Loan.interestCollection` enum `AT_END \| WEEKLY`, default `AT_END` | One nullable-safe column with a default. No row rewritten. |
| `Payment.weekNumber Int?` — NULL is the settling payment, 1..N-1 a weekly one | One nullable column. Every existing row keeps its exact meaning as NULL. |
| Drop `Payment_loanId_key` | `Loan.payment` becomes `Loan.payments[]`. 21 compile errors. |
| Raw-SQL partial unique index on `("loanId") WHERE "weekNumber" IS NULL` | Preserves the old one-settlement-per-loan guarantee byte for byte. |
| `@@unique([loanId, weekNumber])` | Stops a week being paid twice. |
| `Loan.nextDueOn` | A stored derived date. **A new pattern.** Justified in Phase 4, raised in Follow Ups. |

**The migration destroys and rewrites nothing.** It is one `DROP INDEX`, two `ADD COLUMN`, three
`CREATE INDEX`. No `UPDATE` touches a money column.

---

## 2. Comprehensive Plan by Phases

### Phase 1: The weekly schedule as pure arithmetic

No database, no schema, no UI. `src/lib/money/weekly.ts` and its test. Nothing imports it yet, so the
tree compiles throughout and the money rules are provable before anything can display them.

#### Step 1.1: The slice function and the per-funder schedule

**File:** `src/lib/money/weekly.ts`
**Verify:** `test -f src/lib/money/weekly.ts`

Create the module: `weeklySlices`, `weeklySchedule` over stored funder figures, and the
`realisedThrough` helper that the floating queries in Phase 5 will call.

```diff
+import { type Centavos, centavos } from './centavos.ts'
+import { DAYS_PER_WEEK, addDays } from './weeks.ts'
+
+/**
+ * Collecting a loan's interest week by week instead of all at the end.
+ *
+ * THIS IS NOT A THIRD INTEREST BASIS. Every figure here is carved out of
+ * numbers the loan was already created with — LoanFunding.earningsCentavos and
+ * LoanFunding.adminCutCentavos, fixed the day the loan was made by split.ts.
+ * Nothing recalculates from a rate, so a default rate changed next year cannot
+ * reach back into a week that has already been collected. What changes is WHEN
+ * the money is released, never how much it is.
+ *
+ * THE ORDER OF OPERATIONS IS THE WHOLE DESIGN, and reversing it breaks one of
+ * the two invariants. Each funder's own total is sliced across the weeks, and a
+ * week's interest is then DEFINED as the sum of that week's funder slices. Done
+ * the other way round — slice the loan's interest, then divide each week between
+ * the funders — a funder's weeks stop summing to what they are owed, and the
+ * loan pays somebody a centavo it never charged.
+ *
+ *   funder slices sum to the week      because the week IS that sum
+ *   a funder's weeks sum to their total because the last week is a subtraction
+ *   every week sums to the interest     because split.ts already guaranteed the
+ *                                       funder totals do
+ *
+ * THE REMAINDER LANDS ON THE FINAL WEEK, which is the rule FEATURES.md section
+ * 5 sets and the same rule split.ts already follows. Weeks 1 to N-1 are exactly
+ * equal; the final week may be a few centavos larger. That is safe rather than
+ * merely tidy, because the final week is handed over in one payment with the
+ * capital: the uneven week is never released on its own, so what has been paid
+ * out part-way through a loan is always an exact multiple of a whole-centavo
+ * figure. See realisedThrough.
+ */
+
+/** A loan runs at least two weeks to be worth collecting weekly. One week is just a loan. */
+export const MIN_WEEKLY_WEEKS = 2
+
+/**
+ * One amount split into `weeks` whole-centavo parts that sum back to it exactly.
+ *
+ * Not largest-remainder, and deliberately: every week of a weekly loan is the
+ * same money on the same terms, so there is nothing to rank them by. The parts
+ * are equal and the last one carries whatever did not divide.
+ */
+export function weeklySlices(total: Centavos, weeks: number): Centavos[] {
+  if (!Number.isInteger(weeks) || weeks < 1) {
+    throw new Error(`A weekly schedule runs a whole number of weeks, at least one. Got ${weeks}`)
+  }
+  if (total < 0) throw new Error(`A weekly schedule splits a non-negative amount, got ${total}`)
+
+  const base = Math.floor(total / weeks)
+  const slices = Array.from({ length: weeks - 1 }, () => centavos(base))
+  slices.push(centavos(total - base * (weeks - 1)))
+  return slices
+}
+
+/** One funder's stake in a weekly loan, read off the row that was stored at creation. */
+export type WeeklyFunder = {
+  lenderId: string
+  /** LoanFunding.earningsCentavos — what this funder's own capital earns over the whole term. */
+  earnings: Centavos
+  /** LoanFunding.adminCutCentavos — the Admin's cut on this row. Zero on the Admin's own row. */
+  adminCut: Centavos
+}
+
+/** What one week of a weekly loan releases, and to whom. */
+export type WeeklyInstalment = {
+  /** 1-based. Week N is the last, and is collected with the capital. */
+  week: number
+  /** Interest charged for this week. The sum of the two lists below. */
+  interest: Centavos
+  /** Straight into each funder's floating the day the week is paid. */
+  lenders: { lenderId: string; earnings: Centavos }[]
+  /** Straight into Admin earnings the day the week is paid. */
+  adminCut: Centavos
+}
+
+/**
+ * The whole schedule, built from the funding rows a loan already carries.
+ *
+ * `funders` is every LoanFunding row on the loan, and the Admin's cut is taken
+ * from those same rows rather than from a rate — exactly as adminTakeOnLoan
+ * does, so the two can never disagree about what the Admin is owed.
+ */
+export function weeklySchedule(funders: WeeklyFunder[], weeks: number): WeeklyInstalment[] {
+  const earningSlices = funders.map((funder) => weeklySlices(funder.earnings, weeks))
+  const cutSlices = funders.map((funder) => weeklySlices(funder.adminCut, weeks))
+
+  return Array.from({ length: weeks }, (_unused, index) => {
+    const lenders = funders.map((funder, row) => ({
+      lenderId: funder.lenderId,
+      earnings: earningSlices[row][index],
+    }))
+    const adminCut = centavos(cutSlices.reduce((total, slices) => total + slices[index], 0))
+
+    return {
+      week: index + 1,
+      // Added up from the parts, never divided down from the loan's interest.
+      // This is the direction that keeps both invariants — see the file comment.
+      interest: centavos(lenders.reduce((total, share) => total + share.earnings, 0) + adminCut),
+      lenders,
+      adminCut,
+    }
+  })
+}
+
+/**
+ * What one funder has actually received, after `paid` whole weeks.
+ *
+ * An exact integer multiplication for every week but the last, because weeks 1
+ * to N-1 are equal. Paying the final week settles the loan, so the answer there
+ * is simply the stored total and no remainder is ever half-released.
+ *
+ * This is the figure the floating funds query needs, and it needs it per
+ * funding row without fetching a schedule — which is why nothing about the
+ * schedule is stored.
+ */
+export function realisedThrough(total: Centavos, weeks: number, paid: number): Centavos {
+  if (paid <= 0) return centavos(0)
+  if (paid >= weeks) return total
+  return centavos(Math.floor(total / weeks) * paid)
+}
```

#### Step 1.2: The weekly due dates, and the next unpaid one

**File:** `src/lib/money/weekly.ts`
**Verify:** `npm run typecheck`

`weeklyDueDates` from `startOn` via the existing `addDays`, plus `nextUnpaidWeek` so the list, the
badge and the stored `nextDueOn` column all share one rule. Appended to the same file.

```diff
+/**
+ * The day each week falls due.
+ *
+ * The first is one week after the start date and the last is the due date
+ * itself, which FEATURES.md section 5 states and which follows from the
+ * whole-weeks rule that already governs every weekly-rate loan: N weeks after
+ * the start IS the due date, or the loan would never have saved.
+ *
+ * Through addDays, so every date comes back at local midday. A date built any
+ * other way is written to a Postgres `date` column as the day before — the trap
+ * in weeks.ts, and a weekly loan has twenty chances to fall into it instead of
+ * one.
+ */
+export function weeklyDueDates(startOn: Date, weeks: number): Date[] {
+  if (!Number.isInteger(weeks) || weeks < 1) {
+    throw new Error(`A weekly schedule runs a whole number of weeks, at least one. Got ${weeks}`)
+  }
+  return Array.from({ length: weeks }, (_unused, index) =>
+    addDays(startOn, (index + 1) * DAYS_PER_WEEK),
+  )
+}
+
+/**
+ * The earliest week nobody has paid, and the day it was due.
+ *
+ * THE ONE RULE BEHIND EVERY "OVERDUE" ON A WEEKLY LOAN. A missed week stays
+ * owed and the next piles on top of it, so the date that matters is the
+ * EARLIEST unpaid one, not the most recent. Two weeks behind and three weeks
+ * behind are both chased from the same day.
+ *
+ * `paidWeeks` is the set of week numbers with a live payment against them.
+ * A set rather than a count, because a converted loan can have gaps — the
+ * Admin ticks off the weeks that really were paid, and week 3 paid with week 2
+ * missed is a thing that happens.
+ *
+ * Returns null when every week is paid, which on a weekly loan means the whole
+ * loan is settled.
+ */
+export function nextUnpaidWeek(
+  startOn: Date,
+  weeks: number,
+  paidWeeks: ReadonlySet<number>,
+): { week: number; dueOn: Date } | null {
+  for (let week = 1; week <= weeks; week += 1) {
+    if (paidWeeks.has(week)) continue
+    return { week, dueOn: addDays(startOn, week * DAYS_PER_WEEK) }
+  }
+  return null
+}
+
+/** How many of the first `weeks` weeks are paid with no gap before them. */
+export function consecutivePaidWeeks(weeks: number, paidWeeks: ReadonlySet<number>): number {
+  let run = 0
+  while (run < weeks && paidWeeks.has(run + 1)) run += 1
+  return run
+}
```

> **Note on `consecutivePaidWeeks` versus a plain count.** `realisedThrough` takes a number of weeks
> and multiplies. Handed a *count* it would be wrong on a loan with a gap: weeks 1 and 3 paid is two
> weeks of money but three weeks of schedule, and the two answers differ. Handed the *unbroken run*
> it is exactly right for the ordinary case, and understates by one week's slice for a converted loan
> with a gap. **That understatement is a real defect and is listed in Follow Ups**, with the fix that
> closes it (sum the slices for the weeks actually paid) and the reason it is not in this phase.

#### Step 1.3: Prove both invariants, including the awkward cases

**File:** `tests/money/weekly.test.ts`
**Verify:** `npm run verify`

Mirrors the discipline of `tests/money/split.test.ts` — the reconciliation cases are the ones that
matter, and they run against the same awkward principals that file already uses, fed through
`splitLoan` so the input is a real stored split rather than a hand-typed one.

```diff
+import { test, describe } from 'node:test'
+import assert from 'node:assert/strict'
+import { centavos } from '../../src/lib/money/centavos.ts'
+import { splitLoan, type LoanTerms } from '../../src/lib/money/split.ts'
+import {
+  consecutivePaidWeeks,
+  nextUnpaidWeek,
+  realisedThrough,
+  weeklyDueDates,
+  weeklySchedule,
+  weeklySlices,
+} from '../../src/lib/money/weekly.ts'
+
+const peso = (n: number) => centavos(n * 100)
+
+describe("Angel's loan, the one the spec was written from", () => {
+  // 60,000 at 7% for 20 weeks. The lender keeps 5%, the Admin takes 2%.
+  const split = splitLoan({
+    capital: peso(60_000),
+    borrowerRateBps: 700,
+    weeks: 20,
+    fundings: [{ lenderId: 'lender', principal: peso(60_000), lenderRateBps: 500, adminCutBps: 200 }],
+  })
+  assert.equal(split.ok, true)
+  if (!split.ok) throw new Error('unreachable')
+
+  const schedule = weeklySchedule(
+    split.value.lenders.map((share) => ({
+      lenderId: share.lenderId,
+      earnings: share.earnings,
+      adminCut: share.adminCut,
+    })),
+    20,
+  )
+
+  test('the whole interest is ₱84,000, unchanged from collecting it at the end', () => {
+    assert.equal(split.value.totalInterest, peso(84_000))
+  })
+  test('every week is ₱4,200', () => {
+    for (const week of schedule) assert.equal(week.interest, peso(4_200))
+  })
+  test('the lender keeps ₱3,000 a week', () => {
+    for (const week of schedule) assert.equal(week.lenders[0].earnings, peso(3_000))
+  })
+  test('the Admin takes ₱1,200 a week', () => {
+    for (const week of schedule) assert.equal(week.adminCut, peso(1_200))
+  })
+})
+
+describe('THE INVARIANTS — both of them, on figures that do not divide', () => {
+  // The same awkward principals tests/money/split.test.ts reconciles against.
+  // Fed through splitLoan first, so what is sliced is a real stored split.
+  const cases: [string, LoanTerms, number][] = [
+    [
+      'awkward capital, three lenders, 3 weeks',
+      {
+        capital: centavos(1_000_001),
+        borrowerRateBps: 700,
+        weeks: 3,
+        fundings: [
+          { lenderId: 'a', principal: centavos(333_333), lenderRateBps: 500, adminCutBps: 200 },
+          { lenderId: 'b', principal: centavos(333_334), lenderRateBps: 500, adminCutBps: 200 },
+          { lenderId: 'c', principal: centavos(333_334), lenderRateBps: 500, adminCutBps: 200 },
+        ],
+      },
+      3,
+    ],
+    [
+      'five lenders, prime principals, 13 weeks',
+      {
+        capital: centavos(1_111_111),
+        borrowerRateBps: 700,
+        weeks: 13,
+        fundings: [
+          { lenderId: 'a', principal: centavos(222_221), lenderRateBps: 500, adminCutBps: 200 },
+          { lenderId: 'b', principal: centavos(222_222), lenderRateBps: 500, adminCutBps: 200 },
+          { lenderId: 'c', principal: centavos(222_223), lenderRateBps: 500, adminCutBps: 200 },
+          { lenderId: 'd', principal: centavos(222_222), lenderRateBps: 500, adminCutBps: 200 },
+          { lenderId: 'e', principal: centavos(222_223), lenderRateBps: 500, adminCutBps: 200 },
+        ],
+      },
+      13,
+    ],
+    [
+      "mixed funding — the Admin's own money beside a lender's, 23 weeks",
+      {
+        capital: centavos(999_983),
+        borrowerRateBps: 700,
+        weeks: 23,
+        fundings: [
+          { lenderId: 'admin', principal: centavos(333_331), lenderRateBps: 700, adminCutBps: 0 },
+          { lenderId: 'jun', principal: centavos(666_652), lenderRateBps: 500, adminCutBps: 200 },
+        ],
+      },
+      23,
+    ],
+    [
+      'a single centavo of capital over 5 weeks',
+      {
+        capital: centavos(1),
+        borrowerRateBps: 700,
+        weeks: 5,
+        fundings: [{ lenderId: 'a', principal: centavos(1), lenderRateBps: 500, adminCutBps: 200 }],
+      },
+      5,
+    ],
+  ]
+
+  for (const [name, terms, weeks] of cases) {
+    const result = splitLoan(terms)
+    assert.equal(result.ok, true, name)
+    if (!result.ok) throw new Error('unreachable')
+    const stored = result.value
+    const funders = stored.lenders.map((share) => ({
+      lenderId: share.lenderId,
+      earnings: share.earnings,
+      adminCut: share.adminCut,
+    }))
+    const schedule = weeklySchedule(funders, weeks)
+
+    test(`${name}: the weeks sum to the interest charged, to the centavo`, () => {
+      const total = schedule.reduce((sum, week) => sum + week.interest, 0)
+      assert.equal(total, stored.totalInterest, 'centavos went missing or were invented')
+    })
+
+    test(`${name}: every week's funder shares sum to that week`, () => {
+      for (const week of schedule) {
+        const parts = week.lenders.reduce((sum, share) => sum + share.earnings, 0) + week.adminCut
+        assert.equal(parts, week.interest, `week ${week.week} does not add up`)
+      }
+    })
+
+    test(`${name}: each funder's weeks sum to what they are owed`, () => {
+      for (const funder of funders) {
+        const paid = schedule.reduce(
+          (sum, week) => sum + (week.lenders.find((l) => l.lenderId === funder.lenderId)?.earnings ?? 0),
+          0,
+        )
+        assert.equal(paid, funder.earnings, `${funder.lenderId} is owed a different total`)
+      }
+    })
+
+    test(`${name}: the Admin's weeks sum to the Admin's cut`, () => {
+      const cut = schedule.reduce((sum, week) => sum + week.adminCut, 0)
+      assert.equal(cut, stored.adminEarnings)
+    })
+
+    test(`${name}: no week is negative, and only the last may differ`, () => {
+      for (const week of schedule) assert.ok(week.interest >= 0, `week ${week.week} is negative`)
+      const early = schedule.slice(0, -1).map((week) => week.interest)
+      assert.equal(new Set(early).size <= 1, true, 'the weeks before the last are not all equal')
+    })
+
+    test(`${name}: realisedThrough never exceeds what is owed`, () => {
+      for (const funder of funders) {
+        for (let paid = 0; paid <= weeks; paid += 1) {
+          const got = realisedThrough(funder.earnings, weeks, paid)
+          assert.ok(got >= 0 && got <= funder.earnings, `${funder.lenderId} at ${paid} weeks: ${got}`)
+        }
+      }
+    })
+  }
+})
+
+describe('realisedThrough matches adding the slices up', () => {
+  // The multiplication is a shortcut. It has to give the same answer as the
+  // schedule it is a shortcut for, or the floating funds query and the loan
+  // page disagree about the same money.
+  for (const total of [peso(84_000), centavos(1), centavos(1_000_001), centavos(0)]) {
+    for (const weeks of [2, 3, 7, 13, 20, 23]) {
+      test(`${total} over ${weeks} weeks`, () => {
+        const slices = weeklySlices(total, weeks)
+        for (let paid = 0; paid <= weeks; paid += 1) {
+          const summed = slices.slice(0, paid).reduce((sum, slice) => sum + slice, 0)
+          assert.equal(realisedThrough(total, weeks, paid), summed, `at ${paid} weeks`)
+        }
+      })
+    }
+  }
+})
+
+describe('the weekly dates', () => {
+  const start = new Date(2026, 8, 5, 12) // 5 September 2026
+
+  test('the first week falls one week after the start', () => {
+    assert.equal(weeklyDueDates(start, 20)[0].getDate(), 12)
+  })
+  test('the last week falls ON the due date', () => {
+    const dates = weeklyDueDates(start, 20)
+    const last = dates[dates.length - 1]
+    assert.equal(last.getFullYear(), 2027)
+    assert.equal(last.getMonth(), 0) // 23 January 2027
+    assert.equal(last.getDate(), 23)
+  })
+  test('every date is at local midday, so Postgres cannot take a day off it', () => {
+    for (const date of weeklyDueDates(start, 20)) assert.equal(date.getHours(), 12)
+  })
+})
+
+describe('the earliest unpaid week is the one that is chased', () => {
+  const start = new Date(2026, 8, 5, 12)
+
+  test('nothing paid: week 1', () => {
+    assert.equal(nextUnpaidWeek(start, 20, new Set())?.week, 1)
+  })
+  test('a MISSED week stays owed while later ones are paid', () => {
+    // Week 2 was missed and weeks 1, 3 and 4 were paid. The loan is chased
+    // from week 2, not from week 5 — the missed week does not go away.
+    assert.equal(nextUnpaidWeek(start, 20, new Set([1, 3, 4]))?.week, 2)
+  })
+  test('every week paid: nothing left to chase', () => {
+    const all = new Set(Array.from({ length: 4 }, (_unused, i) => i + 1))
+    assert.equal(nextUnpaidWeek(start, 4, all), null)
+  })
+  test('the unbroken run stops at the gap', () => {
+    assert.equal(consecutivePaidWeeks(20, new Set([1, 3, 4])), 1)
+  })
+})
```

#### Phase 1 — Potential Issues

- Type mismatches across the layers this phase touches
- Cross-cutting registration this phase assumes but no step performs — see CONVENTIONS.md
- Unhandled edge cases: empty lists, exhausted pagination, absent fields, error payloads
- Breaking changes to existing consumers, including anything built against mocks before a real
  contract landed
- New patterns not already established here. Do not introduce one without saying why the existing
  pattern is insufficient
- Layering violations — data-shaping leaking out of its layer, or the transport bypassed

**Issues identified:**

- **`consecutivePaidWeeks` understates a converted loan with a gap.** Weeks 1 and 3 paid, week 2
  missed: the run is 1, so `realisedThrough` releases one week's money although two were collected.
  It errs *downwards*, which is the safe direction — the app claims less is in the pot than really
  is, never more. The exact fix is to sum the slices for the weeks actually paid rather than
  multiply, which needs the week numbers at every call site instead of a count. Deferred to keep the
  floating query a count rather than a row fetch; **listed in Follow Ups with severity Medium.**
  Do not let an implementer "simplify" this by passing a plain count of paid weeks — that errs
  *upwards*, which is the direction that displays money that is not there.
- **`weeklySlices` throws rather than returning a Result.** Every other money function in
  `src/lib/money/` that can refuse bad input returns `Result` (`weeksBetween`, `splitLoan`,
  `parsePesos`). This one throws, like `computeInterest` and `dueDateAfterWeeks` do, and for the same
  reason: a non-integer week count here is a bug in the caller, not something the Admin typed. The
  Admin-facing refusal happens once, in `loanTerms` (Step 3.1), which is where every other
  Admin-facing refusal already lives.
- **Nothing imports this module yet**, so the whole phase is inert. That is intentional and it is why
  `npm run verify` is a real gate on Step 1.3: the money rules are provable before any screen can
  display them, which is the only order in which a wrong figure cannot reach the Admin.
- **`weeks` on the loan is derived from `termDays`, never stored.** The schema comment is explicit:
  "there is no weeks column, because two columns for one term can disagree". Every caller of
  `weeklySchedule` must pass `termDays / 7`, and the whole-weeks rule in `weeksBetween` is what
  guarantees that division is exact — but only for a `WEEKLY_RATE` loan. Step 3.1 is what stops a
  `FIXED_AMOUNT` loan ever reaching here with a fractional week count.

---

### Phase 2: Schema and migration

The `Payment` constraint goes, and the 21 read sites that depended on the to-one relation are
mechanically converted in the same phase so the tree compiles at the end of it. No behaviour changes:
every converted site reads the settling payment (`weekNumber: null`), which is what every existing
row is.

#### Step 2.1: The enum and the three new columns

**File:** `prisma/schema.prisma`
**Verify:** (omitted — the schema is proved by Step 2.2's migration and Step 2.4's typecheck)

```diff
+/// When a loan's interest is collected. Chosen per loan, and it changes nothing
+/// about how much the interest IS.
+///
+/// AT_END is every loan the app has ever made: capital and the whole interest
+/// in one payment on the due date.
+///
+/// WEEKLY is the same arithmetic collected differently — one instalment per
+/// whole week, the last handed over in February WITH the capital. The figures
+/// are still computed once at creation and still stored on Loan and
+/// LoanFunding; the schedule is carved out of them by src/lib/money/weekly.ts
+/// and is NOT stored, because storing it would be a second copy of numbers that
+/// already exist and could only ever drift from them.
+///
+/// Only a WEEKLY_RATE loan can be WEEKLY. A FIXED_AMOUNT loan has no week count
+/// to instal against — see the InterestBasis comment above.
+enum InterestCollection {
+  AT_END
+  WEEKLY
+}
+
 model Loan {
   id               String        @id @default(cuid())
   userId           String
   borrowerId       String
   capitalCentavos  Int
   interestBasis    InterestBasis @default(WEEKLY_RATE)
+  /// When the interest is collected. Never WEEKLY on a FIXED_AMOUNT loan.
+  interestCollection InterestCollection @default(AT_END)
   /// What the borrower is charged per week. NULL on a FIXED_AMOUNT loan.
   borrowerRateBps  Int?
   startOn          DateTime      @db.Date
   dueOn            DateTime      @db.Date
+  /// THE NEXT DAY MONEY IS OWED ON THIS LOAN. Equal to dueOn on an AT_END loan,
+  /// and on a WEEKLY loan the earliest week nobody has paid yet.
+  ///
+  /// THE ONE DERIVED FIGURE IN THIS SCHEMA THAT IS STORED, and it is stored
+  /// under protest. Overdue is meant to be a fact about today rather than a
+  /// column — but "the earliest unpaid week" is not a comparison Postgres can
+  /// make against an index, and the loans list is paged BY this value. Deriving
+  /// it per row would mean a correlated subquery over Payment on every page, on
+  /// every count, and on the dashboard's three aggregates.
+  ///
+  /// It is safe to store only because it is written in the SAME TRANSACTION as
+  /// every event that can move it: creating a loan, editing one, paying a week,
+  /// undoing a week, converting a loan. No job maintains it and nothing else
+  /// may write it. If it is ever found disagreeing with the payments, the
+  /// payments are right — see src/lib/money/weekly.ts nextUnpaidWeek, which is
+  /// the rule this column caches.
+  nextDueOn        DateTime      @db.Date
   termDays         Int
   interestCentavos Int
   totalCentavos    Int
   status           LoanStatus    @default(ACTIVE)
   deletedAt        DateTime?     @map("archivedAt")
   createdAt        DateTime      @default(now())
   updatedAt        DateTime      @updatedAt
 
   user     User                @relation(fields: [userId], references: [id], onDelete: Cascade)
   borrower Borrower            @relation(fields: [borrowerId], references: [id], onDelete: Restrict)
   fundings LoanFunding[]
-  payment  Payment?
+  payments Payment[]
   notes    LoanNote[]
   advances LenderTransaction[]
 
   @@index([userId, status, deletedAt])
   @@index([borrowerId])
   @@index([dueOn])
+  @@index([userId, status, nextDueOn])
 }
```

```diff
-/// The single repayment.
-///
-/// loanId is unique: one payment per loan, enforced by the database rather than
-/// by hoping the application never writes a second. There are no partial
-/// payments and no installments — the borrower pays the whole total at once.
+/// A payment against a loan.
+///
+/// FOR NEARLY EVERY LOAN THERE IS STILL EXACTLY ONE, and the database still
+/// enforces that. The borrower pays the whole total at once; there are no
+/// partial payments and no installments.
+///
+/// weekNumber is what changed, and it is NULL on every row written before
+/// 2026-09-24 and on every AT_END loan since:
+///
+///   NULL  the settling payment. On an AT_END loan that is the whole total. On
+///         a WEEKLY loan it is the capital plus the final week's interest, in
+///         one payment, which is what FEATURES.md section 5 calls February.
+///         AT MOST ONE PER LOAN, enforced by a partial unique index that the
+///         migration writes by hand — Prisma cannot express a WHERE on an
+///         index, so it is not visible above. It is the same guarantee the old
+///         Payment_loanId_key gave, kept rather than weakened.
+///
+///   1..N-1  one week's interest on a WEEKLY loan, collected on its own. The
+///         @@unique below stops a week being paid twice.
+///
+/// A weekly payment is NOT a partial payment and nothing here contradicts
+/// FEATURES.md section 12. No single amount is ever paid in parts: a week is
+/// paid whole or not at all, and the capital is paid whole or not at all.
 model Payment {
   id             String    @id @default(cuid())
   userId         String
-  loanId         String    @unique
+  loanId         String
+  /// NULL is the settling payment. 1..N-1 is one week of a WEEKLY loan.
+  weekNumber     Int?
   paidOn         DateTime  @db.Date
+  /// What was handed over. One week's interest on a weekly row; the capital
+  /// plus the final week on a weekly loan's settling row; the whole total on
+  /// every other. Never typed — always read from the loan.
   amountCentavos Int
   deletedAt      DateTime? @map("archivedAt")
   createdAt      DateTime  @default(now())
 
   user       User        @relation(fields: [userId], references: [id], onDelete: Cascade)
   loan       Loan        @relation(fields: [loanId], references: [id], onDelete: Cascade)
   proofFiles ProofFile[]
+
+  @@unique([loanId, weekNumber])
+  @@index([loanId])
+  @@index([userId, deletedAt])
 }
```

#### Step 2.2: The migration, written by hand so the partial index survives

**File:** `prisma/migrations/20260924120000_weekly_interest/migration.sql`
**Verify:** `test -f prisma/migrations/20260924120000_weekly_interest/migration.sql`

**Nothing here rewrites money.** One `DROP INDEX`, two `ADD COLUMN`, one backfill of a date column
that is a copy of a date already on the row, three `CREATE INDEX`. No `UPDATE` touches
`capitalCentavos`, `interestCentavos`, `totalCentavos`, `amountCentavos`, `earningsCentavos` or
`adminCutCentavos`, and no row in `Payment` is deleted or moved.

```diff
+-- Weekly-interest loans. FEATURES.md section 5, added 2026-09-24.
+--
+-- Written by hand rather than generated, for ONE reason: the partial unique
+-- index at the bottom. Prisma cannot express `WHERE "weekNumber" IS NULL` on an
+-- index, and without it a loan could take two settling payments — the exact
+-- guarantee Payment_loanId_key gave before this migration, which is the one
+-- thing here that must not be weakened.
+--
+-- NOTHING BELOW REWRITES MONEY. The only UPDATE copies a date column onto a new
+-- date column. Every existing Payment row keeps its id, its amount, its date,
+-- its proof files and its meaning: weekNumber NULL is "the settling payment",
+-- which is what all four of them already are.
+
+CREATE TYPE "InterestCollection" AS ENUM ('AT_END', 'WEEKLY');
+
+ALTER TABLE "Loan"
+  ADD COLUMN "interestCollection" "InterestCollection" NOT NULL DEFAULT 'AT_END',
+  ADD COLUMN "nextDueOn" DATE;
+
+-- Every loan that exists is collected at the end, so the next day money is owed
+-- on it IS its due date. Done before the NOT NULL below, so no row is ever
+-- briefly wrong.
+UPDATE "Loan" SET "nextDueOn" = "dueOn" WHERE "nextDueOn" IS NULL;
+
+ALTER TABLE "Loan" ALTER COLUMN "nextDueOn" SET NOT NULL;
+
+CREATE INDEX "Loan_userId_status_nextDueOn_idx" ON "Loan"("userId", "status", "nextDueOn");
+
+ALTER TABLE "Payment" ADD COLUMN "weekNumber" INTEGER;
+
+-- The old guarantee, in the form that still allows weekly rows beside it.
+-- Postgres treats NULLs as distinct in an ordinary unique index, so
+-- ("loanId", "weekNumber") alone would let a loan take two settling payments.
+-- This is the half that stops it.
+DROP INDEX "Payment_loanId_key";
+
+CREATE UNIQUE INDEX "Payment_loanId_settling_key"
+  ON "Payment"("loanId")
+  WHERE "weekNumber" IS NULL;
+
+-- And this is the half that stops a week being paid twice.
+CREATE UNIQUE INDEX "Payment_loanId_weekNumber_key" ON "Payment"("loanId", "weekNumber");
+
+CREATE INDEX "Payment_loanId_idx" ON "Payment"("loanId");
+CREATE INDEX "Payment_userId_archivedAt_idx" ON "Payment"("userId", "archivedAt");
```

> **`Payment_loanId_settling_key` is invisible to Prisma and must stay that way.** `prisma migrate
> dev` compares the schema to the database and will offer to drop an index it cannot see in
> `schema.prisma`. CONVENTIONS.md already warns that the Prisma CLI runs on `DIRECT_URL`; add to that
> the rule that **any future migration generated against this schema must be read before it is
> applied**, and a `DROP INDEX "Payment_loanId_settling_key"` in one deleted by hand. Raised in
> Follow Ups.

#### Step 2.3: One helper for "the settling payment"

**File:** `src/server/payments/settled.ts`
**Verify:** `test -f src/server/payments/settled.ts`

The array-to-one narrowing is written once rather than twenty-one times.

```diff
+/**
+ * "Was this loan settled, and when?" — asked from twenty-one places.
+ *
+ * Before weekly loans this was a to-one relation and the answer was
+ * `loan.payment`. Payment.loanId is no longer unique, so Prisma hands back an
+ * array, and every caller would otherwise write the same two narrowings by
+ * hand: pick the row with no week number, then drop it if it was undone.
+ *
+ * TWO THINGS ARE BEING NARROWED AND THEY ARE NOT THE SAME THING.
+ *
+ *   weekNumber: null  — the payment that SETTLES the loan. A weekly interest
+ *                       payment is a real payment and is not this one.
+ *
+ *   deletedAt: null   — undoing a payment soft-deletes the row rather than
+ *                       destroying it, so an undone payment is still attached
+ *                       to its loan and reads as money that came back. This is
+ *                       the same trap CONVENTIONS.md names; it has simply moved
+ *                       from a to-one to an array.
+ *
+ * The `where` fragment below is used in the QUERY wherever Prisma allows it, so
+ * the row never travels. `settlingPayment` is for the places that already have
+ * the rows in hand.
+ */
+
+/** The select fragment: the settling payment, live only, at most one row. */
+export const SETTLING = { where: { weekNumber: null, deletedAt: null }, take: 1 } as const
+
+/** The same narrowing applied to rows already fetched. */
+export function settlingPayment<T extends { weekNumber: number | null; deletedAt: Date | null }>(
+  payments: T[],
+): T | null {
+  return payments.find((row) => row.weekNumber === null && row.deletedAt === null) ?? null
+}
+
+/**
+ * The day a loan was settled, or null while it is still running.
+ *
+ * The single most-repeated line in src/server/ before this file existed.
+ */
+export function settledOn(
+  payments: { weekNumber: number | null; deletedAt: Date | null; paidOn: Date }[],
+): Date | null {
+  return settlingPayment(payments)?.paidOn ?? null
+}
+
+/** The week numbers with a live payment against them. Feeds nextUnpaidWeek. */
+export function paidWeekNumbers(
+  payments: { weekNumber: number | null; deletedAt: Date | null }[],
+): Set<number> {
+  return new Set(
+    payments
+      .filter((row) => row.weekNumber !== null && row.deletedAt === null)
+      .map((row) => row.weekNumber as number),
+  )
+}
```

#### Step 2.4: Convert the twenty-one read sites

**File:** `src/server/lenders/queries.ts`, `src/server/loans/queries.ts`, `src/server/borrowers/queries.ts`, `src/server/reports/queries.ts`, `src/server/reports/backup.ts`, `src/server/deleted/purge.ts`, `src/server/payments/actions.ts`, `prisma/seed/pagination-clean.ts`
**Verify:** `npm run verify`

Mechanical and behaviour-preserving. Every existing `Payment` row has `weekNumber = null`, so every
converted site returns exactly what it returned before. The pattern, applied once per site:

```diff
-        payment: { select: { paidOn: true, deletedAt: true } },
+        payments: { where: { weekNumber: null }, select: { paidOn: true, deletedAt: true, weekNumber: true } },
```

```diff
-  const settledOn = (payment: { paidOn: Date; deletedAt: Date | null } | null) =>
-    payment && payment.deletedAt === null ? payment.paidOn : null
+  // Moved to server/payments/settled.ts — the same narrowing is needed in six files now.
```

The `where`-clause form, which several report queries use to filter loans by their repayment date,
narrows in SQL and gains one condition:

```diff
-        payment: { deletedAt: null, paidOn: period },
+        payments: { some: { weekNumber: null, deletedAt: null, paidOn: period } },
```

> **`payment: { ... }` in a `where` becomes `payments: { some: { ... } }`, and the difference is not
> cosmetic.** A to-one `where` means "the payment matches"; `some` means "at least one payment
> matches". With `weekNumber: null` inside it they are the same set, because the partial unique index
> guarantees at most one such row. **Without `weekNumber: null` inside the `some`, a loan whose
> week 3 was paid in March would be reported as repaid in March.** Every one of the four sites at
> `reports/queries.ts:298`, `:400`, `:506` and `:532` must carry it.

The full list of sites, so none is missed. All are compile errors after Step 2.1; none can fail
silently.

| File | Lines | Shape |
| --- | --- | --- |
| `src/server/lenders/queries.ts` | 369, 392, 418, 429, 440, 477, 486, 498 | select + `settledOn` helper |
| `src/server/loans/queries.ts` | 411, 460 | select + narrowing |
| `src/server/borrowers/queries.ts` | 78, 92, 100, 273, 295, 296 | select + `livePayment` helper + row type |
| `src/server/reports/queries.ts` | 298, 400, 411, 451, 506, 517, 532, 557, 650, 671 | 4 `where`, 3 select, 3 narrowing |
| `src/server/reports/backup.ts` | 84, 121, 125, 161, 162, 188, 190 | select + `live` map |
| `src/server/deleted/purge.ts` | 114, 117 | select + `?? []` |
| `src/server/payments/actions.ts` | 85, 90 | select for the upsert — rewritten in Step 3.3 |
| `prisma/seed/pagination-clean.ts` | 70 | `payment: { loanId: ... }` on ProofFile, unaffected in shape |

#### Phase 2 — Potential Issues

- Type mismatches across the layers this phase touches
- Cross-cutting registration this phase assumes but no step performs — see CONVENTIONS.md
- Unhandled edge cases: empty lists, exhausted pagination, absent fields, error payloads
- Breaking changes to existing consumers, including anything built against mocks before a real
  contract landed
- New patterns not already established here. Do not introduce one without saying why the existing
  pattern is insufficient
- Layering violations — data-shaping leaking out of its layer, or the transport bypassed

**Issues identified:**

- **`Loan.nextDueOn` is a stored derived value, and the schema refuses those everywhere else.** The
  schema's own header says "Derived on read, never stored: floating funds, a loan's OVERDUE state,
  and a borrower's counted track record." This column is a deliberate exception and the justification
  is in the field comment: the loans list is paged and filtered by it in SQL, and no index can serve
  "the earliest week with no live Payment row". **Flagged as a new pattern and raised in Follow Ups
  for the owner's sign-off**, with the alternative (a correlated subquery, and giving up the paging
  design recorded in `loans/queries.ts`) stated so the trade is visible rather than assumed.
- **A future `prisma migrate dev` will offer to drop `Payment_loanId_settling_key`.** Prisma
  diffs the schema against the database and cannot see a partial index. Dropping it silently
  re-allows two settling payments on one loan — double-counted capital, on the one table where that
  is worst. The mitigation is a rule, not code: read every generated migration before applying it.
  **Raised in Follow Ups as the strongest candidate for a `.claude/lessons/` entry.**
- **`payment` to `payments: { some: }` in a `where` is the one conversion that can be wrong and still
  compile.** `some` without `weekNumber: null` type-checks perfectly and reports a loan as repaid in
  the month one of its weeks was paid. Four sites in `reports/queries.ts`. This is the single
  highest-risk line in the phase and it is why Step 2.4's gate is `npm run verify` rather than a
  typecheck.
- **`markPaid`'s `upsert` is broken by this phase and repaired in the next one.** `db.payment.upsert({
  where: { loanId } })` requires `loanId` to be unique in the Prisma model. It is a compile error at
  the end of Step 2.1, which means **Phase 2 does not leave the tree compiling on its own** — Step
  3.3 is what closes it. Sequence Steps 2.1 through 3.3 without stopping, or hold Step 2.1 back until
  3.3 is written. This is the one place in the plan where the phase boundary is not a safe stop.
- **`prisma/seed/demo.ts` and `pagination-demo.ts` write `Payment` rows.** Neither sets
  `weekNumber`, and neither has to: the column is nullable and NULL is exactly what they mean. They
  are listed here so a reviewer does not mistake their absence from the table for an oversight.
- **`ProofFile` is untouched, and that is the point of this shape.** A weekly payment gets proof,
  soft-delete, Recently Deleted and purge for free, because it is a `Payment`. A `LoanWeek` table
  would have needed all four rebuilt.

---

### Phase 3: Creating a weekly loan, and recording a week

The write path. A loan can be created as weekly, a week can be marked paid with proof, and a week can
be undone. Nothing on any screen reads it yet.

#### Step 3.1: Carry the collection mode through `loanTerms`

**File:** `src/server/loans/terms.ts`
**Verify:** `npm run typecheck`

The two refusals, in the file where every other Admin-facing refusal already lives, so the live badge
on the form and the server action cannot disagree about a set of inputs.

```diff
 export type LoanInput = {
   capital: Centavos
   startOn: Date
   dueOn: Date
   interest: InterestInput
+  /**
+   * Whether the interest is collected weekly or all at the end. Read from the
+   * form, defaulted by the caller, and refused below on a loan that cannot
+   * carry it.
+   */
+  collection: InterestCollection
   funders: FunderInput[]
 }
```

```diff
 export type LoanTermsResult = {
   termDays: number
   interest: Centavos
   total: Centavos
+  /**
+   * The next day money is owed. On an AT_END loan it is the due date; on a
+   * WEEKLY loan, one week after the start, because a new loan has no paid weeks.
+   *
+   * Computed here rather than in the action so that the one rule deciding
+   * Loan.nextDueOn lives beside the one deciding termDays — two answers about
+   * the same pair of dates, from the same place.
+   */
+  nextDueOn: Date
   split: Split
   fundings: FundingTerms[]
 }
```

```diff
 function weeklyRateTerms(
   input: LoanInput,
   rates: Extract<InterestInput, { basis: 'WEEKLY_RATE' }>,
 ): Result<LoanTermsResult, string> {
   const { capital, startOn, dueOn, funders } = input
   const { borrowerRateBps, adminCutBps } = rates
 
   ...
 
   const weeks = weeksBetween(startOn, dueOn)
   if (!weeks.ok) return err(describeWeeksError(weeks.error))
 
+  // A one-week loan collected weekly is a one-week loan. The single instalment
+  // would fall on the due date and carry the capital with it, which is the
+  // ordinary loan the app already makes — so this is refused as a mistake
+  // rather than accepted as a second way to spell the same thing.
+  if (input.collection === 'WEEKLY' && weeks.value < MIN_WEEKLY_WEEKS) {
+    return err('A loan collected weekly runs at least two weeks. This one is one week.')
+  }
+
   const split = splitLoan({ ... })
   if (!split.ok) return err(describeSplitError(split.error, capital))
 
   return ok(
     assemble(split.value, weeks.value * DAYS_PER_WEEK, funders, (funder) =>
       ratesFor(funder, borrowerRateBps, adminCutBps),
-    ),
+    , input.collection === 'WEEKLY' ? addDays(startOn, DAYS_PER_WEEK) : dueOn),
   )
 }
```

```diff
 function fixedAmountTerms(
   input: LoanInput,
   amounts: Extract<InterestInput, { basis: 'FIXED_AMOUNT' }>,
 ): Result<LoanTermsResult, string> {
   const { capital, startOn, dueOn, funders } = input
 
+  // FEATURES.md section 5: only a weekly-rate loan can be weekly-collected. A
+  // fixed amount has no week count to instal against, and the whole-weeks rule
+  // that guarantees the schedule divides evenly does not apply to it.
+  if (input.collection === 'WEEKLY') {
+    return err('A loan charging a fixed amount of interest cannot be collected weekly.')
+  }
+
   const termDays = termDaysBetween(startOn, dueOn)
   if (!termDays.ok) return err(describeTermError(termDays.error))
```

> **Wording check.** Both sentences say what is wrong and what the Admin can do about it, name no
> "you", and use no em dashes — the house style in `describeWeeksError` and `describeFixedError`.

#### Step 3.2: Write the mode and `nextDueOn` on create and on edit

**File:** `src/server/loans/actions.ts`
**Verify:** (omitted — proved end to end by Step 3.3's gate; a `test -f` on a file that already
exists would pass before the step was started)

```diff
 function readForm(form: FormData): Result<Parsed, string> {
   ...
   const interest = readInterest(form)
   if (!interest.ok) return err(interest.error)
 
+  // Anything but the exact string is AT_END. The form posts a checkbox, and a
+  // checkbox that is not ticked posts nothing at all.
+  const collection = text(form, 'interestCollection') === 'WEEKLY' ? 'WEEKLY' : 'AT_END'
+
   const funders = readFunderRows(form)
```

Both `createLoan` and `updateLoan` then write the two new columns from `terms.value`:

```diff
           startOn: input.startOn,
           dueOn: input.dueOn,
+          interestCollection: input.collection,
+          nextDueOn: terms.value.nextDueOn,
           termDays: terms.value.termDays,
           interestCentavos: terms.value.interest,
           totalCentavos: terms.value.total,
```

> **`updateLoan` recomputes `nextDueOn` from scratch, and on a weekly loan that is wrong.** Editing
> a loan runs `loanTerms` again, which returns `startOn + 1 week` because it knows nothing about
> paid weeks. A weekly loan with six weeks already collected would be reset to owing week 1.
> The fix belongs in this step:

```diff
       await tx.loan.update({
         where: { id: loanId },
         data: {
           ...
-          nextDueOn: terms.value.nextDueOn,
+          // Recomputed from the PAID WEEKS, not from the dates alone. loanTerms
+          // answers for a new loan, which has none; an edited loan may have six
+          // already collected, and resetting it to week 1 would put money back
+          // on a screen that says it was received.
+          nextDueOn: await recomputeNextDueOn(tx, user.id, loanId, input, terms.value),
```

Also in this step: **refuse an edit that would drop a week already paid.** `updateLoan` already
refuses a PAID loan, for the reason that its payment records a total that was handed over. A weekly
loan whose term is being shortened below its highest paid week is the same situation, one week at a
time:

```diff
+  // The same rule that refuses editing a PAID loan, applied one week at a time.
+  // Shortening a weekly loan under a week that has been collected would leave a
+  // Payment row pointing at a week the loan no longer has — money received
+  // against nothing.
+  const highestPaid = await db.payment.findFirst({
+    where: { loanId, userId: user.id, deletedAt: null, weekNumber: { not: null } },
+    orderBy: { weekNumber: 'desc' },
+    select: { weekNumber: true },
+  })
+  if (highestPaid?.weekNumber != null && newWeeks < highestPaid.weekNumber) {
+    return failed(
+      `Week ${highestPaid.weekNumber} has already been collected on this loan, so it cannot be shortened below ${highestPaid.weekNumber} weeks.`,
+    )
+  }
```

#### Step 3.3: Replace the `upsert` that the dropped unique index broke

**File:** `src/server/payments/actions.ts`
**Verify:** `npm run verify`

`db.payment.upsert({ where: { loanId } })` cannot survive `loanId` no longer being unique in the
Prisma model. The composite `loanId_weekNumber` key Prisma now generates does not accept `null` for
`weekNumber`, so the upsert becomes an explicit find-then-write inside the transaction that is
already there.

```diff
   const loan = await db.loan.findFirst({
     where: { id: loanId, userId: user.id },
-    select: { id: true, status: true, totalCentavos: true, payment: { select: { id: true } } },
+    select: {
+      id: true,
+      status: true,
+      totalCentavos: true,
+      capitalCentavos: true,
+      termDays: true,
+      interestCollection: true,
+      dueOn: true,
+      // The settling row only. A weekly interest payment is not the row being
+      // reused here, and picking one up would overwrite a collected week.
+      payments: { where: { weekNumber: null }, select: { id: true } },
+    },
   })
   if (!loan) return failed('That loan no longer exists.')
   if (loan.status === 'PAID') return failed('That loan is already marked paid.')
 
-  const paymentId = loan.payment?.id ?? randomUUID()
+  const paymentId = loan.payments[0]?.id ?? randomUUID()
```

```diff
     await db.$transaction(async (tx) => {
-      await tx.payment.upsert({
-        where: { loanId },
-        create: {
-          id: paymentId,
-          userId: user.id,
-          loanId,
-          paidOn: paidOn.value,
-          amountCentavos: loan.totalCentavos,
-        },
-        update: { paidOn: paidOn.value, amountCentavos: loan.totalCentavos, deletedAt: null },
-      })
+      // Find-then-write rather than upsert. Payment.loanId is no longer unique,
+      // so there is no single-column key to upsert on, and the composite
+      // (loanId, weekNumber) key will not take a null week. The guarantee the
+      // old unique index gave is still enforced — by the partial unique index
+      // the migration wrote — so this can still only ever touch one row.
+      //
+      // A loan marked paid, undone and paid again reuses the row it already
+      // has, with its proof files, exactly as before.
+      const existing = await tx.payment.findFirst({
+        where: { loanId, userId: user.id, weekNumber: null },
+        select: { id: true },
+      })
+
+      if (existing) {
+        await tx.payment.update({
+          where: { id: existing.id },
+          data: { paidOn: paidOn.value, amountCentavos: settlingAmount, deletedAt: null },
+        })
+      } else {
+        await tx.payment.create({
+          data: {
+            id: paymentId,
+            userId: user.id,
+            loanId,
+            weekNumber: null,
+            paidOn: paidOn.value,
+            amountCentavos: settlingAmount,
+          },
+        })
+      }
```

The settling amount is where a weekly loan differs, and it is read from the loan rather than typed,
exactly as before:

```diff
+  // What February is: the capital plus the FINAL week's interest, in one
+  // payment. FEATURES.md section 5 — the last week is not collected separately.
+  // On an AT_END loan this is the loan's whole total, unchanged.
+  const settlingAmount =
+    loan.interestCollection === 'WEEKLY'
+      ? centavos(loan.capitalCentavos + finalWeekInterest(loan, fundings))
+      : loan.totalCentavos
```

```diff
       await tx.loan.update({
         where: { id: loanId },
-        data: { status: 'PAID' },
+        // nextDueOn goes to the due date on a settled loan. Nothing is owed, so
+        // nothing should read as owed on a date earlier than the loan's own.
+        data: { status: 'PAID', nextDueOn: loan.dueOn },
       })
```

`undoPayment` gains the mirror of that, and one guard:

```diff
   await db.$transaction(async (tx) => {
     await tx.payment.updateMany({
-      where: { loanId, userId: user.id },
+      // The SETTLING row only. Undoing the February payment must not quietly
+      // archive twenty collected weeks along with it — that money really was
+      // received, and the weeks are undone one at a time by their own button.
+      where: { loanId, userId: user.id, weekNumber: null },
       data: { deletedAt: new Date() },
     })
-    await tx.loan.update({ where: { id: loanId }, data: { status: 'ACTIVE' } })
+    await tx.loan.update({
+      where: { id: loanId },
+      data: { status: 'ACTIVE', nextDueOn: await nextDueOnFor(tx, user.id, loanId) },
+    })
   })
```

#### Step 3.4: `markWeekPaid` and `undoWeekPaid`

**File:** `src/server/payments/week-actions.ts`
**Verify:** `test -f src/server/payments/week-actions.ts`

A new file rather than more of `payments/actions.ts`, which is already 241 lines and whose whole
doc-comment is about the one full repayment. The upload helpers are reused, not copied.

```diff
+'use server'
+
+import { randomUUID } from 'node:crypto'
+import { revalidatePath } from 'next/cache'
+
+import { centavos } from '../../lib/money/centavos.ts'
+import { checkProofFiles, proofStoragePath } from '../../lib/proof.ts'
+import { DAYS_PER_WEEK } from '../../lib/money/weeks.ts'
+import { nextUnpaidWeek, weeklySchedule } from '../../lib/money/weekly.ts'
+import { requireUser } from '../auth/guard.ts'
+import { db } from '../db.ts'
+import { type FormState, NO_ERROR, date, failed, text } from '../forms.ts'
+import { StorageUnavailable, putProof, removeProof } from '../storage/proof-bucket.ts'
+import { paidWeekNumbers } from './settled.ts'
+import { filesFrom, uploadAll } from './uploads.ts'
+
+/**
+ * Collecting one week of interest on a weekly loan.
+ *
+ * ONE WEEK AT A TIME, AND NEVER AHEAD. FEATURES.md section 5, answered
+ * explicitly: no paying two weeks in one go and no paying ahead. So the week
+ * number is not a field the Admin picks — it is read from the loan as the
+ * earliest unpaid one, which means it cannot be mistyped and cannot skip a week
+ * that is still owed.
+ *
+ * THE FINAL WEEK IS NOT COLLECTED HERE. It is handed over with the capital in
+ * one payment, which is markPaid in payments/actions.ts. Asking for it here is
+ * refused rather than silently redirected: the two amounts are wildly different
+ * and a button that quietly did the bigger one would be a very bad surprise.
+ *
+ * PROOF IS OPTIONAL BUT FLAGGED, and the files go into the bucket BEFORE any
+ * row is written — the same order, and the same reason, as the full repayment.
+ * A failed upload leaves the week uncollected and the Admin simply tries again.
+ */
+
+function refresh(): void {
+  revalidatePath('/', 'layout')
+}
+
+export async function markWeekPaid(_prev: FormState, form: FormData): Promise<FormState> {
+  const user = await requireUser()
+
+  const loanId = text(form, 'loanId')
+  const paidOn = date(form, 'paidOn')
+  if (!paidOn.ok) return failed(`Date paid: ${paidOn.error.toLowerCase()}`)
+
+  const files = filesFrom(form, 'proof')
+  const checked = checkProofFiles(
+    files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
+  )
+  if (!checked.ok) return failed(checked.error)
+
+  const loan = await db.loan.findFirst({
+    where: { id: loanId, userId: user.id, deletedAt: null },
+    select: {
+      id: true,
+      status: true,
+      startOn: true,
+      dueOn: true,
+      termDays: true,
+      interestCollection: true,
+      payments: { select: { weekNumber: true, deletedAt: true } },
+      fundings: {
+        select: { lenderId: true, earningsCentavos: true, adminCutCentavos: true },
+      },
+    },
+  })
+  if (!loan) return failed('That loan no longer exists.')
+  if (loan.interestCollection !== 'WEEKLY') {
+    return failed('That loan does not collect its interest weekly.')
+  }
+  if (loan.status === 'PAID') return failed('That loan is already marked paid.')
+
+  const weeks = loan.termDays / DAYS_PER_WEEK
+  const next = nextUnpaidWeek(loan.startOn, weeks, paidWeekNumbers(loan.payments))
+  if (!next) return failed('Every week on that loan has been collected.')
+
+  // The last week goes with the capital, in one payment, and that is a
+  // different button. Said out loud rather than redirected — see the file note.
+  if (next.week === weeks) {
+    return failed(
+      'The final week is collected with the capital. Use Mark as paid to record the whole thing.',
+    )
+  }
+
+  // The week's own amount, carved out of the funding rows the loan was created
+  // with. Never typed, and never recomputed from a rate.
+  const schedule = weeklySchedule(
+    loan.fundings.map((funding) => ({
+      lenderId: funding.lenderId,
+      earnings: centavos(funding.earningsCentavos),
+      adminCut: centavos(funding.adminCutCentavos),
+    })),
+    weeks,
+  )
+  const instalment = schedule[next.week - 1]
+
+  const paymentId = randomUUID()
+  let uploads: Awaited<ReturnType<typeof uploadAll>> = []
+  try {
+    uploads = await uploadAll(user.id, paymentId, files)
+  } catch (error) {
+    if (error instanceof StorageUnavailable) return failed(`Nothing was recorded. ${error.message}`)
+    throw error
+  }
+
+  try {
+    await db.$transaction(async (tx) => {
+      await tx.payment.create({
+        data: {
+          id: paymentId,
+          userId: user.id,
+          loanId,
+          weekNumber: next.week,
+          paidOn: paidOn.value,
+          amountCentavos: instalment.interest,
+        },
+      })
+
+      if (uploads.length > 0) {
+        await tx.proofFile.createMany({
+          data: uploads.map((upload) => ({
+            id: upload.fileId,
+            userId: user.id,
+            paymentId,
+            storagePath: upload.path,
+            mimeType: upload.mimeType,
+            sizeBytes: upload.sizeBytes,
+          })),
+        })
+      }
+
+      // The loan STAYS ACTIVE and the capital stays out. Only the date money is
+      // next owed moves. FEATURES.md section 5: out on loan holds steady while
+      // earned climbs each week it is actually collected.
+      const after = nextUnpaidWeek(
+        loan.startOn,
+        weeks,
+        new Set([...paidWeekNumbers(loan.payments), next.week]),
+      )
+      await tx.loan.update({
+        where: { id: loanId },
+        data: { nextDueOn: after?.dueOn ?? loan.dueOn },
+      })
+    })
+  } catch (error) {
+    await Promise.all(uploads.map((upload) => removeProof(upload.path).catch(() => undefined)))
+    throw error
+  }
+
+  refresh()
+  return NO_ERROR
+}
+
+/**
+ * Undo a week recorded by mistake.
+ *
+ * Soft-deleted rather than destroyed, like every other payment, so the proof
+ * files stay attached and the week can be recorded again. The @@unique on
+ * (loanId, weekNumber) means the archived row still occupies its week, so
+ * recording it again REUSES that row rather than creating a second one —
+ * the same rule markPaid follows for the settling payment.
+ */
+export async function undoWeekPaid(_prev: FormState, form: FormData): Promise<FormState> {
+  ...
+}
```

> **The `@@unique([loanId, weekNumber])` bites here and the code above does not yet handle it.** An
> undone week leaves an archived row holding week 3, so `payment.create` for week 3 fails on the
> unique constraint. `markWeekPaid` must do the same find-then-write `markPaid` does. **Listed in
> Issues below and carried into Follow Ups**, because it is the kind of thing that passes every test
> written against a clean loan and fails the first time the Admin corrects a mistake.

#### Phase 3 — Potential Issues

- Type mismatches across the layers this phase touches
- Cross-cutting registration this phase assumes but no step performs — see CONVENTIONS.md
- Unhandled edge cases: empty lists, exhausted pagination, absent fields, error payloads
- Breaking changes to existing consumers, including anything built against mocks before a real
  contract landed
- New patterns not already established here. Do not introduce one without saying why the existing
  pattern is insufficient
- Layering violations — data-shaping leaking out of its layer, or the transport bypassed

**Issues identified:**

- **`markWeekPaid` uses `create` where it needs find-then-write.** An undone week leaves an archived
  row occupying `(loanId, weekNumber)`, so recording that week again violates the unique constraint.
  Every test written against a clean loan passes; the first correction the Admin makes throws. **The
  step must be implemented with the same find-then-write `markPaid` uses**, reusing the row and its
  proof files. Severity High, in Follow Ups.
- **`uploadAll` and `filesFrom` are currently private to `payments/actions.ts`.** Step 3.4 imports
  them from a `payments/uploads.ts` that does not exist yet. Extracting them is part of Step 3.3, and
  it must be an extraction, not a copy: the bucket-before-rows ordering and the cleanup-on-failure
  loop are a trap named in CONVENTIONS.md, and two copies of them is two chances to lose one.
- **`finalWeekInterest` and `nextDueOnFor` and `recomputeNextDueOn` are named in the diffs and not
  written out.** They are small, and each is one call to `weeklySchedule` or `nextUnpaidWeek` over
  rows the caller already has. They are named rather than inlined so the diffs stay readable; an
  implementer writes them in the file that calls them.
- **`markPaid` on a weekly loan must refuse while earlier weeks are unpaid.** The capital payment is
  February, and February is also the final week. If weeks 12 and 13 were never collected, marking the
  loan paid would settle it while two weeks are still owed, and the loan would move to PAID carrying
  money nobody recorded. The guard is one call to `nextUnpaidWeek` and belongs in Step 3.3. **Not in
  the diffs above.** Severity High, in Follow Ups.
- **`revalidatePath('/', 'layout')` is the right refresh and is reused unchanged.** A collected week
  moves the dashboard tiles, the lender profile, the borrower profile and the loans list at once, so
  nothing narrower would be correct.
- **No new pattern is introduced by the actions themselves.** `markWeekPaid` is `markPaid` with a
  week number, and it deliberately reads the amount from the loan rather than the form, for the
  reason the existing file already states: an amount that cannot be typed cannot be mistyped.
- **Phase 3 is where the tree becomes compilable again** after Step 2.1. See the Phase 2 issue on the
  unsafe boundary.

---

### Phase 4: Overdue, in all four places it is decided

The derivation that today reads `dueOn` vs today must read the earliest unpaid week. There is more
than one copy and one of them is SQL.

> **How many copies there are, measured rather than assumed.** `loanState()` in
> `src/lib/loan-state.ts` is the rule. Three other places decide the same thing without calling it:
>
> | Where | Form | Reached by |
> | --- | --- | --- |
> | `src/lib/loan-state.ts:34` | `startOfDay(dueOn) - startOfDay(now)` | the badge, every list, every report |
> | `src/lib/track-record.ts:60` | `startOfDay(loan.dueOn) < startOfDay(now)` | borrower profile, borrower PDF |
> | `src/server/loans/queries.ts:127` (`loanWhere`) | `dueOn: { lt: today }` in SQL | the Overdue chip, `overdueSummary` |
> | `src/server/loans/queries.ts:243` (`listLoans`) | `{ status: 'ACTIVE', dueOn: { lt: today } }` in SQL | the Overdue tile count |
>
> Four, two of them SQL. `overdueSummary` and the dashboard's overdue tile are not a fifth — both go
> through `loanWhere`. `src/server/reports/queries.ts:341` filters `loanState(...) === 'overdue'` in
> JS, which is the first row, not a new one.

#### Step 4.1: `loanState` reads the effective due date

**File:** `src/lib/loan-state.ts`
**Verify:** `npm run typecheck`

The signature does not change and neither does the rule. What changes is that the caller passes the
date money is next owed, which on an `AT_END` loan is still `dueOn`.

```diff
 /**
  * What state a loan is in today.
  *
  * ...
  *
  * OVERDUE IS NOT STORED ANYWHERE. It is ACTIVE with a due date in the past — a
  * fact about today, not a state someone has to remember to write down.
+ *
+ * ON A WEEKLY LOAN THE DATE IS NOT THE LOAN'S DUE DATE. A loan collecting its
+ * interest every week is late the moment a WEEK is missed, months before the
+ * capital is due, and it stays late until that week is paid — the next week
+ * piles on top rather than replacing it. So what is compared is the earliest
+ * unpaid week, which nextUnpaidWeek in money/weekly.ts decides and
+ * Loan.nextDueOn caches for the queries that have to ask it in SQL.
+ *
+ * The rule itself is untouched and the parameter is deliberately not renamed to
+ * something like `effectiveDueOn`: on every AT_END loan, which is all of them
+ * bar the weekly ones, this IS the due date.
  */
 export function loanState(
   status: 'ACTIVE' | 'PAID',
-  dueOn: Date,
+  /** The next day money is owed. Loan.dueOn at the end, Loan.nextDueOn weekly. */
+  dueOn: Date,
   now: Date = new Date(),
 ): LoanState {
```

Every call site then passes `loan.nextDueOn` instead of `loan.dueOn`. The sites, all of which
already select one of the two:

| File | Lines |
| --- | --- |
| `src/server/loans/queries.ts` | 282, 470 |
| `src/server/lenders/queries.ts` | 441, 478 |
| `src/server/borrowers/queries.ts` | 113 (approx), 305 |
| `src/server/reports/queries.ts` | 341, 431, 562, 690 |
| `src/server/reports/backup.ts` | 141 |

> **A thing that must NOT change with it: `dueOn` stays the date that is *displayed* on the loan
> page.** FEATURES.md section 5 is explicit — the February capital date lives on the loan page, and
> only the Active Loans list shows the next unpaid weekly date. Swapping the displayed date on the
> loan page would hide the one figure the borrower and the Admin actually agreed on.

#### Step 4.2: `trackRecord`'s copy

**File:** `src/lib/track-record.ts`
**Verify:** `test -f tests/loans/weekly-state.test.ts`

```diff
 export type BorrowerLoanRecord = {
   status: 'ACTIVE' | 'PAID'
-  dueOn: Date
+  /**
+   * The next day money is owed on the loan. Loan.dueOn on an ordinary loan;
+   * Loan.nextDueOn on one collecting its interest weekly, which is late the
+   * moment a week is missed rather than when the capital comes due.
+   *
+   * Named for what it decides rather than for the column it usually comes from,
+   * because this file has no other use for a due date and a reader who assumes
+   * Loan.dueOn will count a weekly loan as on time for four months.
+   */
+  dueOn: Date
   /** When the repayment actually arrived. Null on an active loan. */
   paidOn: Date | null
 }
```

The counting rule itself does not move a line. What has to change is the two callers, which both
select `dueOn` today:

```diff
   const loans = borrower.loans.map((loan) => ({
     status: loan.status,
-    dueOn: loan.dueOn,
+    dueOn: loan.nextDueOn,
     paidOn: ...,
   }))
```

`src/server/borrowers/queries.ts` (`SUMMARY_ROW` and `getBorrower`) and
`src/server/reports/queries.ts:667` (`borrowerReport`) are the two. A borrower's counted record is
printed on a PDF statement, so the two must agree, and they agree because they call the same
function — the reason that function is in `src/lib/` in the first place.

New test file, since there is no existing home for "a weekly loan goes overdue on a missed week":

```diff
+import { test, describe } from 'node:test'
+import assert from 'node:assert/strict'
+import { loanState } from '../../src/lib/loan-state.ts'
+import { trackRecord } from '../../src/lib/track-record.ts'
+import { nextUnpaidWeek } from '../../src/lib/money/weekly.ts'
+
+describe('a weekly loan is late on a missed week, not on the capital date', () => {
+  // Angel's shape: 20 weeks from 5 September, capital due in January.
+  const start = new Date(2026, 8, 5, 12)
+  const capitalDue = new Date(2027, 0, 23, 12)
+  // Today is 30 September. Weeks 1, 2 and 3 fell on the 12th, 19th and 26th.
+  const today = new Date(2026, 8, 30, 12)
+
+  test('every week paid so far: the loan is running, not late', () => {
+    const next = nextUnpaidWeek(start, 20, new Set([1, 2, 3]))
+    assert.ok(next)
+    assert.equal(loanState('ACTIVE', next.dueOn, today), 'due-soon') // week 4, 3 Oct
+  })
+
+  test('week 3 missed: the loan is OVERDUE although the capital is months away', () => {
+    const next = nextUnpaidWeek(start, 20, new Set([1, 2]))
+    assert.ok(next)
+    assert.equal(loanState('ACTIVE', next.dueOn, today), 'overdue')
+    // The point of the test: read against the capital date it looks fine.
+    assert.equal(loanState('ACTIVE', capitalDue, today), 'active')
+  })
+
+  test('the EARLIEST missed week is the one chased, not the most recent', () => {
+    // Week 2 missed, week 3 paid. Two weeks behind is chased from week 2.
+    const next = nextUnpaidWeek(start, 20, new Set([1, 3]))
+    assert.equal(next?.week, 2)
+    assert.equal(loanState('ACTIVE', next!.dueOn, today), 'overdue')
+  })
+
+  test('the loan returns to Active once every due week is paid', () => {
+    const next = nextUnpaidWeek(start, 20, new Set([1, 2, 3, 4]))
+    assert.equal(loanState('ACTIVE', next!.dueOn, today), 'active') // week 5, 10 Oct
+  })
+
+  test('the borrower is counted overdue on the missed week', () => {
+    const missed = nextUnpaidWeek(start, 20, new Set([1, 2]))!
+    const record = trackRecord([{ status: 'ACTIVE', dueOn: missed.dueOn, paidOn: null }], today)
+    assert.equal(record.overdue, 1)
+  })
+})
```

#### Step 4.3: The two SQL copies

**File:** `src/server/loans/queries.ts`
**Verify:** `npm run verify`

This is what `Loan.nextDueOn` is for. Both the filter and the count run against the new
`(userId, status, nextDueOn)` index, so the paging design the file's own comments defend survives
untouched.

```diff
 export function loanWhere(userId: string, filter: LoanFilter) {
   const today = calendarDate(new Date())
 
-  const dueOn = {
+  // THE DATE RANGE AND THE STATUS FILTER ASK DIFFERENT QUESTIONS, and on a
+  // weekly loan they stop having the same answer.
+  //
+  //   "due between these dates" means the loan's own due date — the day the
+  //   capital comes back, which is what the Admin typed and remembers.
+  //
+  //   "overdue" / "active" means the next day money is owed, which on a weekly
+  //   loan is the earliest unpaid week and may be four months earlier.
+  //
+  // Filtering both on one column made a weekly loan three weeks behind read as
+  // Active, because its capital date is in February.
+  const dueOn = {
     ...(filter.from ? { gte: filter.from } : {}),
     ...(filter.to ? { lte: filter.to } : {}),
-    ...(filter.status === 'overdue' ? { lt: today } : {}),
-    ...(filter.status === 'active' ? { gte: filter.from && filter.from > today ? filter.from : today } : {}),
   }
 
+  // Separate, on the cached earliest-unpaid date. Equal to dueOn on every
+  // AT_END loan, which is every loan that is not collected weekly.
+  const nextDueOn = {
+    ...(filter.status === 'overdue' ? { lt: today } : {}),
+    ...(filter.status === 'active' ? { gte: today } : {}),
+  }
+
   return {
     userId,
     deletedAt: null,
     ...(filter.status === 'paid' ? { status: 'PAID' as const } : {}),
     ...(filter.status === 'active' || filter.status === 'overdue' ? { status: 'ACTIVE' as const } : {}),
     ...(Object.keys(dueOn).length > 0 ? { dueOn } : {}),
+    ...(Object.keys(nextDueOn).length > 0 ? { nextDueOn } : {}),
     ...
   }
 }
```

> **A behaviour change that is deliberate and must be reviewed.** The `active` branch today tightens
> the range's own `gte` to today, so "active" and a from-date interact. Splitting the two columns
> drops that interaction: the range now always means the capital date and the status always means the
> next owed date, and both bounds still have to hold because they are separate keys on the same
> `where`. On an `AT_END` loan the result is identical. `tests/loans/loan-where.test.ts` exists and
> covers this clause; it is the file that will say whether that is true, which is why this step's
> gate is `npm run verify`.

```diff
-    db.loan.count({ where: { AND: [where, { status: 'ACTIVE', dueOn: { lt: today } }] } }),
+    // AND, never a spread — see the note below on why. The column is nextDueOn
+    // for the same reason the filter above uses it: a weekly loan is late on a
+    // missed week, months before its capital date.
+    db.loan.count({ where: { AND: [where, { status: 'ACTIVE', nextDueOn: { lt: today } }] } }),
```

The ordering in `listLoans` moves with it, so the list is sorted by what is actually chased first:

```diff
-      orderBy: [{ status: 'asc' }, { dueOn: 'asc' }, { id: 'asc' }],
+      // Soonest MONEY first, not soonest capital. A weekly loan three weeks
+      // behind belongs at the top of the list, not in February.
+      orderBy: [{ status: 'asc' }, { nextDueOn: 'asc' }, { id: 'asc' }],
```

`overdueSummary` needs no change: it builds its `where` from `loanWhere`, so it follows.

#### Phase 4 — Potential Issues

- Type mismatches across the layers this phase touches
- Cross-cutting registration this phase assumes but no step performs — see CONVENTIONS.md
- Unhandled edge cases: empty lists, exhausted pagination, absent fields, error payloads
- Breaking changes to existing consumers, including anything built against mocks before a real
  contract landed
- New patterns not already established here. Do not introduce one without saying why the existing
  pattern is insufficient
- Layering violations — data-shaping leaking out of its layer, or the transport bypassed

**Issues identified:**

- **`loanState`'s parameter keeps the name `dueOn` while its meaning widens.** Every existing call
  site passes `loan.dueOn` and compiles fine after the change, so **the eleven call sites in Step
  4.1's table are NOT compile errors** — they are silent. A weekly loan three weeks behind would read
  Active everywhere the update was missed. This is the one place in the plan where getting it wrong
  is invisible to the compiler. Two options for the implementer, and one must be chosen deliberately:
  rename the parameter so the sites break, or work the table top to bottom and check each off.
  **Severity High, in Follow Ups.**
- **The `active` filter's interaction with a from-date changes.** Documented in the step. On every
  existing loan the answer is identical because `nextDueOn = dueOn`, so
  `tests/loans/loan-where.test.ts` should stay green; if it does not, the test is describing the old
  interaction and the owner should decide which behaviour is wanted, not the implementer.
- **`Loan.nextDueOn` can drift, and nothing detects it.** It is written in the same transaction as
  every event that moves it, which is what makes it safe, but a row edited by hand or a migration
  that forgets it would leave a loan chased on the wrong day with nothing complaining. `nextUnpaidWeek`
  is the authority and the column is a cache of it. **A reconciliation check comparing the two across
  the account belongs in `.claude/reconciliation/`**, and the `data-truth` agent is the thing that
  should own it. In Follow Ups.
- **The date range and the status filter now read different columns, and the screen does not say
  so.** An Admin filtering "due in October" will not see a weekly loan whose weeks are due in October
  but whose capital is due in January. That is the correct answer to the question as asked, and it is
  also surprising. Wording for the loans search screen is a question for the owner, in Follow Ups.
- **No new index is needed beyond the one in Phase 2.** `(userId, status, nextDueOn)` serves the
  filter, the count and the `orderBy`. The existing `(dueOn)` index still serves the date range.
- **`tests/ui/loan-status.test.ts` and `tests/loans/loan-filter.test.ts` both exist** and cover the
  rule and the filter. Neither knows about weekly loans, so both should pass unchanged — which is the
  evidence that this phase changed nothing for the loans that already exist.

---

### Phase 5: Floating, Out on loan and Earned

The phase where getting it wrong displays wrong money. Every query that computes a pot, listed and
changed.

> **Every query in the app that computes floating, out-on-loan or earned, found by starting from
> `src/server/` and following each figure to the screen that prints it.** Eleven, in five files.
> The three that are not changed are listed too, because "not changed" is a claim that has to be
> checkable.

| # | Query | File:line | Figure it feeds | Change |
| --- | --- | --- | --- | --- |
| 1 | `ledgers()` | `lenders/queries.ts:140` | Floating · Out on loan · Earned, on every screen | **Yes** — Step 5.1 |
| 2 | `buildHistory()` | `lenders/queries.ts:222` | the 12-month chart on a lender profile | **Yes** — Step 5.2 |
| 3 | `getLender()` running/settled split | `lenders/queries.ts:432` | "where the money is" list | **Yes** — Step 5.2 |
| 4 | `splitCuts()` + `adminCuts` query | `lenders/queries.ts:294, 400` | the Admin pot's itemised cut | **Yes** — Step 5.2 |
| 5 | `interestSummary()` | `loans/queries.ts:322` | dashboard interest charged / collected | **Yes** — Step 5.3 |
| 6 | `listLoans().totals.outstanding` | `loans/queries.ts:289` | "still to collect" on the loans list | **Yes** — Step 5.4 |
| 7 | `toSummary().outstanding` | `borrowers/queries.ts:108` | what each borrower owes | **Yes** — Step 5.4 |
| 8 | `summaryReport()` collected / earned | `reports/queries.ts:325` | the overall PDF | **Yes** — Phase 7 |
| 9 | `adminCutReport()` collected / outstandingToday | `reports/queries.ts:459` | the Admin's cut PDF | **Yes** — Phase 7 |
| 10 | `lenderReport().earnedInPeriod` | `reports/queries.ts:588` | the lender statement PDF | **Yes** — Phase 7 |
| 11 | `borrowerReport().paidInPeriod / owedToday` | `reports/queries.ts:706` | the borrower statement PDF | **Yes** — Phase 7 |
| — | `lenderPosition()` | `lib/money/floating.ts:84` | the arithmetic itself | **No** — the sum is unchanged; only what feeds `settledEarnings` moves |
| — | `overdueSummary()` | `loans/queries.ts:301` | overdue count / sum | **No** — follows `loanWhere`, done in Phase 4 |
| — | `adminStakeInLoan()` | `lib/money/split.ts:437` | the advance ceiling | **No**, but see the Issues below |

#### Step 5.1: `ledgers()` gains a third bucket

**File:** `src/server/lenders/queries.ts`
**Verify:** `npm run typecheck`

Today a funding row is settled or pending, decided by `loan.status === 'PAID'`. A weekly loan is both
at once: the capital is out, and part of the earnings is already in the lender's hand. This is the
single most important change in the plan — it is what makes "Out on loan holds steady at ₱60,000
while Earned climbs each week it is actually collected" true.

```diff
 async function ledgers(userId: string): Promise<Map<string, LenderLedger>> {
-  const [transactions, fundings, self] = await Promise.all([
+  const [transactions, fundings, self, weeksPaid] = await Promise.all([
     db.lenderTransaction.groupBy({ ... }),
     db.loanFunding.findMany({
       where: { userId, loan: { deletedAt: null } },
       select: {
         lenderId: true,
         principalCentavos: true,
         earningsCentavos: true,
         adminCutCentavos: true,
-        loan: { select: { status: true } },
+        loan: { select: { id: true, status: true, termDays: true, interestCollection: true } },
       },
     }),
     db.lender.findFirst({ where: { userId, isSelf: true }, select: { id: true } }),
+    // WHICH WEEKS HAVE BEEN COLLECTED, for every weekly loan on the account, in
+    // one query. Not one per loan and not a join: an account has a handful of
+    // weekly loans carrying twenty rows each, so this is tens of rows, and
+    // fetching the week numbers lets the caller decide what a gap means rather
+    // than having Postgres guess.
+    db.payment.findMany({
+      where: {
+        userId,
+        deletedAt: null,
+        weekNumber: { not: null },
+        loan: { deletedAt: null, interestCollection: 'WEEKLY' },
+      },
+      select: { loanId: true, weekNumber: true },
+    }),
   ])
+
+  const paidByLoan = new Map<string, Set<number>>()
+  for (const row of weeksPaid) {
+    const set = paidByLoan.get(row.loanId) ?? new Set<number>()
+    set.add(row.weekNumber as number)
+    paidByLoan.set(row.loanId, set)
+  }
```

```diff
   for (const row of fundings) {
     const entry = ledger(row.lenderId)
     const settled = row.loan.status === 'PAID'
 
-    if (settled) entry.settledEarnings = centavos(entry.settledEarnings + row.earningsCentavos)
-    else {
-      entry.activePrincipal = centavos(entry.activePrincipal + row.principalCentavos)
-      entry.pendingEarnings = centavos(entry.pendingEarnings + row.earningsCentavos)
-    }
+    // A WEEKLY LOAN IS SETTLED AND PENDING AT THE SAME TIME, and that is the
+    // whole feature. FEATURES.md section 5: a paid week releases that week's
+    // money immediately, while the capital stays out on loan until February.
+    //
+    // So the row is split three ways rather than two. The capital is out until
+    // the loan is PAID, exactly as before. The earnings are divided at the
+    // line between weeks collected and weeks still owed, which realisedThrough
+    // answers from the loan's own stored figures — no rate, no recomputation.
+    //
+    // On an AT_END loan `released` is 0 while it runs and the whole earnings
+    // when it is paid, so those loans go down the same two paths they always
+    // did and no branch asks which kind of loan it is looking at.
+    const released = releasedEarnings(row, paidByLoan)
+
+    if (settled) entry.settledEarnings = centavos(entry.settledEarnings + row.earningsCentavos)
+    else {
+      entry.activePrincipal = centavos(entry.activePrincipal + row.principalCentavos)
+      entry.settledEarnings = centavos(entry.settledEarnings + released)
+      entry.pendingEarnings = centavos(entry.pendingEarnings + row.earningsCentavos - released)
+    }
 
     if (self) {
       const admin = ledger(self.id)
-      if (settled) admin.settledAdminCuts = centavos(admin.settledAdminCuts + row.adminCutCentavos)
-      else admin.pendingAdminCuts = centavos(admin.pendingAdminCuts + row.adminCutCentavos)
+      // The Admin's cut follows the same line, week for week. It is released
+      // into Admin earnings the day the week is collected, not when the loan
+      // settles — the other half of the same sentence in the spec.
+      const releasedCut = releasedCut(row, paidByLoan)
+      if (settled) admin.settledAdminCuts = centavos(admin.settledAdminCuts + row.adminCutCentavos)
+      else {
+        admin.settledAdminCuts = centavos(admin.settledAdminCuts + releasedCut)
+        admin.pendingAdminCuts = centavos(admin.pendingAdminCuts + row.adminCutCentavos - releasedCut)
+      }
     }
   }
```

The two helpers, in the same file, both one call into the domain layer:

```diff
+/**
+ * What of this funding row's earnings has actually reached the lender.
+ *
+ * Zero on an AT_END loan that is still running, and on a weekly loan with no
+ * week collected yet. Never more than the row's stored earnings, whatever the
+ * payments say, because the stored figure is what was agreed.
+ */
+function releasedEarnings(row: FundingRow, paidByLoan: Map<string, Set<number>>): Centavos {
+  if (row.loan.interestCollection !== 'WEEKLY') return centavos(0)
+  const weeks = row.loan.termDays / DAYS_PER_WEEK
+  const paid = consecutivePaidWeeks(weeks, paidByLoan.get(row.loan.id) ?? new Set())
+  return realisedThrough(centavos(row.earningsCentavos), weeks, paid)
+}
```

> **`lenderPosition()` in `lib/money/floating.ts` does not change a line, and that is the check that
> this is right.** Its sum is
> `floating = deposits - withdrawals - activePrincipal + settledEarnings + settledAdminCuts`. Moving
> a collected week from `pendingEarnings` to `settledEarnings` raises floating by exactly that week
> and leaves `outOnLoan` alone — which is the behaviour FEATURES.md describes, produced by feeding
> the existing function better inputs rather than by teaching it a new case.

#### Step 5.2: The lender profile — chart, lists, and the Admin's itemised cut

**File:** `src/server/lenders/queries.ts`
**Verify:** `test -f tests/money/weekly-ledger.test.ts`

Three more places in the same file key off "is the loan paid", and a weekly loan answers "partly".

**`buildHistory()`** rebuilds each month from the movements. A collected week is a movement with its
own date, so it lands in its own column:

```diff
     for (const row of rows) {
       const mine = row.lenderId === lenderId
       const started = row.loan.startOn <= end
       const repaid = row.loan.paidOn !== null && row.loan.paidOn <= end
 
-      if (isSelf && repaid) pot += row.adminCutCentavos
-      if (!mine || !started) continue
-      if (repaid) pot += row.earningsCentavos
-      else out += row.principalCentavos
+      // Weeks collected BY the end of this month. A weekly loan drips into the
+      // pot month after month while its capital stays in `out` — which is the
+      // shape the chart exists to show, and the shape it could not draw while
+      // every peso arrived on one day.
+      const weeklyByThen = releasedByDate(row, end)
+
+      if (isSelf) pot += repaid ? row.adminCutCentavos : weeklyByThen.adminCut
+      if (!mine || !started) continue
+      if (repaid) pot += row.earningsCentavos
+      else {
+        pot += weeklyByThen.earnings
+        out += row.principalCentavos
+      }
     }
```

> **This needs the weeks' `paidOn` dates, which `buildHistory` is not given today.** Its `rows`
> parameter carries `loan: { startOn, paidOn }`. It gains `weeklyPaidOn: Date[]` per row, fetched in
> the same `historyRows` query the function is already fed from. `releasedByDate` counts the weeks
> dated on or before the month end and calls `realisedThrough`.

**`getLender()`'s running/settled split** and **`splitCuts()`** both partition on `state === 'paid'`.
A weekly loan belongs in `fundings` (running) throughout, because its capital is still out — which is
what those lists mean. **No change is needed to the partition**, and the reason is worth writing in
the file so it is not "fixed" later:

```diff
 function splitCuts(rows: AdminCutRow[]): { running: AdminCutRow[]; settled: AdminCutRow[] } {
+  // SETTLED STILL MEANS THE LOAN IS PAID, including for a weekly loan with
+  // nineteen of its twenty weeks collected. The two lists reconcile against
+  // position.adminCutEarned and position.adminCutPending, and those two are now
+  // split at the week line rather than the loan line — so a weekly loan's cut
+  // appears in BOTH totals while it runs, and its row is listed once, under
+  // running. The row shows the whole loan's cut; the tiles show what has
+  // arrived. The loan page is where the week-by-week breakdown lives.
   return {
```

> **That is a real discrepancy between a tile and the rows under it, and the screen must say so.**
> `LenderDetail.adminCuts` exists precisely because "the tiles above carry a cut that belongs to none
> of the loans listed on this page" — the same class of problem, already solved once on this screen
> by printing the difference rather than hiding it. The wording is in Follow Ups.

#### Step 5.3: `interestSummary()` — the dashboard's collected figure

**File:** `src/server/loans/queries.ts`
**Verify:** `npm run verify`

Today: `charged` is `SUM(interestCentavos)` over live loans, `collected` the same sum restricted to
`status = 'PAID'`. On a weekly loan interest is collected for months before the loan is PAID, so
`collected` understates and `pending` overstates by the same amount.

```diff
 export async function interestSummary(
   userId: string,
 ): Promise<{ charged: Centavos; collected: Centavos; pending: Centavos }> {
   const where = { userId, deletedAt: null }
 
-  const [all, paid] = await Promise.all([
+  const [all, paid, weekly] = await Promise.all([
     db.loan.aggregate({ where, _sum: { interestCentavos: true } }),
     db.loan.aggregate({
       where: { ...where, status: 'PAID' as const },
       _sum: { interestCentavos: true },
     }),
+    // THE WEEKS ALREADY COLLECTED ON LOANS THAT ARE STILL RUNNING. Their
+    // interest is in the Admin's and the lenders' hands, so counting it as
+    // pending would tell the Admin money is still to come that has already
+    // arrived — and the Floating tile, which now includes it, would disagree
+    // with the Interest tile on the same screen.
+    //
+    // SUM over the amountCentavos of the live weekly payment rows, which is what
+    // was handed over. Not recomputed from the schedule: the row records the
+    // amount that was actually collected, and reading it is one aggregate
+    // instead of a schedule rebuilt per loan.
+    db.payment.aggregate({
+      where: {
+        userId,
+        deletedAt: null,
+        weekNumber: { not: null },
+        loan: { deletedAt: null, status: 'ACTIVE' },
+      },
+      _sum: { amountCentavos: true },
+    }),
   ])
 
   const charged = all._sum.interestCentavos ?? 0
-  const collected = paid._sum.interestCentavos ?? 0
+  // Loans settled in full, plus the weeks collected on loans still running.
+  // The two cannot overlap: the weekly sum is restricted to ACTIVE loans, and
+  // a loan that has settled is PAID.
+  const collected = (paid._sum.interestCentavos ?? 0) + (weekly._sum.amountCentavos ?? 0)
```

> **The label on the dashboard tile has to be checked against this.** `label-truth` is mandatory
> before editing anything that displays a figure from the database, and this changes what "collected"
> counts. The tile currently reads Earned; what it now promises is "interest that has reached the
> Admin or a lender, including weeks collected on loans still running". Step 6.4 carries the copy.

#### Step 5.4: "Still to collect", on the loans list and the borrower profile

**File:** `src/server/loans/queries.ts`, `src/server/borrowers/queries.ts`
**Verify:** (omitted — what this figure should MEAN is an open question for the owner, in Follow Ups.
A check here would assert whichever answer the implementer picked)

Both figures are `SUM(totalCentavos)` over `ACTIVE` loans. On Angel's loan that is ₱144,000
(capital + all twenty weeks) on the day it is made and ₱144,000 still, after fifteen weeks have been
collected — although only ₱81,000 is actually still to come.

```diff
   totals: {
     ...
-    outstanding: centavos(active?._sum.totalCentavos ?? 0),
+    // What is STILL TO COLLECT, which on a weekly loan is not the loan's total:
+    // the weeks already collected have been collected. Subtracting them is what
+    // makes this figure and the Floating tile describe the same pesos.
+    outstanding: centavos((active?._sum.totalCentavos ?? 0) - (weeklyCollected._sum.amountCentavos ?? 0)),
   },
```

The same subtraction in `toSummary()` on the borrower list, and in `getBorrower()`.

#### Phase 5 — Potential Issues

- Type mismatches across the layers this phase touches
- Cross-cutting registration this phase assumes but no step performs — see CONVENTIONS.md
- Unhandled edge cases: empty lists, exhausted pagination, absent fields, error payloads
- Breaking changes to existing consumers, including anything built against mocks before a real
  contract landed
- New patterns not already established here. Do not introduce one without saying why the existing
  pattern is insufficient
- Layering violations — data-shaping leaking out of its layer, or the transport bypassed

**Issues identified:**

- **`adminStakeInLoan` now over-states the advance ceiling on a weekly loan.** The ceiling is
  everything the loan returns to the Admin pot when it settles: their principal, their earnings and
  their cut. On a weekly loan part of the earnings and part of the cut have **already been paid into
  the pot**, so they are in `floating` AND in the ceiling, and the Admin can draw the same money
  twice. Angel's loan is funded entirely by the Admin's own pot, so this is live on the one loan
  the feature was built for. It is listed as "No change" in the table above because the function
  itself is right; the caller in `getLoan` must subtract what has been released. **Severity High, in
  Follow Ups** — this is the one issue in the plan that can move real money rather than display it
  wrongly.
- **`interestSummary().collected` sums `Payment.amountCentavos`; `ledgers()` sums
  `realisedThrough` over the funding rows.** Two routes to the same money, and CONVENTIONS.md is
  explicit that a second opinion about the same pesos is what must not happen. They agree exactly as
  long as `markWeekPaid` writes the amount the schedule produced, which Step 3.4 does. They would
  stop agreeing the day a week's amount is edited by hand. **A reconciliation entry belongs in
  `.claude/reconciliation/`** comparing the two; the `data-truth` agent should run over the dashboard
  once this phase lands. In Follow Ups.
- **`consecutivePaidWeeks` versus the payment sum, on a loan with a gap.** `ledgers()` uses the
  unbroken run; `interestSummary()` sums every collected week. On a converted loan with week 2 missed
  and week 3 paid, they disagree by one week. Same root cause as the Phase 1 issue, same fix, and it
  is the reason that issue is Medium rather than Low: it is not only an understatement, it is an
  understatement in one place and not in another. In Follow Ups.
- **`buildHistory` needs data it is not currently given.** Its signature grows a `weeklyPaidOn`
  array per row, fed from the `historyRows` query in `getLender`. That query already fetches every
  funding row in the account for the Admin pot, so the payments come with it rather than as a fifth
  round trip.
- **The Admin pot's itemised cut list and its tile will differ on a running weekly loan**, by the
  weeks already collected. The screen already has a pattern for exactly this, added when the cut
  itself did not belong to any listed loan. It must be used rather than the difference being papered
  over.
- **Nothing here is a new pattern.** Every change feeds existing functions different inputs;
  `lenderPosition`, `adminTakeOnLoan` and `splitLoan` are untouched.

---

### Phase 6: The screens

The loan page grows a schedule, the Active Loans list shows the next unpaid week, the loan form
offers the mode.

#### Step 6.1: The schedule the loan page shows

**File:** `src/server/loans/queries.ts`
**Verify:** `npm run typecheck`

`getLoan` gains the schedule, built in the server layer from rows it already fetches. The UI does no
arithmetic — the rule CONVENTIONS.md sets for this project is that every peso decision lives in
`src/lib/money/` and the screen renders what it is handed.

```diff
+/** One week of a weekly loan, as the loan page lists it. */
+export type LoanWeekRow = {
+  week: number
+  dueOn: Date
+  interest: Centavos
+  /** The day it was collected, or null while it is still owed. */
+  paidOn: Date | null
+  /** A collected week with nothing attached. Flagged, never blocked. */
+  missingProof: boolean
+  /**
+   * True for the last week, which is handed over WITH the capital in one
+   * payment and so is never collected on its own. The row says so rather than
+   * offering a button that would be refused.
+   */
+  withCapital: boolean
+}
+
 export type LoanDetail = Omit<LoanRow, 'funders' | 'latestNote' | 'noteCount'> & {
   interest: Centavos
   termDays: number
   startOn: Date
   interestBasis: InterestBasis
+  interestCollection: InterestCollection
+  /** The capital date. On a weekly loan this is NOT what the loans list shows. */
+  capitalDueOn: Date
+  /** Empty on a loan collected at the end. */
+  weeks: LoanWeekRow[]
+  /** Collected so far, added up from the weeks above so the two cannot disagree. */
+  weeklyCollected: Centavos
+  /** Still owed on the weeks, plus the capital. */
+  weeklyOutstanding: Centavos
   ...
 }
```

#### Step 6.2: The schedule and the week panel on the loan page

**File:** `src/app/(app)/loans/[id]/weekly-schedule.tsx`
**Verify:** `test -f src/app/(app)/loans/[id]/weekly-schedule.tsx`

A server component for the list and a client one for the form, split the way
`page.tsx` / `payment-panel.tsx` already are. `MarkPaidPanel` is the worked example and is followed,
including leaving the mark-a-week form **unwrapped** so it posts without JavaScript.

```diff
+/**
+ * The week-by-week schedule of a loan that collects its interest weekly.
+ *
+ * BOTH DATES ARE ON THIS PAGE and neither stands in for the other. The Active
+ * Loans list shows the next unpaid week, because that is what needs chasing;
+ * this page shows that AND the capital date, because that is what was agreed.
+ * FEATURES.md section 5.
+ *
+ * ONE WEEK AT A TIME. Only the earliest unpaid week carries a button. The rest
+ * are rows. There is no paying ahead and no paying two weeks in one go, so
+ * offering a button on week 9 while week 7 is owed would be offering something
+ * the server refuses.
+ *
+ * The colours are the four status tokens and nothing else, and every state
+ * ships an icon and a word beside the tint — the rule in CONVENTIONS.md, which
+ * matters here more than anywhere because this list is twenty rows of almost
+ * identical figures distinguished mainly by state.
+ */
+export function WeeklySchedule({ loan }: { loan: LoanDetail }) {
+  const next = loan.weeks.find((week) => week.paidOn === null)
+
+  return (
+    <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
+      <div>
+        <h2 className="text-base font-semibold tracking-tight">Weekly interest</h2>
+        <p className="text-muted-foreground mt-0.5 text-xs">
+          The Admin collects the interest every week. The capital comes back on{' '}
+          {dateFormat.format(loan.capitalDueOn)}, with the last week.
+        </p>
+      </div>
+
+      <StatRow>
+        <StatTile label="Collected so far" value={<Money amount={loan.weeklyCollected} variant="display" />} />
+        <StatTile label="Still to collect" value={<Money amount={loan.weeklyOutstanding} variant="display" />} />
+      </StatRow>
+
+      <Table>
+        {/* tabular-nums in the money column, per CONVENTIONS.md: in a column it
+            stacks the decimal points, which is what makes twenty near-identical
+            rows scannable. Money variant="column" encodes it. */}
+        ...
+      </Table>
+    </section>
+  )
+}
```

> **Copy check.** "The Admin collects the interest every week" — says Admin, not you. "The capital
> comes back on 23 January 2027, with the last week" — a comma, not an em dash. Every string proposed
> in this plan follows both rules; an implementer adding more must too.

The panel, modelled line for line on `MarkPaidPanel`:

```diff
+/**
+ * Collecting one week.
+ *
+ * markWeekPaid itself, not a wrapper — the same choice MarkPaidPanel makes and
+ * for the same reason. This form is rendered server-side and posts without
+ * JavaScript; wrapping the action to close a panel would cost it that, and
+ * there is nothing to close. On success the row it belongs to is replaced by
+ * the week that was just collected.
+ *
+ * THE AMOUNT IS NOT A FIELD and neither is the week. Both are read from the
+ * loan: the amount was fixed the day it was created, and the week is whichever
+ * one is earliest unpaid. Neither can be mistyped because neither is typed.
+ */
+export function MarkWeekPaidPanel({ loanId, week, amount }: { loanId: string; week: number; amount: string }) {
+  const [state, formAction] = useActionState(markWeekPaid, NO_ERROR)
+  ...
+      <p className="text-muted-foreground mt-0.5 text-xs">
+        Records week {week}, {amount}. The capital stays out on loan.
+      </p>
+  ...
+}
```

#### Step 6.3: Active Loans shows the next unpaid weekly date

**File:** `src/app/(app)/loans/page.tsx`, `src/server/loans/queries.ts`
**Verify:** (omitted — a rendered date. The rule behind it is tested in Step 4.2; what this step
changes is which of two dates is printed, and that is checked by looking)

`LoanRow.dueOn` becomes the next owed date, with the capital date carried separately so nothing
downstream loses it:

```diff
 export type LoanRow = {
   ...
-  dueOn: Date
+  /**
+   * The next day money is owed. On a weekly loan this is the earliest unpaid
+   * week, NOT February — FEATURES.md section 5. The capital date lives on the
+   * loan page, which is the screen that shows both.
+   */
+  dueOn: Date
+  /** True when the date above is a weekly instalment rather than the loan's own due date. */
+  dueIsWeekly: boolean
   state: LoanState
```

```diff
-      <Money amount={loan.capital} variant="display" /> · due {dateFormat.format(loan.dueOn)}
+      <Money amount={loan.capital} variant="display" /> ·{' '}
+      {loan.dueIsWeekly ? 'week due' : 'due'} {dateFormat.format(loan.dueOn)}
```

> **The two words are not decoration.** Without them the list shows Angel due on 3 October beside
> loans due on 3 October meaning the whole ₱144,000, and the Admin has no way to tell a ₱4,200 week
> from a capital repayment. `label-truth` applies: the words next to a figure are the claim, and
> "due" on a weekly row claims the wrong one.

#### Step 6.4: The loan form's collection toggle, and the dashboard tile's label

**File:** `src/app/(app)/loans/loan-form.tsx`, `src/app/(app)/page.tsx`
**Verify:** `npm run verify`

A checkbox, shown only when the basis is a weekly rate, because a fixed-amount loan cannot carry it:

```diff
+{/* Only on a weekly rate. A fixed-amount loan has no week count to instal
+    against, and the server refuses it — so the box is not offered rather than
+    offered and rejected. */}
+{basis === 'WEEKLY_RATE' ? (
+  <label className="flex items-start gap-2">
+    <input type="checkbox" name="interestCollection" value="WEEKLY" ... />
+    <span>
+      <span className="font-medium">Collect the interest every week</span>
+      <span className="text-muted-foreground block text-xs">
+        The borrower pays the interest weekly and returns the capital on the due date, with the
+        last week. The total does not change.
+      </span>
+    </span>
+  </label>
+) : null}
```

And the dashboard, where `interestSummary().collected` now means something wider:

```diff
-  label="Earned"
+  label="Interest collected"
```

> **`label-truth` is mandatory here and this is the reason.** The tile reads a figure that, after
> Step 5.3, includes weeks collected on loans that have not been repaid. "Earned" was true when
> interest arrived only on repayment; it is now ambiguous between charged and received. "Interest
> collected" is what the query returns. The exact wording is the owner's to confirm, and it is in
> Follow Ups — but it cannot ship saying "Earned" beside a figure that changed meaning underneath it.

#### Phase 6 — Potential Issues

- Type mismatches across the layers this phase touches
- Cross-cutting registration this phase assumes but no step performs — see CONVENTIONS.md
- Unhandled edge cases: empty lists, exhausted pagination, absent fields, error payloads
- Breaking changes to existing consumers, including anything built against mocks before a real
  contract landed
- New patterns not already established here. Do not introduce one without saying why the existing
  pattern is insufficient
- Layering violations — data-shaping leaking out of its layer, or the transport bypassed

**Issues identified:**

- **`LoanRow.dueOn` changing meaning is a silent change for every consumer.** The loans list is the
  only screen that renders it, so the blast radius is small, but the field name no longer says what
  it holds. `dueIsWeekly` beside it is the mitigation; renaming it to `nextDueOn` across the type
  would be better and is a larger diff. The implementer should pick one, not neither.
- **The dashboard tile's label must not ship unchanged.** "Earned" beside a figure that now includes
  uncollected-loan weeks is the exact failure `label-truth` exists to catch. The wording proposed
  here is a placeholder for the owner's answer, and the step is gated on `npm run verify` rather than
  left unverified because the rest of the step is real code.
- **`<StatTile>` uses `variant="display"` and the weekly table uses `variant="column"`.** That is the
  `tabular-nums` trap in CONVENTIONS.md and it bites hardest on this feature: twenty rows of ₱4,200
  is precisely the column that needs decimal points stacked, and the two tiles above it are
  precisely the figures that read gappy with it.
- **The schedule table is twenty rows on a phone.** Nothing in the existing design system has a list
  that long on a loan page. Whether it collapses to the next few weeks with the rest behind a
  disclosure is a design decision, not an implementation one, and it is in Follow Ups.
- **No new colour token.** The four status tokens cover paid, overdue, due-today and due-soon, and a
  week is one of those four. A fifth tone for "collected with the capital" would break the rule that
  colour means loan state and nothing else; the final week's row says so in words instead.
- **The form checkbox is inside a client component that must not import from `src/server/`.** The
  refusal sentences for a fixed-amount loan and a one-week loan live in `terms.ts`, which is server
  side, so the form cannot show them live the way it shows `describeWeeksError`. It hides the box
  instead, which is why the box is conditional rather than disabled.

---

### Phase 7: Reports, backup, Recently Deleted, and the conversion

Everything downstream, then the one-off flow that gets the existing loan in.

#### Step 7.1: The Excel backup's Payments sheet, one row per weekly payment

**File:** `src/server/reports/backup.ts`
**Verify:** `npm run typecheck`

FEATURES.md is explicit: the Payments sheet carries one row per weekly payment. Today it is built
from `live.filter(loan => loan.payment !== null)`, one row per loan.

```diff
   const paymentRows: CellValue[][] = live
-    .filter((loan) => loan.payment !== null)
-    .map((loan) => {
-      const payment = loan.payment!
-      return [
+    // ONE ROW PER PAYMENT, not per loan. A weekly loan hands over twenty of
+    // them and the sheet has to show twenty, or a column that adds up in Excel
+    // adds up to less than was received. FEATURES.md section 5.
+    //
+    // Undone payments are still excluded, the same as before: the `live` map
+    // above dropped the settling one, and this filters the weekly ones.
+    .flatMap((loan) =>
+      loan.payments
+        .filter((payment) => payment.deletedAt === null)
+        .sort(byWeekThenDate)
+        .map((payment) => [
         loan.borrowerName,
+        // "Capital and the last week" on the settling row of a weekly loan,
+        // "Week 7 interest" on a weekly one, blank on an ordinary loan where
+        // there is only ever one payment and naming it adds nothing.
+        describePayment(loan, payment),
         day(payment.paidOn),
         pesos(centavos(payment.amountCentavos)),
         payment.proofFiles.length,
         payment.proofFiles.map((proof) => proof.storagePath).join(', '),
         day(payment.createdAt),
         loan.id,
-      ]
-    })
+        ]),
+    )
```

The Loans sheet gains two columns and the Read me gains a line, because a file on a hard drive six
months from now has to explain itself:

```diff
         { header: 'Interest basis', type: 'text', width: 14 },
+        { header: 'Interest collected', type: 'text', width: 16 },
+        { header: 'Weeks collected', type: 'number', width: 14 },
```

```diff
-    ['Payments sheet', 'Repayments that stand. A payment that was undone is not here and its loan reads Active.'],
+    ['Payments sheet', 'Every payment that stands, one row each. A loan collecting its interest weekly has one row per week plus the final one that carries the capital. A payment that was undone is not here.'],
+    ['Weekly loans', 'The Admin collects the interest every week and the capital comes back on the due date, with the last week. The total is the same as it would be collected all at once.'],
```

> The `live` map at `backup.ts:121` that resolves the undone payment once, "what keeps every sheet
> below agreeing about whether a loan was repaid", is the thing to preserve. It keeps its job for the
> settling payment and gains the weekly list beside it.

#### Step 7.2: The PDF reports

**File:** `src/server/reports/queries.ts`, `src/server/reports/document.tsx`
**Verify:** (omitted — CONVENTIONS.md says the check on a report is to render it to an image and
look, because the fonts fail silently. A command cannot do that)

There are **five** report kinds, not four: `summary`, `admin-cut`, `lender`, `borrower` and
`borrower-file`. FEATURES.md section 9 lists four; the Admin's cut report was added since. All five
read money that this feature moves.

| Report | What changes |
| --- | --- |
| `summaryReport` | `collected` and `earned` are keyed on a settling payment in the period. Weeks collected in the period are money that arrived and must be added. |
| `adminCutReport` | `repaid` / `collected` likewise. `outstandingToday` must subtract the cut already released, or it double-counts. |
| `lenderReport` | `earnedInPeriod` and `adminCutInPeriod` both sum funding rows on loans repaid in the period. Weeks are the other half. Section 5 says this report lists the weekly payments. |
| `borrowerReport` | `paidInPeriod` and `owedToday`. Section 5 says this one lists them too. |
| `borrower-file` | The same, plus each week's proof rows. |

The new shared row type, so the two statements list the same thing the same way:

```diff
+/**
+ * One payment on a statement.
+ *
+ * Both the lender's statement and the borrower's list these now, because a
+ * weekly loan is twenty events rather than one and a statement that showed a
+ * single repayment would describe five months of collections as nothing having
+ * happened. FEATURES.md section 5.
+ *
+ * `week` is null on the payment that settles a loan, which on a weekly loan is
+ * the capital and the final week together.
+ */
+export type PaymentRow = {
+  on: Date
+  amount: Centavos
+  week: number | null
+  borrowerName: string
+}
```

#### Step 7.3: Recently Deleted, and what a deleted weekly payment means there

**File:** `src/server/deleted/queries.ts`, `src/app/(app)/deleted/page.tsx`
**Verify:** `test -f tests/deleted/weekly-payment.test.ts`

Recently Deleted has four sections — lenders, borrowers, loans, transactions — and **payments are not
one of them**. An undone repayment is soft-deleted and simply does not appear; the loan reads Active
again, which is the whole story. The purge collects it after thirty days via
`db.payment.findMany({ where: expired })`, which already works and needs no change.

An undone **week** is different, and the plan must say which of two answers is wanted rather than
pick one:

> **Option A — leave it invisible, as today.** An undone week vanishes and the schedule shows the
> week as owed again. The purge cleans it up. Nothing to build; consistent with how an undone
> repayment already behaves. The cost: a week collected, undone by mistake, and then not noticed is
> unrecoverable proof, because the proof files go with it after thirty days.
>
> **Option B — a fifth section.** Weekly payments carry money and proof, and a wrongly undone week is
> exactly the mistake Recently Deleted exists to reverse.
>
> **This plan recommends Option A** and raises it in Follow Ups. Reason: FEATURES.md section 11 says
> "any record can be deleted for any reason, and restored whole" but the app has never treated a
> payment that way, and changing that for weekly payments alone would make the two kinds of payment
> behave differently in the one place the Admin goes when something has gone wrong. If the answer is
> Option B, it should be Option B for **both**, and that is a separate piece of work.

What this step does build is the guard that stops the invisible case being silent:

```diff
+// A week undone is a week owed again, and the loan's next due date moves back
+// with it. Without this the schedule shows week 7 unpaid while the list still
+// chases week 8, and the two disagree on the same screen refresh.
```

#### Step 7.4: Converting a loan already in the app

**File:** `src/server/loans/convert.ts`, `src/app/(app)/loans/[id]/convert-to-weekly.tsx`
**Verify:** `npm run verify`

The one-off flow that gets Angel's loan in without re-entering it. The Admin switches a running
loan to weekly collection and ticks off the weeks already paid, each with its own paid date.

```diff
+'use server'
+
+/**
+ * Switching a loan already in the app to weekly collection.
+ *
+ * WHY THIS IS NOT JUST AN EDIT. updateLoan recomputes every figure from the
+ * submitted form, which is right when something was entered wrong and wrong
+ * here: nothing about this loan was entered wrong. The capital, the rate, the
+ * dates, the split and every funding row stay exactly as they are. The only
+ * thing that changes is WHEN the interest is collected, and which weeks have
+ * already been handed over.
+ *
+ * So this writes two things and touches no money column: Loan.interestCollection,
+ * and one Payment row per week the Admin ticks. The schedule is generated from
+ * the dates the loan already has, exactly as it would have been at creation,
+ * because the arithmetic in money/weekly.ts reads the stored funding rows and
+ * nothing else.
+ *
+ * REFUSED on a FIXED_AMOUNT loan, on a PAID loan, and on a loan whose term is
+ * not whole weeks. The first two for the reasons loanTerms and updateLoan
+ * already give; the third because a stored termDays that is not a multiple of 7
+ * cannot happen on a WEEKLY_RATE loan and finding one means something else is
+ * wrong.
+ *
+ * EACH TICKED WEEK GETS ITS OWN PAID DATE, typed by the Admin — FEATURES.md
+ * section 5. Not defaulted to the week's due date: the point of recording them
+ * is the history, and a history of twenty dates nobody chose is not one.
+ *
+ * PROOF IS NOT COLLECTED HERE. These are weeks that were paid before the app
+ * knew about them; the screenshots are wherever they are. Each row flags itself
+ * as missing proof, the same as any other payment, and Add proof on the loan
+ * page is how it arrives later.
+ */
+export async function convertToWeekly(_prev: FormState, form: FormData): Promise<FormState> {
+  const user = await requireUser()
+
+  const loanId = text(form, 'loanId')
+  const loan = await db.loan.findFirst({
+    where: { id: loanId, userId: user.id, deletedAt: null },
+    select: {
+      id: true, status: true, startOn: true, dueOn: true, termDays: true,
+      interestBasis: true, interestCollection: true,
+      payments: { select: { id: true, weekNumber: true, deletedAt: true } },
+      fundings: { select: { lenderId: true, earningsCentavos: true, adminCutCentavos: true } },
+    },
+  })
+  if (!loan) return failed('That loan no longer exists.')
+  if (loan.interestCollection === 'WEEKLY') {
+    return failed('That loan already collects its interest weekly.')
+  }
+  if (loan.interestBasis !== 'WEEKLY_RATE') {
+    return failed('A loan charging a fixed amount of interest cannot be collected weekly.')
+  }
+  if (loan.status === 'PAID') {
+    return failed('That loan has been paid, so there is nothing left to collect weekly.')
+  }
+  if (loan.payments.some((row) => row.deletedAt === null)) {
+    return failed('That loan already has a payment recorded. Undo it first.')
+  }
+
+  const weeks = loan.termDays / DAYS_PER_WEEK
+  if (!Number.isInteger(weeks) || weeks < MIN_WEEKLY_WEEKS) {
+    return failed('A loan collected weekly runs a whole number of weeks, at least two.')
+  }
+
+  // Which weeks were already paid, and when. One date per ticked week.
+  const ticked = readTickedWeeks(form, weeks)
+  if (!ticked.ok) return failed(ticked.error)
+
+  // The FINAL week cannot be ticked: it is handed over with the capital, and a
+  // loan whose capital has come back is a loan that is paid, not one being
+  // converted.
+  if (ticked.value.some((row) => row.week === weeks)) {
+    return failed('The final week is collected with the capital, so it cannot be ticked off here.')
+  }
+
+  const schedule = weeklySchedule(
+    loan.fundings.map((funding) => ({
+      lenderId: funding.lenderId,
+      earnings: centavos(funding.earningsCentavos),
+      adminCut: centavos(funding.adminCutCentavos),
+    })),
+    weeks,
+  )
+
+  await db.$transaction(async (tx) => {
+    if (ticked.value.length > 0) {
+      await tx.payment.createMany({
+        data: ticked.value.map((row) => ({
+          userId: user.id,
+          loanId,
+          weekNumber: row.week,
+          paidOn: row.paidOn,
+          // The week's own amount from the schedule, NOT a figure the Admin
+          // typed. The weeks were collected at the amounts this loan was
+          // created with, whatever anybody remembers.
+          amountCentavos: schedule[row.week - 1].interest,
+        })),
+      })
+    }
+
+    const next = nextUnpaidWeek(loan.startOn, weeks, new Set(ticked.value.map((row) => row.week)))
+    await tx.loan.update({
+      where: { id: loanId },
+      data: {
+        interestCollection: 'WEEKLY',
+        nextDueOn: next?.dueOn ?? loan.dueOn,
+      },
+    })
+  })
+
+  revalidatePath('/', 'layout')
+  return NO_ERROR
+}
```

The screen, on the loan page, behind a confirmation because it moves money onto four other screens:

```diff
+  <h2 className="text-base font-semibold tracking-tight">Collect this interest weekly</h2>
+  <p className="text-muted-foreground mt-0.5 text-xs">
+    The capital and the total do not change. The Admin collects {weekly} a week for {weeks} weeks,
+    and the capital comes back on {capitalDue} with the last week. Tick the weeks that have already
+    been paid and give each one its date.
+  </p>
```

> **Reversing a conversion is not built, and that is a decision, not an omission.** Switching back
> would have to decide what happens to the weeks already recorded, and the honest answer is that they
> are payments and payments are undone one at a time. The Admin undoes each week, then converts back.
> In Follow Ups so it is not re-raised on every audit.

#### Phase 7 — Potential Issues

- Type mismatches across the layers this phase touches
- Cross-cutting registration this phase assumes but no step performs — see CONVENTIONS.md
- Unhandled edge cases: empty lists, exhausted pagination, absent fields, error payloads
- Breaking changes to existing consumers, including anything built against mocks before a real
  contract landed
- New patterns not already established here. Do not introduce one without saying why the existing
  pattern is insufficient
- Layering violations — data-shaping leaking out of its layer, or the transport bypassed

**Issues identified:**

- **`convertToWeekly` cannot run on Angel's actual loan as it stands.** The live row
  (`the live loan`, measured 2026-09-24) is ₱60,000 at 7% from **2026-09-22 to
  2026-10-20** — `termDays` 28, four weeks, interest ₱16,800. FEATURES.md describes September to
  February at twenty-odd weeks and ₱84,000. **The loan in the database is not the loan the spec
  describes.** Conversion generates the schedule from the dates the loan already has, so converting
  it today produces a four-week schedule ending in October. The due date has to be edited to February
  first, which `updateLoan` will do and which recomputes the interest and the total — correctly, to
  ₱84,000, because that is what twenty weeks at 7% comes to. **This is the first Follow Up and it
  blocks Step 7.4 until the owner confirms the order: edit the due date, then convert.** Severity
  High.
- **The PDF step has no executable check, and none is invented for it.** CONVENTIONS.md says the peso
  glyph fails silently in the standard fonts and the check is to render to an image and look. A
  `grep` for a string this step writes would report PASS on a document nobody has seen. Reported as
  `unverifiable`, which is accurate.
- **There are five report kinds, not the four FEATURES.md section 9 lists.** `admin-cut` was added
  since the spec was written. It is not a gap and must not be reported as one; it is noted so an
  implementer working from section 9 does not leave it out.
- **The Excel `Payments` sheet's row count changes shape.** The Read me sheet prints counts and
  describes each sheet; a file whose Payments sheet suddenly has twenty rows for one loan needs the
  line that explains why, or the next monthly backup looks like a duplication bug.
- **An undone weekly payment is invisible, by recommendation rather than by accident.** Option A is
  chosen and argued above. If the owner prefers Option B it applies to both kinds of payment and is
  separate work.
- **Reversing a conversion is not built.** A deliberate deferral, recorded here so CONVENTIONS.md's
  "a deferral is not a gap" rule can be applied to it on future audits.

---

## 3. Related Files

Every file read for this plan has an annotated review in `references/`. The reviews quote only the
lines the plan depends on.

### Read and reviewed

| File | Why it mattered | Review |
| --- | --- | --- |
| `CONVENTIONS.md` | the authority on commands, layering, and eleven traps this feature can fall into | `CONVENTIONS-review.md` |
| `docs/FEATURES.md` §5 | the specification, answer by answer | `FEATURES-review.md` |
| `prisma/schema.prisma` | `Payment.loanId @unique`, the to-one relation, the rules on stored figures | `schema-review.prisma` |
| `src/lib/money/split.ts` | the canonical reference — largest-remainder, the invariants, `adminTakeOnLoan`, `adminStakeInLoan` | `split-review.ts` |
| `tests/money/split.test.ts` | the reconciliation discipline the weekly tests copy | `split.test-review.ts` |
| `src/lib/money/weeks.ts` | `calendarDate`, `addDays`, the whole-weeks rule, the midday trap | `weeks-review.ts` |
| `src/lib/money/interest.ts` | `computeInterest`, and why nothing runs on a schedule | `interest-review.ts` |
| `src/lib/money/floating.ts` | the floating formula, and why it needs no change | `floating-review.ts` |
| `src/lib/loan-state.ts` | copy 1 of the overdue rule | `loan-state-review.ts` |
| `src/lib/track-record.ts` | copy 2 | `track-record-review.ts` |
| `src/lib/loan-filter.ts` | what the status chips mean | `loan-filter-review.ts` |
| `src/server/loans/queries.ts` | copies 3 and 4, `interestSummary`, `listLoans`, `getLoan` | `queries-review.ts` |
| `src/server/loans/terms.ts` | where every figure is decided and every refusal is worded | `terms-review.ts` |
| `src/server/loans/actions.ts` | create and edit, and the PAID-loan refusal | `actions-review.ts` |
| `src/server/lenders/queries.ts` | `ledgers`, `buildHistory`, `splitCuts` — the floating figures | `lenders-queries-review.ts` |
| `src/server/payments/actions.ts` | the upsert, the bucket-before-rows rule, undo | `payments-actions-review.ts` |
| `src/server/payments/queries.ts` | signed proof links | `payments-queries-review.ts` |
| `src/server/borrowers/queries.ts` | the borrower outstanding figure and the track record feed | `borrowers-queries-review.ts` |
| `src/server/reports/queries.ts` | all five reports' money | `reports-queries-review.ts` |
| `src/server/reports/backup.ts` | the Payments sheet, and the Read me | `backup-review.ts` |
| `src/server/deleted/queries.ts` | the four sections, and why payments are not one | `deleted-queries-review.ts` |
| `src/server/deleted/purge.ts` | files before rows; what a purged payment takes with it | `purge-review.ts` |
| `src/app/(app)/loans/[id]/payment-panel.tsx` | the unwrapped-action pattern the week panel copies | `payment-panel-review.tsx` |
| `src/components/loan-status.tsx` | the four status tokens, icon and word | `loan-status-review.tsx` |
| `src/app/(app)/page.tsx` | the dashboard tiles and which query feeds each | `dashboard-page-review.tsx` |
| `harness.config.json` | which commands `verify-plan.mjs` will actually run | — cited inline, 18 lines |

### Read without a review

Too short for a review to be shorter than the thing it summarises, so they are cited by path:
`AGENTS.md` (9 lines — no new Next API is used by this plan, so its instruction to read
`node_modules/next/dist/docs/` was not triggered), `package.json` scripts, `src/lib/countdown.ts`,
`src/server/reports/document.tsx` (scanned for the five report kinds only).

### Measured against the live database on 2026-09-24

Via `node .claude/harness/db-ro.mjs`, read-only:

- `Payment_loanId_key` is a plain `UNIQUE INDEX` on `("loanId")`, with no predicate.
- PostgreSQL 17.6, so a partial unique index and `NULLS NOT DISTINCT` are both available.
- Three accounts: the real account (31 loans, 4 payments), `demo` (9 loans, 4 payments), a third, empty account (empty).
- Angel has three loans, one live: ₱60,000, `WEEKLY_RATE`, 700 bps, 2026-09-22 to
  2026-10-20, `termDays` 28, interest ₱16,800, total ₱76,800, `ACTIVE`, funded **entirely by the
  Admin's own pot** (`isSelf`, 700 bps, 0 cut). The other two are soft-deleted.
- `npm run verify` is green on this tree: 384 tests, 0 failures. It is a usable gate.

## 4. Follow Ups

### Answered by the owner, 2026-09-25

These close items 1, 2, 3, 4, 5, 7 and 10 below. Only item 6 remains open.

**Q10 — a weekly loan edited after weeks were collected: KEEP the collected weeks, re-price the
rest.** The amounts already collected are money that actually changed hands and are never rewritten.
The remaining weeks absorb the whole difference so that the schedule still sums to the loan's new
`interestCentavos` to the centavo, with the remainder on the final week exactly as at creation.
**If the edit makes that impossible — the new total interest is less than what has already been
collected — the edit is refused** with a message naming the amount already taken. That refusal is a
required step, not an optional one: without it the invariant silently breaks. This replaces the
"does nothing if nobody decides" behaviour the plan describes, and the Step 3.2 guard must widen
from shortening to any change that touches `LoanFunding`.

**Q3 — the dashboard tile counts ONLY weeks actually collected**, and is worded **"Interest
collected"**. The whole-loan figure is not what the tile shows. This is the same correction commit
`1e9a48f` made to the Floating tile, for the same reason: a tile must not count money that is not in
the pot.

**Q4 — "Still to collect" means the total MINUS the weeks already collected**, and gets **its own
line** beside the collected figure, so both are visible at once. Step 5.4 can now be verified.

**Q2 — `Loan.nextDueOn` is accepted as a stored derived value.** Decided on the engineering
trade-off rather than referred to the owner: every loans page, status count and dashboard aggregate
would otherwise carry a correlated subquery, and the paging work would be lost. The schema header's
"derived on read, never stored" rule gains this one named exception and must say so (item 11). The
drift risk the plan raises is real, so the `nextDueOn` vs `nextUnpaidWeek` reconciliation stays on
the candidate list.

**Q5 — an undone weekly payment does NOT appear in Recently Deleted.** Option A, as recommended.

**Q7 — the schedule collapses to the next few weeks with the rest behind a disclosure.** Twenty rows
on a phone is not a list anyone reads.

**Q1 — resolved, and the answer removes the blocker.** The owner's instruction on 2026-09-25:
**do not change Angel's existing loan. Leave that row exactly as it is.** They will create a new
weekly loan instead.

So there is no due-date edit, no data migration and no conversion of that row. Its live values were
confirmed against the database on 2026-09-25 and are recorded here only so nobody proposes touching
them again: ₱60,000, 2026-09-22 to 2026-10-20, four weeks, ₱16,800 interest, funded 100% by Immanuel
Rivera's own pot at 700 bps.

**Phase 7 is unblocked and its conversion flow still ships.** It was specified and confirmed as a
general capability — any existing loan can be switched to weekly collection with already-paid weeks
ticked off — and that is what gets built. What is cancelled is only the one-off use of it on
Angel's row. **No step in this plan may write to that loan**, including as a test fixture; use a
loan created for the purpose.

Note for whoever smoke-tests this: an Admin-funded loan pays its whole weekly interest as Admin
earnings with no lender share, so it exercises none of the split. Test with a lender-funded loan.

**Q6 — still open.** Whether the search screen says a line about date range reading the capital date.

### Questions / Clarifications

1. **Angel's loan does not match the spec, and conversion cannot fix that.** The live row runs
   2026-09-22 to 2026-10-20 — four weeks, ₱16,800 interest. Section 5 describes September to
   February, twenty-odd weeks, ₱84,000. Conversion builds the schedule from the dates the loan
   already has. **Confirm the order: edit the due date to the real February date first (which
   recomputes the interest and the total, correctly), then convert.** Nothing in Phase 7 should be
   implemented before this is answered.
2. **`Loan.nextDueOn` is a stored derived value.** The schema refuses those everywhere else, by
   name. It is proposed because "the earliest unpaid week" cannot be compared against an index and
   the loans list is paged by it. **Does the owner accept the exception?** The alternative is a
   correlated subquery on every page, count and dashboard aggregate, and giving up the paging work.
3. **What should the dashboard tile say?** "Earned" is currently true because interest arrives only
   on repayment. After Phase 5 the figure includes weeks collected on loans still running.
   "Interest collected" is proposed. The owner decides the words.
4. **What should "Still to collect" mean on the loans list?** Either the loan's whole total
   (unchanged, and overstated on a weekly loan by every week already in hand) or the total minus the
   weeks collected. This plan proposes the second. Step 5.4 is deliberately left unverified until the
   answer is in, because a check here would assert whichever answer the implementer picked.
5. **Should an undone weekly payment appear in Recently Deleted?** Option A (invisible, as an undone
   repayment already is) is recommended and argued in Step 7.3. Option B is a fifth section and
   should apply to both kinds of payment, as separate work.
6. **The date range and the status chip now read different columns.** Filtering "due in October" will
   not surface a weekly loan whose weeks fall in October but whose capital is due in January. That is
   the right answer to the question as asked and it is surprising. Does the search screen need a line
   saying so?
7. **Twenty rows of schedule on a phone.** Nothing in the design system has a list that long on a
   loan page. Collapse to the next few weeks with the rest behind a disclosure, or show all twenty?
8. **Reversing a conversion is not built.** Recorded as a deliberate deferral so it is not re-raised
   on every audit. CONVENTIONS.md's deferral list is currently empty; this and item 5 are candidates
   for it.
10. **What happens to weeks already collected when a weekly loan is edited?** `updateLoan` recreates
    every funding row, so the per-funder earnings change and the schedule is re-priced underneath
    payments that have already been taken. Three defensible answers: refuse the edit outright (the
    way a PAID loan is refused, and for the same stated reason), leave the collected rows at the
    amounts they were collected at (what the code does if nobody decides, and the weeks then stop
    summing to `interestCentavos`), or re-price them. **This needs an answer before Phase 3 ships**,
    and it is not covered by the shortening guard in Step 3.2.
11. **CONVENTIONS.md is not out of date, but one line is now incomplete.** "A loan's stored figures
   are never recomputed on read" stays true. "Derived on read, never stored" in the schema header
   gains an exception if item 2 is accepted, and the header should say so rather than being left to
   contradict the column beneath it.

### Issues Found

| Phase | Issue | Severity | Status |
| --- | --- | --- | --- |
| 7 | Angel's live loan is 4 weeks to October, not 20 to February. Conversion generates from the stored dates, so it cannot produce the spec's schedule. Blocks Step 7.4. | High | Open — question 1 |
| 5 | `adminStakeInLoan`'s ceiling counts earnings and cut that a weekly loan has **already paid into the pot**, so the Admin can draw the same money twice. Live on the one loan this feature was built for, which is Admin-funded. | High | Open |
| 4 | `loanState`'s parameter keeps the name `dueOn`, so the eleven call sites that must switch to `nextDueOn` are **not compile errors**. A missed site reads a weekly loan as Active for months. | High | Open |
| 3 | `markWeekPaid` uses `create`; an undone week leaves an archived row on `(loanId, weekNumber)`, so re-recording it throws. Passes every test on a clean loan. | High | Open |
| 3 | `markPaid` on a weekly loan does not refuse while earlier weeks are unpaid. The loan would settle with weeks still owed. | High | Open |
| 2 | A future `prisma migrate dev` will offer to drop `Payment_loanId_settling_key`, silently re-allowing two settling payments on one loan. Mitigation is a habit, not code. | High | Open — lesson candidate |
| 2 | **`purge.ts:114` selects `payment: { proofFiles }` on a deleted loan and maps `loan.payment?.proofFiles ?? []`.** Converted to `payments[0]` it type-checks, destroys twenty cascaded payment rows and leaves nineteen sets of **private payment screenshots orphaned in the Supabase bucket**, which is exactly the failure that file's rule 1 exists to prevent. Must be `payments.flatMap(p => p.proofFiles)`. No test covers this line. | High | Open |
| 2 | **`paymentForLoan` is `findFirst` with no week filter and no ordering.** On a weekly loan the Payment section of the loan page would show whichever row Postgres returns first — a ₱4,200 week where the settlement belongs. Identical behaviour on all four existing payments, so no test written against an AT_END loan can catch it. | High | Open |
| 3 | **`updateLoan` deletes and recreates every `LoanFunding` row**, so `earningsCentavos` and `adminCutCentavos` change on any edit. Those are exactly what the weekly schedule slices. A loan edited after six weeks were collected gets a new schedule while the six collected rows keep their old amounts, and the weeks stop summing to `interestCentavos`. The Step 3.2 guard covers only *shortening*. | High | Open — question 10 |
| 2 | Phase 2 does not leave the tree compiling on its own; Step 3.3 closes it. The only unsafe phase boundary in the plan. | Medium | Open |
| 6 | **A weekly loan page would sign up to forty proof URLs on one render.** `paymentForLoan` mints one signed link per file, and its comment's justification ("a handful of files, not a gallery") stops holding at twenty payments. The schedule should show a `missingProof` boolean per week and fetch a week's proof separately. | Medium | Open |
| 3 | `InterestCollection` is placed in `server/loans/terms.ts` by the plan's diffs. The loan form is a client component and cannot import from `src/server/`. `InterestBasis` lives in `lib/money/interest.ts` for exactly this reason; the new type should follow it. | Low | Open |
| 1, 5 | `consecutivePaidWeeks` understates a converted loan with a gap, and `interestSummary` does not — so the two disagree. Errs downwards in both directions that matter. | Medium | Open |
| 5 | `interestSummary` sums `Payment.amountCentavos`; `ledgers` sums `realisedThrough`. Two routes to the same pesos. Agree today, would diverge if an amount were ever edited. | Medium | Open — reconciliation candidate |
| 4 | `Loan.nextDueOn` can drift from `nextUnpaidWeek` and nothing detects it. | Medium | Open — reconciliation candidate |
| 5 | The Admin pot's cut tile and the loan rows under it will differ on a running weekly loan. The screen already has a pattern for printing that difference; it must be used. | Medium | Open |
| 4 | The `active` filter's interaction with a from-date changes shape. Identical on every existing loan; `tests/loans/loan-where.test.ts` is the evidence. | Low | Open |
| 6 | `LoanRow.dueOn` changes meaning without changing name. `dueIsWeekly` mitigates; a rename would be better. | Low | Open |
| 7 | The Excel Payments sheet changes row count per loan. Read me must explain it or the next backup looks like a duplication bug. | Low | Open |
| 7 | Five report kinds exist; FEATURES.md §9 lists four. Not a gap. | Low | Noted |

