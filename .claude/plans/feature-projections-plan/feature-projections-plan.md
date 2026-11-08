# Plan: Projections

## 1. Plan Overview

- **Plan Type:** feature
- **Description:** A new Projections page (menu entry + dashboard preview) that estimates future
  interest month by month. It starts from the real running loans, adds pretend loans the Admin
  describes, splits them across lenders by their last-6-months capital share, models planned
  deposits/withdrawals, warns when a lender is short of cash, draws a best-case and a realistic line,
  answers "interest in month M / running total by M / when do I reach ₱X", and saves named plans that
  can be compared on one chart. Everything is labelled as an estimate.
- **Date:** 2026-11-08

### 1.1 What was read, and what it settles

Every claim traces to a review in `references/`.

1. **A projection engine already exists: `src/lib/money/projection.ts` `projectFloating`.** It
   already knows how a real loan's money comes back: AT_END on `dueOn`, WEEKLY slice by slice via
   `weeklySlices` / `weeklyDueDates`, paid weeks skipped, and money already late kept apart and NOT
   assumed to arrive. This plan **extracts its per-row scheduling into `scheduleArrivals` and reuses
   it** for both real and pretend loans. No new interest or slice arithmetic is written.
2. **Pretend loans go through `splitLoan` (`split.ts`).** Interest, lender earnings and admin cut for
   a pretend loan are exactly what the loan form would store for the same inputs. The only new money
   arithmetic is splitting a pretend loan's *capital* across lenders by weight, which reuses
   `split.ts`'s private largest-remainder `distribute` through a new exported wrapper.
3. **"On time" already has a rule: `trackRecord` in `src/lib/track-record.ts`** — paid on or before
   the due calendar day is on time; a loan closed by an extension is neither. Section 1.3 builds on it.
4. **"Short of cash" already has a rule: `shortfalls` in `floating.ts`.** The projection's monthly
   warning calls it.
5. **There is no chart library.** `where-the-money-is.tsx` is hand-drawn SVG, server-rendered, and
   selection is a URL parameter (`?part=`). The projection chart follows the same pattern
   (`?month=`, `?view=`, `?compare=`). No dependency is added.
6. **This is Next 16.3.5.** Pages take `PageProps<'/route'>` with `params`/`searchParams` as
   promises (as in `lenders/[id]/page.tsx`); mutations are `'use server'` functions that call
   `revalidatePath` (bundled docs `01-app/01-getting-started/07-mutating-data.md`, and
   `server/pending/actions.ts`).
7. **The database could not be reached from here** (`db-ro.mjs` reports no `.env`), so no history
   figure in this plan was measured. Every historical default is computed at run time and printed with
   what it was computed from.

### 1.2 Decisions (owner answers received 2026-11-08)

**Decided by the owner:**

| Topic | Decision |
| --- | --- |
| "When do I reach ₱X" | **Both** targets, the user picks: total estimated interest from today, or pot size (cash + capital out on loan). |
| Extended loans | **Not late.** An extension through `LoanExtension` is agreed. On-time is measured against the extended due date (`Loan.dueOn`), exactly as `trackRecord` does. |
| Unpaid money | **No allowance.** The owner's history has no unpaid loans, so the realistic line models lateness only. |
| Re-lending | **Per lender, from each lender's own history:** what share of their returned money they re-lent, and how many months later. Each lender re-lends only their own cash, so one lender short of cash never stops another. Switch off = no re-lending. Too little history for a lender = a labelled default (100%, 1 month). |

**Defaulted as recommended** (owner said go with the recommendation):

| Topic | Default |
| --- | --- |
| On-time rate | Counts due amounts, not pesos. |
| Earliest re-lend | Pretend loans start on the 1st, so money back in month M is re-lent in M+1 at the earliest. A measured lag of 0 is treated as 1. |
| FIXED_AMOUNT history | Counted in the lender split, the on-time rate and the re-lend habits. Left out of the default rate (it has none). |
| Pretend loans | Always WEEKLY_RATE, whole weeks. |
| Admin-cut view | The cut only. The Admin's earnings on its own money are under "per lender → Admin". |
| Lender split | Frozen at today's 6-month history for the whole horizon. |
| Backup / demo seed | Saved plans are left out of the backup export and the demo seed for now (Follow Up). |
| Manual SQL file | Keep writing a `prisma/manual/` paste file, as the older migrations do. |

**Other fixed choices:**

| Topic | Decision |
| --- | --- |
| Time step | Calendar months, starting with the current month. Pretend loans start on the 1st of each month from **next** month. |
| Horizon | 24 months by default, 1–60 allowed. |
| Default rate / cut / collection | The most common value (not the average) over WEEKLY_RATE loans started in the last 6 months; falls back to 7% / 2% / AT_END. |
| Lender split | Each lender's share of `LoanFunding.principalCentavos` on non-deleted loans started in the last 6 months (continuation loans excluded: they moved no new capital). |
| Re-lend loans | One single-funder pretend loan per lender per month, sized to what that lender re-lends that month (if at least ₱1,000), at the plan's term, rate and cut. Capped by the lender's cash, so it never causes a warning. |
| Realistic line | Each arrival is split: `floor(amount × onTimeBps / 10000)` arrives on its date, the rest arrives `lateDelayDays` later. Nothing is lost and nothing is assumed unpaid. Money already overdue today is left out of both lines and shown apart. |
| Saved plans | Two new tables, inputs only, real delete (like `LoanNote`). |

### 1.3 "On time", defined

A **scheduled amount** is one due date on a non-deleted loan: the `dueOn` of an AT_END loan, or each
week date of a WEEKLY loan (`weeklyDueDates`), with the last week on `dueOn`. It counts when its due
date falls in the **last 6 months before today**.

It is **on time** when a live (`deletedAt` null) `Payment` covers it — the settling row (`weekNumber`
null) for the capital/last week, the row with that `weekNumber` for a week — and that payment's
`paidOn` calendar day is **on or before** the due calendar day. Paying on the due day is on time, as in
`trackRecord`.

It is **not on time** when it was paid later, or is still unpaid after its due date.

`onTimeBps = floor(10000 × onTime / counted)`.

Why:
- It measures what the realistic line needs — *did the money arrive on the day it was planned* — at
  the same grain the projection schedules money (per week for weekly loans).
- **The due date is `Loan.dueOn`, which an extension moves** (owner, 2026-11-08: an extension is
  agreed, not late). That's the same date `trackRecord` uses, so "on time" means one thing everywhere
  in the app. A loan extended from 4 to 8 weeks and paid at week 8 is on time.
- A loan closed by an extension (interest paid, capital carried on as a new loan) isn't counted, as
  in `trackRecord`. The continuation loan is counted instead.
- A still-unpaid amount past its due date counts as not on time. The owner's history has none today,
  so this only matters if one appears.
- It counts amounts, not pesos (default).

### 1.4 Re-lending habits, defined

For each lender, over the same 6-month window:

- **Returned** in month M = what live payments in M handed back to that lender's pot: capital plus own
  earnings, plus the Admin cut on the Admin's pot. Each payment's share is found with
  `scheduleArrivals` (a weekly row is that week's slice; the settling row is the capital plus the last
  slice), so it uses the same arithmetic as the projection.
- **Lent** in month M = that lender's `principalCentavos` on loans started in M, continuation loans
  excluded.
- **Re-lend share** = `min(100%, total lent / total returned)`, counting only lending from the first
  month with a return onward.
- **Lag** = the median, over months with a return, of months until that lender next lent anything
  (0 if the same month). The engine uses `max(1, lag)` (see 1.2).
- **Too thin:** fewer than 2 months with a return. Then the default is share 100%, lag 1, and the page
  says "default — not enough history for {lender}".

**Known limitation, written into the code:** lending paid for by fresh deposits looks like
re-lending, so the share is an upper bound. Deposits can't be subtracted reliably: the schema notes
that deposit rows on this account were entered loan by loan after the fact (`Lender.startingCapital`
comment).

## 2. Comprehensive Plan by Phases

### Phase 1: Shared arithmetic groundwork

Three small additions to existing domain files, so the engine has nothing new to invent.

#### Step 1.1: Month and basis-point helpers

**File:** `src/lib/money/weeks.ts`, `src/lib/money/centavos.ts`
**Verify:** `npm run typecheck`

Add `firstOfMonth(date, offset)` (local midday) beside `addDays`, and `bpsOf(amount, bps)` (the one
floor used for scaling) beside `checkedProduct`.

`src/lib/money/weeks.ts`, directly after `addDays`:

```diff
 /** Add whole days to a date, keeping it a calendar date — at midday, as above. */
 export function addDays(date: Date, days: number): Date {
   return calendarDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
 }
+
+/**
+ * The 1st of the month `offset` months after `date`'s month, at local midday.
+ *
+ * Always the 1st, so the constructor's roll-over (31 January + 1 month = 3 March)
+ * cannot happen: day 1 exists in every month. Used by the Projections engine,
+ * whose time step is a calendar month.
+ */
+export function firstOfMonth(date: Date, offset = 0): Date {
+  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12)
+}
+
+/** "2027-01" for the month containing `date` — the key a month is looked up by. */
+export function monthKey(date: Date): string {
+  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
+}
```

`src/lib/money/centavos.ts`, directly after `checkedProduct`:

```diff
   return product
 }
+
+/**
+ * `bps` basis points of an amount, rounded DOWN to a whole centavo.
+ *
+ * Down, never half-up: the caller always takes the rest as `amount - bpsOf(...)`,
+ * so the two parts sum to the amount exactly and nothing is dropped. This is the
+ * one place the Projections estimate scales money by a rate.
+ */
+export function bpsOf(amount: Centavos, bps: BasisPoints): Centavos {
+  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
+    throw new Error(`A share must be 0..${BPS_DENOMINATOR} basis points, got ${bps}`)
+  }
+  return centavos(Math.floor(checkedProduct(amount, bps) / BPS_DENOMINATOR))
+}
```

#### Step 1.2: Export a capital-by-weight split

**File:** `src/lib/money/split.ts`

Add `splitByWeight` over the existing private `distribute`, so a pretend loan's capital is split with
the same largest-remainder rule as everything else.

Insert after `distribute` (before `const ADMIN_SHARE_KEY`):

```diff
   return result
 }
+
+/** Parts per million: the scale a weight is reduced to before it splits money. */
+const PPM = 1_000_000
+
+/**
+ * Split `total` in proportion to `weights`, losing no centavo.
+ *
+ * For the Projections estimate: a pretend loan's capital split across lenders by
+ * how much capital each put into real loans lately. TWO passes of the same
+ * largest-remainder rule, because a weight is itself a sum of centavos and
+ * weight x total can pass Number.MAX_SAFE_INTEGER. The weights are first turned
+ * into parts per million that sum to exactly 1,000,000, then the money is split
+ * by those. The consequence is deliberate: a share is exact to a millionth, not
+ * to the centavo of the history it came from.
+ *
+ * Zero weights are allowed and get zero. Keys keep their input order, which is
+ * how ties break, so the same inputs always split the same way.
+ */
+export function splitByWeight(total: Centavos, weights: { key: string; weight: number }[]): Map<string, Centavos> {
+  const sum = weights.reduce((acc, w) => acc + w.weight, 0)
+  if (weights.some((w) => !Number.isInteger(w.weight) || w.weight < 0) || sum <= 0) {
+    throw new Error('splitByWeight needs non-negative whole weights with a positive sum.')
+  }
+  const ppm = distribute(
+    weights.map((w) => ({ key: w.key, numerator: checkedProduct(w.weight, PPM) })),
+    centavos(PPM),
+    sum,
+  )
+  return distribute(
+    weights.map((w) => ({ key: w.key, numerator: checkedProduct(ppm.get(w.key) as number, total) })),
+    total,
+    PPM,
+  )
+}
 
 const ADMIN_SHARE_KEY = '\u0000admin'
```

#### Step 1.3: Extract `scheduleArrivals` from `projectFloating`

**File:** `src/lib/money/projection.ts`

Move the per-row "when does this row's money come back" logic into an exported function that
`projectFloating` calls. No change in behaviour.

```diff
 export type Projection = {
   ...
 }
+
+/** The fields of a row that decide WHEN its money comes back. */
+export type ScheduledRow = Pick<
+  ProjectedRow,
+  'interestCollection' | 'startOn' | 'dueOn' | 'termDays' | 'principal' | 'earnings' | 'adminCut' | 'paidWeeks'
+>
+
+export type RowArrival = { on: Date; capital: Centavos; interest: Centavos; adminCut: Centavos; final: boolean }
+
+/**
+ * Every day this row still has money coming back, in date order — the ONE
+ * place that says how a loan returns its money, for projectFloating and for
+ * the Projections estimate (lib/money/forecast.ts) alike.
+ *
+ * AT_END: one arrival on dueOn with everything. WEEKLY: one per unpaid week,
+ * slices from weeklySlices, capital with the last week. Paid weeks are skipped.
+ * It does NOT look at today: deciding what is already late is the caller's job.
+ */
+export function scheduleArrivals(row: ScheduledRow): RowArrival[] {
+  if (row.interestCollection !== 'WEEKLY') {
+    return [{ on: row.dueOn, capital: row.principal, interest: row.earnings, adminCut: row.adminCut, final: true }]
+  }
+  const weeks = row.termDays / DAYS_PER_WEEK
+  const earnings = weeklySlices(row.earnings, weeks)
+  const cuts = weeklySlices(row.adminCut, weeks)
+  const out: RowArrival[] = []
+  weeklyDueDates(row.startOn, weeks).forEach((on, index) => {
+    const week = index + 1
+    if (row.paidWeeks.has(week)) return
+    const last = week === weeks
+    out.push({ on, capital: last ? row.principal : centavos(0), interest: earnings[index], adminCut: cuts[index], final: last })
+  })
+  return out
+}
 
 export function projectFloating(
@@
-  for (const row of rows) {
-    if (row.interestCollection === 'WEEKLY') {
-      const weeks = row.termDays / DAYS_PER_WEEK
-      const earnings = weeklySlices(row.earnings, weeks)
-      const cuts = weeklySlices(row.adminCut, weeks)
-      weeklyDueDates(row.startOn, weeks).forEach((day, index) => {
-        const week = index + 1
-        if (row.paidWeeks.has(week)) return
-        const last = week === weeks
-        add(row, day, last ? row.principal : 0, earnings[index], cuts[index], last)
-      })
-    } else {
-      add(row, row.dueOn, row.principal, row.earnings, row.adminCut, true)
-    }
-  }
+  for (const row of rows) {
+    for (const a of scheduleArrivals(row)) add(row, a.on, a.capital, a.interest, a.adminCut, a.final)
+  }
```

#### Step 1.4: Tests for the helpers and the extraction

**File:** `tests/money/split.test.ts`, `tests/money/weeks.test.ts`, `tests/money/projection.test.ts`
**Verify:** `npm run verify`

The existing projection tests must pass unchanged; add tests for the three new exports.

Append to `tests/money/split.test.ts` (add `splitByWeight` to its existing import from
`../../src/lib/money/split.ts`):

```diff
+test('splitByWeight sums to the total exactly, even when weights do not divide it', () => {
+  for (const total of [1, 7, 99_999, 3_000_000, 2_147_483_647]) {
+    const parts = splitByWeight(centavos(total), [
+      { key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 },
+    ])
+    assert.equal([...parts.values()].reduce((s, v) => s + v, 0), total)
+  }
+})
+
+test('splitByWeight survives weights whose product with the total passes MAX_SAFE_INTEGER', () => {
+  const parts = splitByWeight(centavos(2_000_000_000), [
+    { key: 'a', weight: 9_000_000_000 }, { key: 'b', weight: 3_000_000_000 },
+  ])
+  assert.equal(parts.get('a'), 1_500_000_000)
+  assert.equal(parts.get('b'), 500_000_000)
+})
+
+test('splitByWeight gives a zero weight nothing and refuses an all-zero set', () => {
+  const parts = splitByWeight(centavos(1_000), [{ key: 'a', weight: 0 }, { key: 'b', weight: 5 }])
+  assert.equal(parts.get('a'), 0)
+  assert.equal(parts.get('b'), 1_000)
+  assert.throws(() => splitByWeight(centavos(1_000), [{ key: 'a', weight: 0 }]))
+})
```

Append to `tests/money/weeks.test.ts` (import `firstOfMonth`, `monthKey`):

```diff
+test('firstOfMonth is the 1st at midday and never rolls over', () => {
+  const jan31 = new Date(2027, 0, 31, 12)
+  assert.deepEqual(firstOfMonth(jan31, 1), new Date(2027, 1, 1, 12))
+  assert.deepEqual(firstOfMonth(jan31, 12), new Date(2028, 0, 1, 12))
+  assert.equal(monthKey(firstOfMonth(jan31, -1)), '2026-12')
+})
```

Append to `tests/money/centavos.test.ts` (import `bpsOf`) — the fourth test file this step touches:

```diff
+test('bpsOf rounds down, so amount - bpsOf(amount) is the exact rest', () => {
+  assert.equal(bpsOf(centavos(999), 5_000), 499)
+  assert.equal(bpsOf(centavos(999), 10_000), 999)
+  assert.equal(bpsOf(centavos(999), 0), 0)
+  assert.throws(() => bpsOf(centavos(1), 10_001))
+})
```

Append to `tests/money/projection.test.ts` (import `scheduleArrivals`):

```diff
+test('scheduleArrivals: a weekly row returns one arrival per unpaid week, capital with the last', () => {
+  const row = atEnd(day(10, 19), { interestCollection: 'WEEKLY', termDays: 28, earnings: centavos(400_003), paidWeeks: new Set([1]) })
+  const a = scheduleArrivals(row)
+  assert.equal(a.length, 3)
+  assert.equal(a.filter((x) => x.capital > 0).length, 1)
+  assert.equal(a[2].final, true)
+  // weeks 2..4 of the four slices: everything but week 1
+  assert.equal(a.reduce((s, x) => s + x.interest, 0), 400_003 - 100_000)
+})
```

#### Phase 1 — Potential Issues

- **Behaviour change risk in `projectFloating`.** The extraction must keep argument order and the
  `add` zero-skip. The existing `tests/money/projection.test.ts` is the guard; if any of its tests
  change to pass, the extraction is wrong.
- **`weeklySlices` floor values.** The week-1 figure `100_000` in the new projection test assumes
  `weeklySlices(400_003, 4)` is `[100_000, 100_000, 100_000, 100_003]` per the Phase 1 rule recorded
  in the weekly-interest plan (`floor × (n-1)`, remainder on the last). Confirm against
  `tests/money/weekly.test.ts` when writing it.
- **New export from `split.ts`.** `splitByWeight` is new surface on the file `CONVENTIONS.md` calls
  the reference. It adds no rule — it calls `distribute` twice — but it's a new pattern: rounding a
  weight to parts per million. The written reason is overflow (weights are sums of centavos).
- **`firstOfMonth` / `monthKey`** are local-time helpers. Never pass them a raw `@db.Date` value; go
  through `storedCalendarDate` first (CONVENTIONS.md, read-side date trap).

**Issues identified:** extraction must be behaviour-identical; the ppm rounding is a new, flagged
pattern.

### Phase 2: Historical inputs (pure)

#### Step 2.1: `forecast-history.ts`

**File:** `src/lib/money/forecast-history.ts`
**Verify:** `npm run typecheck`

Pure functions: `capitalShares`, `onTimeRate`, `lateDelayDays`, `historyDefaults`, and the
per-lender re-lending habits `returnEvents` / `relendHabits` (plan §1.4).

New file. No database, no React. Every date in is a calendar date at local midday (the server
converts `@db.Date` columns with `storedCalendarDate` before calling).

```ts
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
```

#### Step 2.2: Tests for the history functions

**File:** `tests/money/forecast-history.test.ts`
**Verify:** `npm run verify`

New file, same shape as `tests/money/projection.test.ts` (`node:test`, `assert/strict`, `.ts` imports,
dates at local midday).

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import {
  type HistoryLoan,
  capitalShares,
  dueRecords,
  historyDefaults,
  lateDelayDays,
  onTimeRate,
  relendHabits,
  returnEvents,
} from '../../src/lib/money/forecast-history.ts'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const today = day(2026, 11, 8) // window starts 1 May 2026

test('capitalShares: only the window, only current lenders, summed per lender', () => {
  const rows = [
    { lenderId: 'a', principal: centavos(100), startOn: day(2026, 5, 1) },
    { lenderId: 'a', principal: centavos(50), startOn: day(2026, 10, 1) },
    { lenderId: 'b', principal: centavos(300), startOn: day(2026, 4, 30) }, // before window
    { lenderId: 'gone', principal: centavos(999), startOn: day(2026, 9, 1) }, // deleted lender
  ]
  assert.deepEqual(capitalShares(rows, today, new Set(['a', 'b'])), [{ lenderId: 'a', weight: 150 }])
})

const loan = (extra: Partial<HistoryLoan>): HistoryLoan => ({
  interestCollection: 'AT_END',
  startOn: day(2026, 9, 1),
  dueOn: day(2026, 9, 29),
  termDays: 28,
  settledOn: null,
  weekPaidOn: new Map(),
  closedByExtension: false,
  ...extra,
})

test('on the due day is on time; the day after is not; unpaid and past due is not', () => {
  const records = [
    ...dueRecords(loan({ settledOn: day(2026, 9, 29) })),
    ...dueRecords(loan({ settledOn: day(2026, 9, 30) })),
    ...dueRecords(loan({})),
  ]
  const r = onTimeRate(records, today)
  assert.equal(r.counted, 3)
  assert.equal(r.onTime, 1)
  assert.equal(r.bps, 3_333)
})

test('an extended loan is on time when paid by its EXTENDED due date (owner, 2026-11-08)', () => {
  // 4 weeks + another 4: dueOn has moved from 29 Sep to 27 Oct; paid 27 Oct.
  const extended = loan({ dueOn: day(2026, 10, 27), termDays: 56, settledOn: day(2026, 10, 27) })
  assert.equal(onTimeRate(dueRecords(extended), today).onTime, 1)
})

test('a loan closed by an extension is not counted at all', () => {
  assert.deepEqual(dueRecords(loan({ closedByExtension: true })), [])
})

test('a weekly loan counts every week, the last on the settling payment', () => {
  const weekly = loan({
    interestCollection: 'WEEKLY',
    weekPaidOn: new Map([[1, day(2026, 9, 8)], [2, day(2026, 9, 16)], [3, day(2026, 9, 22)]]),
    settledOn: day(2026, 9, 29),
  })
  const r = onTimeRate(dueRecords(weekly), today)
  assert.equal(r.counted, 4)
  assert.equal(r.onTime, 3) // week 2 was due 15 Sep, paid 16 Sep
})

test('due today is not counted yet, and nothing due gives a null rate', () => {
  assert.equal(onTimeRate([{ dueOn: today, paidOn: null }], today).bps, null)
})

test('lateDelayDays is the median lateness of late PAID amounts', () => {
  const recs = [
    { dueOn: day(2026, 9, 1), paidOn: day(2026, 9, 3) },
    { dueOn: day(2026, 9, 1), paidOn: day(2026, 9, 11) },
    { dueOn: day(2026, 9, 1), paidOn: day(2026, 9, 6) },
    { dueOn: day(2026, 9, 1), paidOn: null },
  ]
  assert.equal(lateDelayDays(recs, today), 5)
  assert.equal(lateDelayDays([], today), null)
})

test('historyDefaults takes the most common rate, ignores FIXED_AMOUNT, and falls back', () => {
  const l = (startOn: Date, rate: number | null, basis: 'WEEKLY_RATE' | 'FIXED_AMOUNT' = 'WEEKLY_RATE') => ({
    startOn, interestBasis: basis, interestCollection: 'WEEKLY' as const, borrowerRateBps: rate, cutBps: rate ? [200] : [],
  })
  const d = historyDefaults(
    [l(day(2026, 6, 1), 700), l(day(2026, 7, 1), 700), l(day(2026, 8, 1), 600), l(day(2026, 9, 1), null, 'FIXED_AMOUNT')],
    today,
    { borrowerRateBps: 700, adminCutBps: 200 },
  )
  assert.equal(d.borrowerRateBps, 700)
  assert.equal(d.collection, 'WEEKLY')
  assert.equal(d.basedOn, 3)
  assert.equal(historyDefaults([], today, { borrowerRateBps: 700, adminCutBps: 200 }).basedOn, 0)
})

test('returnEvents: a settled loan hands back capital + earnings to the funder and the cut to the Admin', () => {
  const row = {
    lenderId: 'john', interestCollection: 'AT_END' as const, startOn: day(2026, 9, 1), dueOn: day(2026, 9, 29),
    termDays: 28, principal: centavos(3_000_000), earnings: centavos(600_000), adminCut: centavos(240_000), paidWeeks: new Set<number>(),
  }
  const events = returnEvents({ rows: [row], payments: [{ weekNumber: null, paidOn: day(2026, 9, 29) }], closedByExtension: false }, 'admin')
  assert.deepEqual(events.map((e) => [e.lenderId, e.amount]), [['john', 3_600_000], ['admin', 240_000]])
  const closed = returnEvents({ rows: [row], payments: [{ weekNumber: null, paidOn: day(2026, 9, 29) }], closedByExtension: true }, 'admin')
  assert.equal(closed[0].amount, 600_000) // interest only: the capital carried on
})

test('relendHabits: share and lag from a lender\'s own history', () => {
  const r = (m: number, amount: number) => ({ lenderId: 'a', on: day(2026, m, 10), amount: centavos(amount) })
  const l = (m: number, principal: number) => ({ lenderId: 'a', on: day(2026, m, 1), principal: centavos(principal) })
  const h = relendHabits([r(6, 100_000), r(8, 100_000)], [l(7, 50_000), l(9, 50_000)], today, ['a']).get('a')
  assert.deepEqual(h, { shareBps: 5_000, lagMonths: 1, basis: 'history', returnMonths: 2 })
})

test('relendHabits: thin history falls back to the labelled default; never re-lending is share 0', () => {
  const r = (m: number) => ({ lenderId: 'a', on: day(2026, m, 10), amount: centavos(100_000) })
  assert.equal(relendHabits([r(6)], [], today, ['a']).get('a')?.basis, 'default')
  assert.equal(relendHabits([r(6), r(8)], [], today, ['a']).get('a')?.shareBps, 0)
})
```

#### Phase 2 — Potential Issues

- **FIXED_AMOUNT in history.** Counted in the lender split, the on-time rate and the re-lend habits.
  Left out of the rate/collection defaults (no rate exists). Owner default, 2026-11-08.
- **Re-lend share is an upper bound** (plan §1.4): lending paid for by a deposit looks like
  re-lending. The page must label it "up to N% re-lent". Before shipping, someone with database access
  should compare it with the lender's deposit rows for one or two lenders (Phase 7 checks).
- **`returnEvents` assumes a payment matches the stored schedule.** That holds by schema: a payment's
  amount is "never typed, always read from the loan". An extension that "added interest to the same
  loan" updates the stored earnings, so the settling arrival already includes it.
- **`forecast-history.ts` now imports `projection.ts`** (for `scheduleArrivals`). Both are domain
  files, so the dependency direction is unchanged.
- **Advances (`LenderTransaction.loanId`)** have no effect here. They are withdrawals against a
  loan, already in today's floating figure. The estimate does not predict future advances. Flagged.
- **Too little history.** With few loans in the window, `bps` and `lateDelayDays` are noisy, and the
  page must print `counted` beside the rate. When `bps` is null the realistic line is not drawn (it
  is not set equal to the best case — that would make it look like a measurement).
- **Payment undo.** Only live payments (`deletedAt: null`) may be passed in as `settledOn` /
  `weekPaidOn`. That filter is the server's job in Phase 5 and must not be forgotten (label-truth
  trap: an undone payment reads as paid).
- **Demo vs real account.** Every input is scoped by `userId` in Phase 5. This file never sees it.
- No new pattern: pure domain functions with a test file mirroring `src/lib/money/`.

**Issues identified:** realistic line hidden when there is no history; the re-lend share errs high and
is labelled as "up to".

### Phase 3: The forecast engine (pure)

#### Step 3.1: Types and the monthly simulation

**File:** `src/lib/money/forecast.ts`
**Verify:** `npm run typecheck`

`simulate(input, scenario)` runs every lender's pot month by month for one scenario.

**Order inside a month**, chosen to match the dates (everything planned happens on the 1st):
1. planned deposits / withdrawals for the month;
2. planned pretend loans (from month 1 on), funded from cash *at that moment*, with a shortfall check;
3. re-lend loans, if on: **each lender separately**, from their own queue (below), capped by their
   own cash;
4. money coming back during the month (real and pretend), added to cash. If re-lend is on, each
   lender's `shareBps` of it joins their queue for month `m + max(1, lagMonths)` (plan §1.4).

A re-lend loan is one **single-funder** pretend loan for that lender, sized to what they re-lend that
month, at the plan's term, rate and cut, priced by `splitLoan` like any other. Less than
`MIN_RELEND_CENTAVOS` (₱1,000) waits in the queue for the next month instead of becoming a trickle loan.
What the cash cap holds back also waits. Nothing in the queue is lost: it's cash the whole time,
earmarked.

So money that comes back in March is re-lent on 1 April at the earliest (owner default).

```ts
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
```

#### Step 3.2: Views, month lookup and "when do I reach ₱X"

**File:** `src/lib/money/forecast.ts`

`forecastView`, `monthOf`, `reachTarget` read the simulation for admin cut / one lender / whole pot.

Appended to the same file:

```ts
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
```

#### Step 3.3: Engine tests, including reconciliation

**File:** `tests/money/forecast.test.ts`
**Verify:** `npm run verify`

The reconciliation tests are the ones that matter, as in `split.test.ts`: money in equals money out.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { type ForecastInput, type Plan, forecastView, reachTarget, simulate } from '../../src/lib/money/forecast.ts'
import { splitLoan } from '../../src/lib/money/split.ts'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const today = day(2026, 11, 8)

const plan = (extra: Partial<Plan> = {}): Plan => ({
  horizonMonths: 12,
  newLoansPerMonth: 0,
  loanAmount: centavos(1_000_000),
  termWeeks: 4,
  borrowerRateBps: 700,
  adminCutBps: 200,
  collection: 'AT_END',
  relend: false,
  moves: [],
  ...extra,
})

const input = (extra: Partial<ForecastInput> = {}): ForecastInput => ({
  today,
  plan: plan(),
  lenders: [
    { id: 'admin', isSelf: true, floatingNow: centavos(0) },
    { id: 'john', isSelf: false, floatingNow: centavos(10_000_000) },
  ],
  realRows: [],
  shares: [{ lenderId: 'john', weight: centavos(3) }, { lenderId: 'admin', weight: centavos(1) }],
  habits: new Map(), // every lender on DEFAULT_RELEND unless a test says otherwise
  ...extra,
})

const real = {
  lenderId: 'john',
  interestCollection: 'AT_END' as const,
  startOn: day(2026, 11, 1),
  dueOn: day(2026, 11, 29),
  termDays: 28,
  principal: centavos(3_000_000),
  earnings: centavos(600_000),
  adminCut: centavos(240_000),
  paidWeeks: new Set<number>(),
}

test('real loans only: the pot view adds up to the stored earnings plus the cut, in the due month', () => {
  const sim = simulate(input({ realRows: [real] }), { kind: 'best' })
  const pot = forecastView(sim, { kind: 'pot' })
  assert.equal(pot[0].interest, 840_000)
  assert.equal(pot.at(-1)?.interestToDate, 840_000)
  assert.equal(forecastView(sim, { kind: 'admin-cut' })[0].interest, 240_000)
  assert.equal(forecastView(sim, { kind: 'lender', lenderId: 'john' })[0].interest, 600_000)
})

test('money already late is left out of the lines and reported apart', () => {
  const late = { ...real, dueOn: day(2026, 11, 1) }
  const sim = simulate(input({ realRows: [late] }), { kind: 'best' })
  assert.equal(sim.lateNow, 3_840_000)
  assert.equal(forecastView(sim, { kind: 'pot' }).at(-1)?.interestToDate, 0)
})

test('a pretend loan earns exactly what splitLoan says, split by the 6-month shares', () => {
  const sim = simulate(input({ plan: plan({ newLoansPerMonth: 1, horizonMonths: 3 }) }), { kind: 'best' })
  // made 1 Dec, due 29 Dec: ₱7,500 John at 5%, ₱2,500 Admin at 7%, 4 weeks
  const expected = splitLoan({
    capital: centavos(1_000_000), borrowerRateBps: 700, weeks: 4,
    fundings: [
      { lenderId: 'john', principal: centavos(750_000), lenderRateBps: 500, adminCutBps: 200 },
      { lenderId: 'admin', principal: centavos(250_000), lenderRateBps: 700, adminCutBps: 0 },
    ],
  })
  assert.ok(expected.ok)
  assert.equal(forecastView(sim, { kind: 'pot' })[1].interest, expected.value.totalInterest)
})

test('reconciliation: realistic moves money later but never loses a centavo', () => {
  const i = input({ realRows: [real] })
  const best = forecastView(simulate(i, { kind: 'best' }), { kind: 'pot' })
  const late = forecastView(simulate(i, { kind: 'realistic', onTimeBps: 7_333, lateDelayDays: 10 }), { kind: 'pot' })
  assert.ok(late[0].interest < best[0].interest) // part of 29 Nov slips to 9 Dec
  assert.equal(late.at(-1)?.interestToDate, best.at(-1)?.interestToDate) // but all of it lands
})

test('reconciliation: with no delay the realistic line IS the best case, pretend loans included', () => {
  const i = input({ realRows: [real], plan: plan({ newLoansPerMonth: 3, relend: true, horizonMonths: 24 }) })
  const best = forecastView(simulate(i, { kind: 'best' }), { kind: 'pot' })
  const same = forecastView(simulate(i, { kind: 'realistic', onTimeBps: 6_123, lateDelayDays: 0 }), { kind: 'pot' })
  assert.deepEqual(same.map((m) => m.interest), best.map((m) => m.interest))
})

test('a lender short of cash for their share is warned in that month, and the loan is still projected', () => {
  const poor = input({
    lenders: [{ id: 'admin', isSelf: true, floatingNow: centavos(0) }, { id: 'john', isSelf: false, floatingNow: centavos(0) }],
    plan: plan({ newLoansPerMonth: 1, horizonMonths: 3 }),
  })
  const sim = simulate(poor, { kind: 'best' })
  assert.deepEqual(sim.months[1].warnings.map((w) => [w.lenderId, w.cause]).sort(), [['admin', 'loans'], ['john', 'loans']])
  assert.ok(forecastView(sim, { kind: 'pot' })[1].interest > 0)
  assert.ok((sim.months[1].byLender.get('john')?.cash as number) < 0)
})

// John re-lends half of what comes back, a month later; the Admin has no history (default 100%, 1 month).
const habits = new Map([['john', { shareBps: 5_000, lagMonths: 1, basis: 'history' as const, returnMonths: 3 }]])

test('re-lending follows each lender\'s own habit', () => {
  const sim = simulate(input({ realRows: [real], habits, plan: plan({ relend: true }) }), { kind: 'best' })
  // 29 Nov: John gets ₱36,000 back, the Admin its ₱2,400 cut. Re-lent on 1 Dec:
  assert.equal(sim.months[1].byLender.get('john')?.lent, 1_800_000) // half
  assert.equal(sim.months[1].byLender.get('admin')?.lent, 240_000) // all of it, by default
  assert.equal(sim.months[1].relent, 2_040_000)
})

test('one lender short of cash does not stop another re-lending', () => {
  const moves = [{ lenderId: 'admin', type: 'WITHDRAWAL' as const, amount: centavos(240_000), fromMonth: day(2026, 12, 1), everyMonth: false, untilMonth: null }]
  const sim = simulate(input({ realRows: [real], habits, plan: plan({ relend: true, moves }) }), { kind: 'best' })
  assert.equal(sim.months[1].byLender.get('admin')?.lent, 0) // took it out instead
  assert.equal(sim.months[1].byLender.get('john')?.lent, 1_800_000) // unaffected
})

test('re-lending never creates a warning by itself, and never goes below a lender\'s cash', () => {
  const sim = simulate(input({ realRows: [real], habits, plan: plan({ relend: true, horizonMonths: 24 }) }), { kind: 'best' })
  assert.ok(sim.months.every((m) => m.warnings.length === 0))
  assert.ok(sim.months.every((m) => [...m.byLender.values()].every((r) => r.cash >= 0)))
  assert.ok(sim.months.some((m) => m.relent > 0))
})

test('re-lend off: returned money sits as cash', () => {
  const sim = simulate(input({ realRows: [real] }), { kind: 'best' })
  assert.equal(sim.months[1].byLender.get('john')?.cash, 10_000_000 + 3_600_000)
  assert.equal(sim.months[1].byLender.get('admin')?.cash, 240_000)
})

test('planned moves: monthly deposits add up; an over-withdrawal warns', () => {
  const moves = [
    { lenderId: 'john', type: 'DEPOSIT' as const, amount: centavos(1_000_000), fromMonth: day(2026, 12, 1), everyMonth: true, untilMonth: day(2027, 2, 1) },
    { lenderId: 'admin', type: 'WITHDRAWAL' as const, amount: centavos(500), fromMonth: day(2027, 3, 1), everyMonth: false, untilMonth: null },
  ]
  const sim = simulate(input({ plan: plan({ moves }) }), { kind: 'best' })
  assert.equal(sim.months[4].byLender.get('john')?.cash, 10_000_000 + 3 * 1_000_000)
  assert.equal(sim.months[4].warnings[0]?.cause, 'withdrawal')
})

test('no history to split by: pretend loans are refused, real loans still projected', () => {
  const sim = simulate(input({ shares: [], realRows: [real], plan: plan({ newLoansPerMonth: 1 }) }), { kind: 'best' })
  assert.match(sim.refused ?? '', /nothing to split/)
  assert.equal(forecastView(sim, { kind: 'pot' })[0].interest, 840_000)
})

test('reachTarget on interest: the first month the running total gets there, or null', () => {
  const pot = forecastView(simulate(input({ realRows: [real] }), { kind: 'best' }), { kind: 'pot' })
  assert.equal(reachTarget(pot, centavos(840_000), 'interest')?.key, '2026-11')
  assert.equal(reachTarget(pot, centavos(840_001), 'interest'), null)
})

test('reachTarget on pot size: cash + capital out, never on the Admin-cut view', () => {
  const sim = simulate(input({ realRows: [real] }), { kind: 'best' })
  const pot = forecastView(sim, { kind: 'pot' })
  // John ₱100,000 + ₱36,000 back, Admin ₱2,400: ₱138,400 at the end of November
  assert.equal(pot[0].potSize, 13_840_000)
  assert.equal(reachTarget(pot, centavos(13_840_000), 'pot')?.key, '2026-11')
  assert.equal(reachTarget(forecastView(sim, { kind: 'admin-cut' }), centavos(1), 'pot'), null)
})
```

#### Phase 3 — Potential Issues

- **Arithmetic check on the pretend-loan test.** 3:1 shares of ₱10,000 → ₱7,500 / ₱2,500. John at
  5% × 4 weeks = ₱1,500, Admin at 7% = ₱700, cut 2% on John = ₱600; total ₱2,800 = 10,000 × 7% × 4. ✓
- **Re-lending is per lender (owner, 2026-11-08).** Each lender's re-lend loan is funded by them
  alone, so one lender short of cash never holds back another (test above). That changes who funds a
  re-lent loan compared with the 6-month split: a re-lend loan is 100% that lender's. That's intended,
  since it's that lender's own returned money.
- **The queue never exceeds what came back, and is never spent past a lender's cash**, so re-lending
  can't create a warning or push cash below zero (test). A planned withdrawal that empties a lender's
  cash leaves their queue waiting. It isn't dropped: it re-lends when cash returns.
- **`MIN_RELEND_CENTAVOS` (₱1,000)** is a new constant with no source in history. It stops a lender's
  ₱12 weekly slice becoming its own loan. Smaller amounts wait in the queue.
- **Why the reconciliation tests look like this.** With a delay, some late money always sits one
  month behind. So a running total only matches the best case once everything has landed, which is
  why the test uses real rows only. The delay-0 test proves the split itself loses nothing, pretend
  loans and re-lending included.
- **Shares and re-lend habits are frozen at today's history** for the whole horizon (owner default).
- **At least one month of lag** for returned money (event order above): a measured lag of 0 is
  treated as 1 (owner default).
- **Realistic line rounding.** `bpsOf` floors each of capital / interest / cut once per arrival, and
  the late part is the exact rest. So no centavo is dropped (reconciliation test). Individual months
  can differ from a "true" expected value by under one centavo per arrival. That's acceptable for an
  estimate and stated in the code.
- **No allowance for unpaid money (owner, 2026-11-08).** The realistic line only moves late money
  later. It never assumes money is never paid, because the owner's history has no unpaid loans.
- **Performance.** At worst 60 months × (50 + re-lent) loans: each month's template is split once
  and multiplied by the count. Scheduling is one `scheduleArrivals` call per funder per month,
  ≤ 52 entries. So roughly 60 × lenders × 52 arrivals per scenario, × 2 scenarios × up to 4 compared
  plans — well under a millisecond-scale concern. `checkedProduct` guards the multiplication; a
  plan large enough to pass 2^53 centavos throws. The page catches that and shows "plan too large".
- **`Centavos` can be negative here** (`cash`). `centavos()` only checks whole numbers, so this is
  allowed — the same as `lenderPosition.floating`.
- **New pattern:** none beyond `bpsOf`. Event order and the realistic scenario are new *rules*, and
  they live in one file with tests.

**Issues identified:** `MIN_RELEND_CENTAVOS` is a judgement call, not measured; everything else
follows owner decisions.

### Phase 4: Saved plans — schema and migration

Two tables, not one plus a JSON column. The schema has no `Json` column anywhere, and every figure in
it is a typed `Int`. A plan's planned deposits/withdrawals are a list per lender, so they get their
own rows, like `LenderTransaction`.

#### Step 4.1: `ProjectionPlan` and `ProjectionMove` models

**File:** `prisma/schema.prisma`
**Verify:** `npm run typecheck`

Run `npm run db:generate` before the Verify, so the client knows the new models.

```diff
 model User {
   ...
   assistantMemories  AssistantMemory[]
+  projectionPlans    ProjectionPlan[]
+  projectionMoves    ProjectionMove[]
 }
@@
 model Lender {
   ...
   capitalVersions StartingCapitalVersion[]
+  projectionMoves ProjectionMove[]
 
   @@index([userId, deletedAt])
 }
```

Appended after `AssistantMemory`:

```prisma
/// A saved "what if" for the Projections page. INPUTS ONLY.
///
/// Nothing here is a result. Every projected figure is recomputed on read by
/// src/lib/money/forecast.ts from TODAY's running loans and history, so a plan
/// saved in March still projects from what is really out in June. Storing a
/// result would be a figure that silently goes stale the day a loan is paid.
///
/// The rate and cut are what the Admin chose for THIS plan (they start from the
/// history defaults, then are the Admin's). They move no money and are never read
/// by anything but the Projections page.
///
/// THE SECOND TABLE THAT REALLY DELETES, after LoanNote and for the same reason:
/// no money history lives here. A deleted plan in Recently Deleted would invite
/// the question of what money it was worth. Deleting asks first and then means it.
model ProjectionPlan {
  id                 String             @id @default(cuid())
  userId             String
  name               String
  newLoansPerMonth   Int
  loanAmountCentavos Int
  termWeeks          Int
  borrowerRateBps    Int
  adminCutBps        Int
  interestCollection InterestCollection @default(AT_END)
  /// True: returned money is re-lent per lender, following each lender's own history
  /// (share and lag — lib/money/forecast-history.ts relendHabits). False: it sits as cash.
  relend             Boolean            @default(true)
  horizonMonths      Int                @default(24)
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  user  User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  moves ProjectionMove[]

  @@unique([userId, name])
  @@index([userId, createdAt])
}

/// A planned deposit or withdrawal inside one ProjectionPlan — "John adds ₱10,000
/// every month", "Maria takes out ₱5,000 in March". PRETEND MONEY: it is never a
/// LenderTransaction and never touches floating funds.
///
/// fromMonth and untilMonth are the 1st of a month, in date-only columns, so
/// both CONVENTIONS.md date rules apply: write through calendarDate(), read back
/// through storedCalendarDate().
///
/// A move on a lender who is later deleted (Lender.deletedAt) is skipped by the
/// page, not removed: restoring the lender brings the plan back whole.
model ProjectionMove {
  id             String                @id @default(cuid())
  userId         String
  planId         String
  lenderId       String
  type           LenderTransactionType
  amountCentavos Int
  fromMonth      DateTime              @db.Date
  /// False: once, in fromMonth. True: every month from fromMonth on.
  everyMonth     Boolean               @default(false)
  /// Last month of a repeating move, inclusive. Null: to the end of the plan.
  untilMonth     DateTime?             @db.Date
  createdAt      DateTime              @default(now())

  user   User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan   ProjectionPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  lender Lender         @relation(fields: [lenderId], references: [id], onDelete: Cascade)

  @@index([planId])
  @@index([lenderId])
  @@index([userId])
}
```

#### Step 4.2: The migration

**File:** `prisma/migrations/20261108120000_projection_plans/migration.sql`
**Verify:** `test -f prisma/migrations/20261108120000_projection_plans/migration.sql`

Dated after the newest folder (`20261105120000_assistant_memory`). Written in Prisma's own style, as
the existing ones are. The implementer should generate it with `npx prisma migrate diff
--from-schema-datasource ... --to-schema-datamodel prisma/schema.prisma --script` and compare it with
this text, rather than trusting either alone.

```sql
-- Projections: saved what-if plans and their planned deposits/withdrawals.
-- Two new tables only; no existing table, column or row changes.

-- CreateTable
CREATE TABLE "ProjectionPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "newLoansPerMonth" INTEGER NOT NULL,
    "loanAmountCentavos" INTEGER NOT NULL,
    "termWeeks" INTEGER NOT NULL,
    "borrowerRateBps" INTEGER NOT NULL,
    "adminCutBps" INTEGER NOT NULL,
    "interestCollection" "InterestCollection" NOT NULL DEFAULT 'AT_END',
    "relend" BOOLEAN NOT NULL DEFAULT true,
    "horizonMonths" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectionMove" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "type" "LenderTransactionType" NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "fromMonth" DATE NOT NULL,
    "everyMonth" BOOLEAN NOT NULL DEFAULT false,
    "untilMonth" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectionMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectionPlan_userId_name_key" ON "ProjectionPlan"("userId", "name");
CREATE INDEX "ProjectionPlan_userId_createdAt_idx" ON "ProjectionPlan"("userId", "createdAt");
CREATE INDEX "ProjectionMove_planId_idx" ON "ProjectionMove"("planId");
CREATE INDEX "ProjectionMove_lenderId_idx" ON "ProjectionMove"("lenderId");
CREATE INDEX "ProjectionMove_userId_idx" ON "ProjectionMove"("userId");

-- AddForeignKey
ALTER TABLE "ProjectionPlan" ADD CONSTRAINT "ProjectionPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionMove" ADD CONSTRAINT "ProjectionMove_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionMove" ADD CONSTRAINT "ProjectionMove_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProjectionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionMove" ADD CONSTRAINT "ProjectionMove_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "Lender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

#### Step 4.3: The paste-into-Supabase copy

**File:** `prisma/manual/2026-11-08-projection-plans.sql`

Same shape as `prisma/manual/2026-10-20-loan-reminders.sql`: the migration's SQL inside
`BEGIN; … COMMIT;`, plus the `_prisma_migrations` row so `prisma migrate deploy` later treats it as
applied. The checksum is the SHA-256 of `migration.sql` **byte for byte** — compute it with
`sha256sum prisma/migrations/20261108120000_projection_plans/migration.sql` after the file is final.
(Measured 2026-11-08: the reminders manual file's checksum equals `sha256sum` of its migration.)

```sql
-- PASTE ALL OF THIS INTO SUPABASE → SQL Editor → New query → Run.
--
-- Adds saved plans for the Projections page (2026-11-08).
-- RUN IT BEFORE the new version of the app goes live: the Projections page reads these
-- tables. The old app ignores them, so running it early is safe.
-- It only ADDS two empty tables: no existing figure, row or column changes.
-- Run it ONCE. If it says the table already exists, it was already applied.

BEGIN;

-- (paste the whole of migration.sql here, unchanged)

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (gen_random_uuid()::text, '<sha256sum of migration.sql>', now(),
   '20261108120000_projection_plans', NULL, NULL, now(), 1);

COMMIT;
```

#### Phase 4 — Potential Issues

- **Manual-file convention is not followed everywhere.** The three `assistant_*` migrations
  (2026-11-04/05) have no `prisma/manual/` file. This plan follows the older, documented-by-example
  convention (with a file). The owner should confirm which is current. `CONVENTIONS.md` doesn't say.
- **Checksum drift.** Editing `migration.sql` after the manual file is written makes the recorded
  checksum wrong, and `migrate deploy` then reports a modified migration. Write the manual file last.
- **Date-only columns** add two more sites to the CONVENTIONS.md list of six (`fromMonth`,
  `untilMonth`). `CONVENTIONS.md` should be updated to name them. That's a Follow Up, not part of
  this plan's diffs.
- **`Lender` delete is a soft delete,** so `onDelete: Cascade` on `ProjectionMove.lenderId` only fires
  at the 30-day purge. `server/deleted/purge.ts` deletes the lender row for real, and the cascade
  then removes their planned moves. That's correct: nothing to keep.
- **Backup / demo seed.** `server/reports/backup.ts` exports owner tables (it includes
  `pendingLoan`). Plans are left out of it for now (owner default, 2026-11-08). `prisma/seed/demo.ts`
  would need a `deleteMany` before reseeding *only if* a demo plan is seeded. Not done here; both in
  Follow Ups.
- **Int ceiling.** `loanAmountCentavos` is `Int` like every money column (₱21.47M max). Validation in
  Phase 5 refuses anything above that.

**Issues identified:** manual-file convention unclear for recent migrations; CONVENTIONS.md date list
needs two new entries.

### Phase 5: Server — reads and writes

#### Step 5.1: `server/projections/queries.ts`

**File:** `src/server/projections/queries.ts`
**Verify:** `npm run typecheck`

Loads real running rows for every lender, the history rows, and saved plans; turns a plan row into
the engine's input.

Three reads, all scoped by `userId`, all date-only columns through `storedCalendarDate`. The
real-rows query is `projectedFloating`'s (server/lenders/queries.ts) with the lender filter removed.

```ts
import { type BasisPoints, type Centavos, centavos } from '../../lib/money/centavos.ts'
import {
  type DueRecord,
  capitalShares,
  dueRecords,
  historyDefaults,
  historyWindowStart,
  lateDelayDays,
  onTimeRate,
  relendHabits,
  returnEvents,
} from '../../lib/money/forecast-history.ts'
import { type ForecastInput, type Plan, type RealRow } from '../../lib/money/forecast.ts'
import { calendarDate, storedCalendarDate } from '../../lib/money/weeks.ts'
import { db } from '../db.ts'
import { listLenders } from '../lenders/queries.ts'
import { DEFAULT_ADMIN_CUT_BPS, DEFAULT_BORROWER_RATE_BPS } from '../loans/terms.ts'

/**
 * Everything the Projections page projects FROM, read once per page view and
 * shared by every plan on it — a comparison of four plans is one set of reads.
 *
 * lenders     listLenders: the same Floating figure the lenders list shows, so
 *             the projection starts from the number on that screen.
 * realRows    every LoanFunding row on an ACTIVE, non-deleted loan; weeks count
 *             as paid only on a LIVE payment (an undone one is archived).
 * history     loans due, or paid, since historyWindowStart: the split, the on-time
 *             rate, the defaults and each lender's re-lending habit.
 *             See lib/money/forecast-history.ts and plan §1.3–1.4.
 */
export type ProjectionContext = {
  today: Date
  lenders: { id: string; name: string; isSelf: boolean; floatingNow: Centavos }[]
  realRows: RealRow[]
  shares: ForecastInput['shares']
  onTime: ReturnType<typeof onTimeRate>
  lateDelayDays: number | null
  defaults: ReturnType<typeof historyDefaults>
  habits: ReturnType<typeof relendHabits>
}

export async function projectionContext(userId: string): Promise<ProjectionContext> {
  const today = calendarDate(new Date())
  const from = historyWindowStart(today)

  const [lenders, running, history] = await Promise.all([
    listLenders(userId),
    db.loanFunding.findMany({
      where: { userId, loan: { deletedAt: null, status: 'ACTIVE' } },
      select: {
        lenderId: true,
        principalCentavos: true,
        earningsCentavos: true,
        adminCutCentavos: true,
        loan: {
          select: {
            interestCollection: true,
            startOn: true,
            dueOn: true,
            termDays: true,
            payments: { where: { deletedAt: null, weekNumber: { not: null } }, select: { weekNumber: true } },
          },
        },
      },
    }),
    db.loan.findMany({
      where: {
        userId,
        deletedAt: null,
        // Due in the window, or paid in it (a loan due earlier but paid late
        // still handed money back inside the window, which the re-lend habit needs).
        OR: [{ dueOn: { gte: from } }, { payments: { some: { deletedAt: null, paidOn: { gte: from } } } }],
      },
      select: {
        startOn: true,
        dueOn: true,
        termDays: true,
        interestBasis: true,
        interestCollection: true,
        borrowerRateBps: true,
        fundings: {
          select: {
            lenderId: true, principalCentavos: true, earningsCentavos: true, adminCutCentavos: true, adminCutBps: true,
            lender: { select: { isSelf: true } },
          },
        },
        payments: { where: { deletedAt: null }, select: { weekNumber: true, paidOn: true } },
        // Only to know whether the loan was CLOSED by an extension. An extension's
        // dates are not read: on-time uses Loan.dueOn, the extended date (§1.3).
        extensions: { select: { continuedLoanId: true } },
        continuedFrom: { select: { id: true } },
      },
    }),
  ])

  const realRows: RealRow[] = running.map((row) => ({
    lenderId: row.lenderId,
    interestCollection: row.loan.interestCollection,
    startOn: storedCalendarDate(row.loan.startOn),
    dueOn: storedCalendarDate(row.loan.dueOn),
    termDays: row.loan.termDays,
    principal: centavos(row.principalCentavos),
    earnings: centavos(row.earningsCentavos),
    adminCut: centavos(row.adminCutCentavos),
    paidWeeks: new Set(row.loan.payments.flatMap((p) => (p.weekNumber === null ? [] : [p.weekNumber]))),
  }))

  const records: DueRecord[] = history.flatMap((loan) => {
    const settle = loan.payments.find((p) => p.weekNumber === null)
    return dueRecords({
      interestCollection: loan.interestCollection,
      startOn: storedCalendarDate(loan.startOn),
      dueOn: storedCalendarDate(loan.dueOn),
      termDays: loan.termDays,
      settledOn: settle ? storedCalendarDate(settle.paidOn) : null,
      weekPaidOn: new Map(loan.payments.flatMap((p) => (p.weekNumber === null ? [] : [[p.weekNumber, storedCalendarDate(p.paidOn)] as const]))),
      closedByExtension: loan.extensions.some((e) => e.continuedLoanId !== null),
    })
  })

  // A continuation loan (made by an "interest paid now" extension) moved no new
  // capital out of anyone's pot, so its funding would count the same money twice.
  const shareRows = history
    .filter((loan) => loan.continuedFrom.length === 0)
    .flatMap((loan) =>
      loan.fundings.map((f) => ({ lenderId: f.lenderId, principal: centavos(f.principalCentavos), startOn: storedCalendarDate(loan.startOn) })),
    )

  const adminId = lenders.find((l) => l.isSelf)?.id ?? null
  const returns = history.flatMap((loan) =>
    returnEvents(
      {
        rows: loan.fundings.map((f) => ({
          lenderId: f.lenderId,
          interestCollection: loan.interestCollection,
          startOn: storedCalendarDate(loan.startOn),
          dueOn: storedCalendarDate(loan.dueOn),
          termDays: loan.termDays,
          principal: centavos(f.principalCentavos),
          earnings: centavos(f.earningsCentavos),
          adminCut: centavos(f.adminCutCentavos),
          paidWeeks: new Set<number>(),
        })),
        payments: loan.payments.map((p) => ({ weekNumber: p.weekNumber, paidOn: storedCalendarDate(p.paidOn) })),
        closedByExtension: loan.extensions.some((e) => e.continuedLoanId !== null),
      },
      adminId,
    ),
  )
  const lends = shareRows.map((r) => ({ lenderId: r.lenderId, on: r.startOn, principal: r.principal }))

  const defaultsLoans = history.map((loan) => ({
    startOn: storedCalendarDate(loan.startOn),
    interestBasis: loan.interestBasis,
    interestCollection: loan.interestCollection,
    borrowerRateBps: loan.borrowerRateBps,
    cutBps: loan.fundings.filter((f) => !f.lender.isSelf && f.adminCutBps !== null).map((f) => f.adminCutBps as number),
  }))

  return {
    today,
    lenders: lenders.map((l) => ({
      id: l.id,
      name: l.isSelf ? 'Admin' : `${l.firstName} ${l.lastName}`,
      isSelf: l.isSelf,
      floatingNow: l.position.floating,
    })),
    realRows,
    shares: capitalShares(shareRows, today, new Set(lenders.map((l) => l.id))),
    onTime: onTimeRate(records, today),
    lateDelayDays: lateDelayDays(records, today),
    defaults: historyDefaults(defaultsLoans, today, {
      borrowerRateBps: DEFAULT_BORROWER_RATE_BPS as BasisPoints,
      adminCutBps: DEFAULT_ADMIN_CUT_BPS as BasisPoints,
    }),
    habits: relendHabits(returns, lends, today, lenders.map((l) => l.id)),
  }
}

/** Plan names and ids for the picker, newest first. */
export async function listPlans(userId: string) {
  return db.projectionPlan.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  })
}

/**
 * The saved plans asked for, each as the engine's Plan, in the order asked.
 * Moves on a deleted lender are dropped here (the row stays; see the schema).
 */
export async function plansById(userId: string, ids: string[]) {
  const rows = await db.projectionPlan.findMany({
    where: { userId, id: { in: ids } },
    include: { moves: { where: { lender: { deletedAt: null } }, orderBy: { fromMonth: 'asc' } } },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    const plan: Plan = {
      horizonMonths: row.horizonMonths,
      newLoansPerMonth: row.newLoansPerMonth,
      loanAmount: centavos(row.loanAmountCentavos),
      termWeeks: row.termWeeks,
      borrowerRateBps: row.borrowerRateBps,
      adminCutBps: row.adminCutBps,
      collection: row.interestCollection,
      relend: row.relend,
      moves: row.moves.map((m) => ({
        lenderId: m.lenderId,
        type: m.type,
        amount: centavos(m.amountCentavos),
        fromMonth: storedCalendarDate(m.fromMonth),
        everyMonth: m.everyMonth,
        untilMonth: m.untilMonth ? storedCalendarDate(m.untilMonth) : null,
      })),
    }
    return [{ id: row.id, name: row.name, plan, moves: row.moves }]
  })
}
```

#### Step 5.2: `server/projections/actions.ts`

**File:** `src/server/projections/actions.ts`
**Verify:** `npm run verify`

Create / update / delete a plan; add / remove a planned deposit or withdrawal.

Same shape as `server/pending/actions.ts` and `server/lenders/actions.ts`: `'use server'`,
`(_prev: FormState, form: FormData) => Promise<FormState>`, `requireUser()` first, `userId` in every
`where`, a failure is a `FormState`, not an exception.

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { type Result, err, ok } from '../../lib/money/result.ts'
import { MAX_HORIZON_MONTHS, MAX_LOANS_PER_MONTH } from '../../lib/money/forecast.ts'
import { MIN_WEEKLY_WEEKS } from '../../lib/money/weekly.ts'
import { calendarDate, firstOfMonth } from '../../lib/money/weeks.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, amount, failed, text } from '../forms.ts'
import { parseRate } from '../loans/terms.ts'

/**
 * Writing saved Projections plans. INPUTS ONLY — nothing here moves money or
 * touches a lender's floating funds; see ProjectionPlan in the schema.
 */

const MAX_TERM_WEEKS = 52
const MAX_INT_CENTAVOS = 2_147_483_647

function refresh(): void {
  revalidatePath('/projections')
  revalidatePath('/') // the dashboard preview
}

function whole(form: FormData, key: string, label: string, min: number, max: number): Result<number, string> {
  const raw = text(form, key)
  const n = Number(raw)
  if (raw === '' || !Number.isInteger(n) || n < min || n > max) return err(`${label} must be a whole number from ${min} to ${max}.`)
  return ok(n)
}

/** "2027-03" from <input type="month"> → 1 March 2027 at midday, through calendarDate. */
function month(form: FormData, key: string): Result<Date, string> {
  const match = /^(\d{4})-(\d{2})$/.exec(text(form, key))
  if (!match) return err('Pick a month.')
  return ok(calendarDate(firstOfMonth(new Date(Number(match[1]), Number(match[2]) - 1, 1, 12))))
}

type PlanFields = {
  name: string
  newLoansPerMonth: number
  loanAmountCentavos: number
  termWeeks: number
  borrowerRateBps: number
  adminCutBps: number
  interestCollection: 'AT_END' | 'WEEKLY'
  relend: boolean
  horizonMonths: number
}

function readPlan(form: FormData): Result<PlanFields, string> {
  const name = text(form, 'name')
  if (name === '' || name.length > 60) return err('Give the plan a name, up to 60 characters.')
  const loans = whole(form, 'newLoansPerMonth', 'New loans a month', 0, MAX_LOANS_PER_MONTH)
  if (!loans.ok) return loans
  const size = amount(form, 'loanAmount')
  if (!size.ok) return size
  if (size.value > MAX_INT_CENTAVOS) return err('A loan that large cannot be recorded.')
  const weeks = whole(form, 'termWeeks', 'Length in weeks', 1, MAX_TERM_WEEKS)
  if (!weeks.ok) return weeks
  const rate = parseRate(text(form, 'borrowerRate'))
  if (!rate.ok) return rate
  const cut = parseRate(text(form, 'adminCut'))
  if (!cut.ok) return cut
  if (cut.value > rate.value) return err('The Admin cut cannot be more than the rate charged.')
  const collection = text(form, 'interestCollection') === 'WEEKLY' ? 'WEEKLY' : 'AT_END'
  if (collection === 'WEEKLY' && weeks.value < MIN_WEEKLY_WEEKS) {
    return err(`Collecting weekly needs a loan of at least ${MIN_WEEKLY_WEEKS} weeks.`)
  }
  const horizon = whole(form, 'horizonMonths', 'Months ahead', 1, MAX_HORIZON_MONTHS)
  if (!horizon.ok) return horizon
  return ok({
    name,
    newLoansPerMonth: loans.value,
    loanAmountCentavos: size.value,
    termWeeks: weeks.value,
    borrowerRateBps: rate.value,
    adminCutBps: cut.value,
    interestCollection: collection,
    relend: text(form, 'relend') === 'on',
    horizonMonths: horizon.value,
  })
}

export async function createPlan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const fields = readPlan(form)
  if (!fields.ok) return failed(fields.error)
  const clash = await db.projectionPlan.findFirst({ where: { userId: user.id, name: fields.value.name }, select: { id: true } })
  if (clash) return failed('A plan with that name already exists.')
  const plan = await db.projectionPlan.create({ data: { ...fields.value, userId: user.id }, select: { id: true } })
  refresh()
  redirect(`/projections?plan=${plan.id}`)
}

export async function updatePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const id = text(form, 'planId')
  const fields = readPlan(form)
  if (!fields.ok) return failed(fields.error)
  const clash = await db.projectionPlan.findFirst({
    where: { userId: user.id, name: fields.value.name, NOT: { id } },
    select: { id: true },
  })
  if (clash) return failed('A plan with that name already exists.')
  const { count } = await db.projectionPlan.updateMany({ where: { id, userId: user.id }, data: fields.value })
  if (count === 0) return failed('That plan no longer exists.')
  refresh()
  return NO_ERROR
}

/** Really deletes — a plan holds no money history. The form asks first. */
export async function deletePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  await db.projectionPlan.deleteMany({ where: { id: text(form, 'planId'), userId: user.id } })
  refresh()
  redirect('/projections')
}

export async function addMove(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const planId = text(form, 'planId')
  const lenderId = text(form, 'lenderId')
  const [plan, lender] = await Promise.all([
    db.projectionPlan.findFirst({ where: { id: planId, userId: user.id }, select: { id: true } }),
    db.lender.findFirst({ where: { id: lenderId, userId: user.id, deletedAt: null }, select: { id: true } }),
  ])
  if (!plan) return failed('That plan no longer exists.')
  if (!lender) return failed('Pick a lender.')
  const size = amount(form, 'amount')
  if (!size.ok) return failed(size.error)
  const from = month(form, 'fromMonth')
  if (!from.ok) return failed(from.error)
  const everyMonth = text(form, 'everyMonth') === 'on'
  let until: Date | null = null
  if (everyMonth && text(form, 'untilMonth') !== '') {
    const parsed = month(form, 'untilMonth')
    if (!parsed.ok) return failed(parsed.error)
    if (parsed.value.getTime() < from.value.getTime()) return failed('The last month cannot be before the first.')
    until = parsed.value
  }
  await db.projectionMove.create({
    data: {
      userId: user.id,
      planId,
      lenderId,
      type: text(form, 'type') === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT',
      amountCentavos: size.value,
      fromMonth: from.value,
      everyMonth,
      untilMonth: until,
    },
  })
  refresh()
  return NO_ERROR
}

export async function removeMove(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  await db.projectionMove.deleteMany({ where: { id: text(form, 'moveId'), userId: user.id } })
  refresh()
  return NO_ERROR
}
```

#### Phase 5 — Potential Issues

- **`parseRate` returns basis points through `parsePesos`** ("7" → 700, "6.5" → 650). Read and
  confirmed in `server/loans/terms.ts` line 315. Nothing new.
- **`listLenders` runs `ledgers()`**, the heaviest per-lender read in the app (its own comment says
  so). The page calls it once per view, the same as the lenders list. The dashboard preview (Phase 7)
  calls it a second time on the dashboard, which already calls `listLenders`. Phase 7 passes the
  dashboard's existing result in instead.
- **Deleted lenders with money still out.** `listLenders` drops them, so their real arrivals are
  booked and then never shown (the engine only reports lenders it was given). Today's Pot total has
  the same scope, so the two agree. Flagged anyway.
- **History query width.** `dueOn >= from` covers every due amount in the window: a weekly loan's
  weeks are all due on or before its `dueOn`, and an extension moves `dueOn` later, never earlier.
  The `payments … paidOn >= from` arm adds loans paid late inside the window, for the re-lend habit.
  Loans started before the window come back too; each history function filters on its own dates.
- **Weekly loans that are part-collected** still hand money back week by week. `returnEvents` books
  each live weekly payment on its own `paidOn`, so a lender's returns aren't bunched at the end.
- **Undo safety:** both payment selects filter `deletedAt: null` (label-truth trap).
- **`redirect` inside an action** throws by design in Next. It's already used the same way in
  `deleteLender`. These forms are wrapped by `useActionState` only (no closure), so the no-JS
  fallback is kept (CONVENTIONS.md trap).
- **The client form imports these actions** from `src/server/`. That's the established exception
  (`pending/add-pending.tsx` imports `createPendingLoan`): a `'use server'` module is an endpoint
  reference, not server code in the bundle. Limits the form also needs (`MAX_LOANS_PER_MONTH`,
  `MAX_HORIZON_MONTHS`, `MIN_WEEKLY_WEEKS`) come from `src/lib/`, not from this file.
- **Rename race:** `@@unique([userId, name])` backs the clash check, so a double submit fails on the
  index instead of creating a duplicate. That surfaces as a Prisma error; acceptable for a
  single-admin app.

**Issues identified:** the deleted-lender scope (Follow Ups); otherwise follows existing patterns.

### Phase 6: The Projections page

Before writing any of it, the implementer loads the **`label-truth`** skill (every figure here is
labelled) and the **`dataviz`** skill (chart). All selection is in the URL, as in
`where-the-money-is.tsx`:

| Param | Meaning |
| --- | --- |
| `plan` | the plan being edited and drawn first (default: newest) |
| `compare` | up to two more plan ids, comma-separated |
| `view` | `admin` (Admin cut) · `pot` (whole pot, default) · `lender` |
| `lender` | lender id when `view=lender` (default: the Admin pot) |
| `month` | `YYYY-MM`, the month whose figures are shown (default: this month) |
| `target` | pesos, for "when do I reach ₱X" |
| `targetKind` | `interest` (total estimated interest from today, default) · `pot` (pot size: cash + capital out). `pot` isn't offered on the Admin-cut view |

#### Step 6.1: Menu entry

**File:** `src/components/shell/nav-items.ts`

```diff
 import {
   ArrowLeftRight,
   FileText,
   Inbox,
   LayoutDashboard,
+  TrendingUp,
   Trash2,
@@
   { href: '/money', label: 'Money history', short: 'Money', icon: ArrowLeftRight, primary: false },
+  // Estimates only (owner, 2026-11-08). Behind "More" on a phone: it is planning, not daily work.
+  { href: '/projections', label: 'Projections', short: 'Projections', icon: TrendingUp, primary: false },
   { href: '/reports', label: 'Reports', short: 'Reports', icon: FileText, primary: false },
```

#### Step 6.2: The line chart

**File:** `src/app/(app)/projections/projection-chart.tsx`
**Verify:** `npm run typecheck`

A server component, hand-drawn SVG like `WhereTheMoneyIs`. It plots **running total of estimated
interest** (`interestToDate`), one solid line (best case) and one dashed line (realistic) per plan.
Colours are `--series-1..3` from `globals.css`, never the four status tokens (CONVENTIONS.md colour
trap). That's why at most three plans can be compared. Every month column is a link to `?month=`.
Flagged months get a marker **and** are listed in words under the chart, so colour is never the only
signal.

```tsx
import Link from 'next/link'

import { type Centavos, formatPesos } from '@/lib/money/centavos.ts'
import { type ViewMonth } from '@/lib/money/forecast.ts'

export type ChartLine = {
  key: string
  label: string
  /** var(--series-N). Never a status colour. */
  color: string
  dashed: boolean
  points: ViewMonth[]
}

const W = 640
const H = 220
const PAD = { left: 8, right: 8, top: 12, bottom: 24 }

/**
 * Running total of ESTIMATED interest, month by month, for one or more plans.
 *
 * WHAT IS DRAWN: ViewMonth.interestToDate from lib/money/forecast.ts — interest
 * that comes back from today through the end of each month, in the chosen view.
 * Not money in hand, not floating funds, and not interest earned on paper: a
 * month's figure is what would be COLLECTED in it. Best case solid, realistic
 * dashed, same colour per plan.
 */
export function ProjectionChart({
  lines,
  selected,
  hrefFor,
  target,
  flagged,
}: {
  lines: ChartLine[]
  selected: string
  hrefFor: (monthKey: string) => string
  target: Centavos | null
  /** Month keys with a cash warning on the first plan. */
  flagged: ReadonlySet<string>
}) {
  const months = lines[0]?.points ?? []
  const top = Math.max(1, target ?? 0, ...lines.flatMap((l) => l.points.map((p) => p.interestToDate)))
  const x = (i: number) => PAD.left + (i / Math.max(1, months.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => H - PAD.bottom - (v / top) * (H - PAD.top - PAD.bottom)
  const step = months.length > 1 ? x(1) - x(0) : W

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Estimated interest, running total by month">
      {target !== null ? (
        <line x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 4" />
      ) : null}
      {lines.map((line) => (
        <polyline
          key={line.key}
          fill="none"
          stroke={line.color}
          strokeWidth={2}
          strokeDasharray={line.dashed ? '6 4' : undefined}
          points={line.points.map((p, i) => `${x(i)},${y(p.interestToDate)}`).join(' ')}
        />
      ))}
      {months.map((m, i) => (
        <Link key={m.key} href={hrefFor(m.key)} scroll={false} aria-label={`Show ${m.key}`}>
          <rect x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" />
          {m.key === selected ? <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity={0.5} /> : null}
          {flagged.has(m.key) ? <path d={`M${x(i)} ${H - 6} l-4 -7 h8 z`} fill="currentColor" aria-hidden /> : null}
        </Link>
      ))}
      <text x={PAD.left} y={PAD.top} className="fill-muted-foreground text-[10px]">
        {formatPesos(top as Centavos)}
      </text>
    </svg>
  )
}
```

#### Step 6.3: The plan form and planned money moves

**File:** `src/app/(app)/projections/plan-form.tsx`

Client component, shaped like `pending/add-pending.tsx`: `useActionState` handed the server action
directly (no wrapper), so the form still posts without JavaScript. Number fields carry `min`/`max`
from `src/lib/money/forecast.ts` and `weekly.ts` (not `src/server/`).

```tsx
'use client'

import { useActionState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'
import { NO_ERROR } from '@/lib/form-state.ts'
import { MAX_HORIZON_MONTHS, MAX_LOANS_PER_MONTH } from '@/lib/money/forecast.ts'
import { addMove, createPlan, deletePlan, removeMove, updatePlan } from '@/server/projections/actions.ts'

export type PlanDefaults = {
  name: string
  newLoansPerMonth: number
  /** Pesos, as typed: "30000". */
  loanAmount: string
  termWeeks: number
  /** Percent, as typed: "7". */
  borrowerRate: string
  adminCut: string
  interestCollection: 'AT_END' | 'WEEKLY'
  relend: boolean
  horizonMonths: number
}

/** Create (no planId) or edit (planId) a plan. Rate and cut start from history, then are the Admin's. */
export function PlanForm({ planId, values, defaultsNote }: { planId: string | null; values: PlanDefaults; defaultsNote: string }) {
  const [state, action] = useActionState(planId ? updatePlan : createPlan, NO_ERROR)
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {planId ? <input type="hidden" name="planId" value={planId} /> : null}
      <Field label="Plan name"><Input name="name" defaultValue={values.name} required maxLength={60} /></Field>
      <Field label="New loans each month"><Input name="newLoansPerMonth" type="number" min={0} max={MAX_LOANS_PER_MONTH} defaultValue={values.newLoansPerMonth} /></Field>
      <Field label="Amount of each loan (₱)"><Input name="loanAmount" inputMode="decimal" defaultValue={values.loanAmount} /></Field>
      <Field label="Length (weeks)"><Input name="termWeeks" type="number" min={1} max={52} defaultValue={values.termWeeks} /></Field>
      <Field label="Rate charged per week (%)"><Input name="borrowerRate" inputMode="decimal" defaultValue={values.borrowerRate} /></Field>
      <Field label="Admin cut per week (%)"><Input name="adminCut" inputMode="decimal" defaultValue={values.adminCut} /></Field>
      <Field label="Interest collected">
        <SelectNative name="interestCollection" defaultValue={values.interestCollection}>
          <option value="AT_END">At the end</option>
          <option value="WEEKLY">Every week</option>
        </SelectNative>
      </Field>
      <Field label="Months ahead"><Input name="horizonMonths" type="number" min={1} max={MAX_HORIZON_MONTHS} defaultValue={values.horizonMonths} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="relend" defaultChecked={values.relend} />
        Re-lend returned money the way each lender has been doing it (off: it stays as cash)
      </label>
      <p className="text-muted-foreground text-xs sm:col-span-2">{defaultsNote}</p>
      {state.error ? <p role="alert" className="text-status-critical text-sm sm:col-span-2">{state.error}</p> : null}
      <button type="submit" className="bg-brand text-brand-foreground rounded-lg px-4 py-2 text-sm font-medium sm:col-span-2">
        {planId ? 'Save plan' : 'Create plan'}
      </button>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

/** One planned deposit or withdrawal. Pretend money: never recorded as a transaction. */
export function AddMoveForm({ planId, lenders }: { planId: string; lenders: { id: string; name: string }[] }) {
  const [state, action] = useActionState(addMove, NO_ERROR)
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-3">
      <input type="hidden" name="planId" value={planId} />
      <SelectNative name="lenderId" aria-label="Lender">{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectNative>
      <SelectNative name="type" aria-label="Adds or takes out">
        <option value="DEPOSIT">Adds</option>
        <option value="WITHDRAWAL">Takes out</option>
      </SelectNative>
      <Input name="amount" inputMode="decimal" placeholder="₱ amount" aria-label="Amount" />
      <Input name="fromMonth" type="month" aria-label="From month" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="everyMonth" /> Every month</label>
      <Input name="untilMonth" type="month" aria-label="Until month (optional)" />
      {state.error ? <p role="alert" className="text-status-critical text-sm sm:col-span-3">{state.error}</p> : null}
      <button type="submit" className="text-brand text-sm font-medium sm:col-span-3">Add planned money move</button>
    </form>
  )
}

export function RemoveMoveButton({ moveId }: { moveId: string }) {
  const [, action] = useActionState(removeMove, NO_ERROR)
  return (
    <form action={action}>
      <input type="hidden" name="moveId" value={moveId} />
      <button type="submit" className="text-muted-foreground text-xs">Remove</button>
    </form>
  )
}

export function DeletePlanButton({ planId, name }: { planId: string; name: string }) {
  const [, action] = useActionState(deletePlan, NO_ERROR)
  return (
    <form action={action} onSubmit={(e) => { if (!confirm(`Delete the plan “${name}”? This cannot be undone.`)) e.preventDefault() }}>
      <input type="hidden" name="planId" value={planId} />
      <button type="submit" className="text-status-critical text-sm">Delete plan</button>
    </form>
  )
}
```

#### Step 6.4: The page

**File:** `src/app/(app)/projections/page.tsx`
**Verify:** `npm run verify`

A server component. `PageProps<'/projections'>` with an awaited `searchParams`, the same way
`lenders/[id]/page.tsx` does it. With no saved plan it still projects the **real loans only** (zero
new loans), so the page is useful before anything is saved.

```tsx
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { type Centavos, centavos, parsePesos } from '@/lib/money/centavos.ts'
import { HISTORY_MONTHS } from '@/lib/money/forecast-history.ts'
import {
  DEFAULT_HORIZON_MONTHS,
  type Plan,
  type View,
  forecast,
  type TargetKind,
  forecastView,
  monthOf,
  reachTarget,
} from '@/lib/money/forecast.ts'
import { monthKey } from '@/lib/money/weeks.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listPlans, plansById, projectionContext } from '@/server/projections/queries.ts'

import { AddMoveForm, DeletePlanButton, PlanForm, RemoveMoveButton } from './plan-form.tsx'
import { type ChartLine, ProjectionChart } from './projection-chart.tsx'

export const metadata = { title: 'Projections' }

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)']
const monthName = (d: Date) => d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`

export default async function ProjectionsPage({ searchParams }: PageProps<'/projections'>) {
  const user = await requireUser()
  const q = await searchParams
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined)

  const [ctx, saved] = await Promise.all([projectionContext(user.id), listPlans(user.id)])
  const currentId = one('plan') ?? saved[0]?.id ?? null
  const ids = [...new Set([currentId, ...(one('compare')?.split(',') ?? [])].filter((id): id is string => !!id))].slice(0, 3)
  const loaded = await plansById(user.id, ids)

  const realOnly: Plan = {
    horizonMonths: DEFAULT_HORIZON_MONTHS, newLoansPerMonth: 0, loanAmount: centavos(1), termWeeks: 1,
    borrowerRateBps: ctx.defaults.borrowerRateBps, adminCutBps: ctx.defaults.adminCutBps,
    collection: 'AT_END', relend: false, moves: [],
  }
  const plans = loaded.length > 0 ? loaded : [{ id: 'real', name: 'Running loans only', plan: realOnly, moves: [] }]

  const admin = ctx.lenders.find((l) => l.isSelf)
  const view: View =
    one('view') === 'admin' ? { kind: 'admin-cut' }
    : one('view') === 'lender' ? { kind: 'lender', lenderId: one('lender') ?? admin?.id ?? '' }
    : { kind: 'pot' }

  const runs = plans.map((p) => {
    const input = { today: ctx.today, plan: p.plan, lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits }
    const f = forecast(input, { onTimeBps: ctx.onTime.bps, lateDelayDays: ctx.lateDelayDays })
    return { ...p, f, best: forecastView(f.best, view), realistic: f.realistic ? forecastView(f.realistic, view) : null }
  })
  // A plan too large for safe integer arithmetic throws from checkedProduct.
  // Caught by the route's error boundary today; see Phase 6 issues.

  const first = runs[0]
  const selectedKey = one('month') ?? monthKey(ctx.today)
  const best = monthOf(first.best, selectedKey) ?? first.best[0]
  const realistic = first.realistic ? monthOf(first.realistic, best.key) : null
  const targetParsed = one('target') ? parsePesos(one('target') as string) : null
  const target: Centavos | null = targetParsed?.ok ? targetParsed.value : null
  const targetKind: TargetKind = one('targetKind') === 'pot' && view.kind !== 'admin-cut' ? 'pot' : 'interest'

  const lines: ChartLine[] = runs.flatMap((r, i) => [
    { key: `${r.id}-best`, label: `${r.name} — all pay on time`, color: SERIES[i], dashed: false, points: r.best },
    ...(r.realistic ? [{ key: `${r.id}-real`, label: `${r.name} — realistic`, color: SERIES[i], dashed: true, points: r.realistic }] : []),
  ])
  const flagged = new Set(first.best.filter((m) => m.warnings.length > 0).map((m) => m.key))
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])))
    for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v))
    return `/projections?${p.toString()}`
  }
  const name = (id: string) => ctx.lenders.find((l) => l.id === id)?.name ?? 'A lender'

  /* LABEL PROVENANCE (label-truth). Every figure below is an ESTIMATE from
     lib/money/forecast.ts, recomputed on every view from today's ACTIVE loans
     (realRows) and the saved plan's inputs. "Interest" is money COLLECTED in
     the month, in the chosen view:
       pot        LenderMonth.interest + adminCut, every pot
       admin      LenderMonth.adminCut on the Admin pot — the cut only
       lender     that pot's own LenderMonth.interest
     "Total by then" is interestToDate: from TODAY to the end of that month, not
     since the start of lending. Money already late today (Simulation.lateNow)
     is in NEITHER line, and is printed separately so the gap is visible. */

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Projections</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Estimates, not promises. Built from the loans running today plus the pretend loans in the plan.
        </p>
      </div>

      <nav aria-label="Whose money" className="flex flex-wrap gap-2 text-sm">
        <Link href={href({ view: 'pot', lender: null })} aria-current={view.kind === 'pot' ? 'page' : undefined}>Whole pot</Link>
        <Link href={href({ view: 'admin', lender: null })} aria-current={view.kind === 'admin-cut' ? 'page' : undefined}>Admin cut</Link>
        {ctx.lenders.map((l) => (
          <Link key={l.id} href={href({ view: 'lender', lender: l.id })} aria-current={view.kind === 'lender' && view.lenderId === l.id ? 'page' : undefined}>
            {l.name}
          </Link>
        ))}
      </nav>

      <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70">
        <h2 className="text-base font-semibold">Estimated interest, running total</h2>
        {/* The chart's dotted target line is drawn only for an interest target: a pot-size
            target is on a different scale from the running interest the chart plots. */}
        <ProjectionChart lines={lines} selected={best.key} hrefFor={(key) => href({ month: key })} target={targetKind === 'interest' ? target : null} flagged={flagged} />
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {lines.map((l) => <li key={l.key}><span style={{ color: l.color }}>{l.dashed ? '- - -' : '———'}</span> {l.label}</li>)}
        </ul>
        <p className="text-muted-foreground text-xs">
          {ctx.onTime.bps === null
            ? `No realistic line: nothing fell due in the last ${HISTORY_MONTHS} months to measure.`
            : `Realistic line: ${pct(ctx.onTime.bps)} of ${ctx.onTime.counted} amounts due since ${ctx.onTime.from.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })} were paid on or before their due day. The rest is drawn ${ctx.lateDelayDays ?? 30} days later${ctx.lateDelayDays === null ? ' (a guess: no late payment has come in yet)' : ' (the usual delay)'}.`}
        </p>
        {first.f.best.lateNow > 0 ? (
          <p className="text-xs">
            Not in either line: <Money amount={first.f.best.lateNow} variant="display" /> already overdue today.
          </p>
        ) : null}
        {first.f.best.refused ? <p role="alert" className="text-sm">{first.f.best.refused}</p> : null}
        {first.plan.relend ? (
          <ul className="text-muted-foreground space-y-0.5 text-xs" aria-label="How each lender re-lends">
            {/* RelendHabit from relendHabits: shareBps is an UPPER BOUND (deposit-funded
                lending looks like re-lending), so the words say "up to". A default is
                named as one, per lender, as the owner asked. */}
            {ctx.lenders.map((l) => {
              const h = ctx.habits.get(l.id)
              return (
                <li key={l.id}>
                  {l.name}:{' '}
                  {!h || h.basis === 'default'
                    ? 'default — not enough history, so all returned money is re-lent the next month'
                    : `re-lends up to ${pct(h.shareBps)} of returned money, about ${Math.max(1, h.lagMonths)} month${Math.max(1, h.lagMonths) === 1 ? '' : 's'} later (from ${h.returnMonths} months with money back)`}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="bg-card rounded-2xl p-4 ring-1 ring-border/70">
          {/* interest COLLECTED in this one month, best case, first plan */}
          <p className="text-muted-foreground text-xs">Estimated interest in {monthName(best.month)}</p>
          <p className="text-xl font-semibold"><Money amount={best.interest} variant="display" /></p>
          {realistic ? <p className="text-muted-foreground text-xs">Realistic: <Money amount={realistic.interest} variant="display" /></p> : null}
        </div>
        <div className="bg-card rounded-2xl p-4 ring-1 ring-border/70">
          {/* interestToDate: from today, not from the start of lending */}
          <p className="text-muted-foreground text-xs">Estimated total from today to the end of {monthName(best.month)}</p>
          <p className="text-xl font-semibold"><Money amount={best.interestToDate} variant="display" /></p>
          {realistic ? <p className="text-muted-foreground text-xs">Realistic: <Money amount={realistic.interestToDate} variant="display" /></p> : null}
        </div>
      </section>

      <form method="get" action="/projections" className="flex flex-wrap items-end gap-2">
        {Object.entries(q).flatMap(([k, v]) => (k !== 'target' && k !== 'targetKind' && typeof v === 'string' ? [<input key={k} type="hidden" name={k} value={v} />] : []))}
        <label className="text-sm">When do I reach ₱ <input name="target" inputMode="decimal" defaultValue={one('target') ?? ''} className="border-border w-32 rounded border px-2" /></label>
        <select name="targetKind" defaultValue={targetKind} aria-label="Reach it in" className="border-border rounded border px-1 text-sm">
          <option value="interest">in total interest from today</option>
          {view.kind !== 'admin-cut' ? <option value="pot">in pot size (cash + capital out)</option> : null}
        </select>
        <button type="submit" className="text-brand text-sm font-medium">Find the month</button>
      </form>
      {target !== null ? (
        <p className="text-sm">
          {(() => {
            const b = reachTarget(first.best, target, targetKind)
            const r = first.realistic ? reachTarget(first.realistic, target, targetKind) : null
            const say = (m: typeof b) => (m ? monthName(m.month) : `not within the ${first.best.length} months shown`)
            const what = targetKind === 'pot' ? 'Pot size (cash + capital out) estimated to reach it' : 'Total interest from today estimated to reach it'
            return `${what}: ${say(b)} if everyone pays on time${first.realistic ? `; ${say(r)} on the realistic line` : ''}.`
          })()}
        </p>
      ) : null}

      {flagged.size > 0 ? (
        <section aria-label="Months with a cash warning" className="space-y-1">
          <h2 className="flex items-center gap-1 text-sm font-semibold"><AlertTriangle className="size-4" /> Not enough free cash</h2>
          <ul className="text-sm">
            {first.best.filter((m) => m.warnings.length > 0).map((m) => (
              <li key={m.key}>
                {monthName(m.month)}:{' '}
                {m.warnings.map((w) => `${name(w.lenderId)} would need ${w.cause === 'loans' ? 'their share of the new loans' : 'a withdrawal'} but has less free`).join('; ')}
                {' '}— still projected as if the money were there.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Plans</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {saved.map((p) => (
            <li key={p.id} className="flex gap-1">
              <Link href={href({ plan: p.id })}>{p.name}</Link>
              {p.id !== currentId ? (
                <Link className="text-muted-foreground" href={href({ compare: [...ids.filter((id) => id !== currentId && id !== p.id), p.id].slice(0, 2).join(',') })}>+ compare</Link>
              ) : null}
            </li>
          ))}
        </ul>
        <PlanForm
          planId={loaded[0]?.id ?? null}
          values={/* from loaded[0] row, or ctx.defaults for a new plan — see Step 6.4 notes */ toFormValues(loaded[0]?.plan ?? null, loaded[0]?.name ?? '', ctx.defaults)}
          defaultsNote={
            ctx.defaults.basedOn === 0
              ? 'Rate, cut and collection start at 7%, 2%, at the end: no weekly-rate loans in the last 6 months to take them from.'
              : `Rate, cut and collection start from the most common values on ${ctx.defaults.basedOn} weekly-rate loans in the last 6 months. Change them for this plan.`
          }
        />
        {loaded[0] ? (
          <>
            <h3 className="text-sm font-semibold">Planned money in and out (pretend; nothing is recorded)</h3>
            <ul className="text-sm">
              {loaded[0].moves.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  {name(m.lenderId)} {m.type === 'DEPOSIT' ? 'adds' : 'takes out'} <Money amount={centavos(m.amountCentavos)} variant="display" />
                  {m.everyMonth ? ' every month' : ''}
                  <RemoveMoveButton moveId={m.id} />
                </li>
              ))}
            </ul>
            <AddMoveForm planId={loaded[0].id} lenders={ctx.lenders.map((l) => ({ id: l.id, name: l.name }))} />
            <DeletePlanButton planId={loaded[0].id} name={loaded[0].name} />
          </>
        ) : null}
      </section>
    </div>
  )
}

/** A saved plan (or the history defaults) as the strings the form shows. */
function toFormValues(plan: Plan | null, name: string, d: { borrowerRateBps: number; adminCutBps: number; collection: 'AT_END' | 'WEEKLY' }) {
  const pctText = (bps: number) => String(bps / 100)
  return {
    name: plan ? name : '',
    newLoansPerMonth: plan?.newLoansPerMonth ?? 1,
    loanAmount: plan ? String(plan.loanAmount / 100) : '',
    termWeeks: plan?.termWeeks ?? 4,
    borrowerRate: pctText(plan?.borrowerRateBps ?? d.borrowerRateBps),
    adminCut: pctText(plan?.adminCutBps ?? d.adminCutBps),
    interestCollection: plan?.collection ?? d.collection,
    relend: plan?.relend ?? true,
    horizonMonths: plan?.horizonMonths ?? DEFAULT_HORIZON_MONTHS,
  }
}
```

#### Phase 6 — Potential Issues

- **The colour trap, twice.** Series use `--series-N` only. The donut on the lender page uses
  `--status-good` / `--status-critical` for parts, which looks like a breach of CONVENTIONS.md's
  colour rule. **Don't copy that.** Raised in Follow Ups, not fixed here.
- **Only three series tokens exist**, so a comparison is capped at three plans (current + two). Needing
  more means adding tokens to `globals.css` in both themes. Not done here.
- **`toLocaleDateString('en-PH')` runs on the server**, whose zone is UTC on Vercel. Every date here is
  local midday, so the day can't move, but the implementer should check the month name for 1st-of-month
  dates under `TZ=America/Los_Angeles` (CONVENTIONS.md: "invisible until you run with TZ set west of
  London").
- **`pct` is new display code.** `src/lib/loan-export.ts` line 75 already formats bps as "7%" /
  "6.5%". The implementer should import that helper (its name wasn't read — check line 75) instead of
  the local `pct`.
- **`checkedProduct` overflow** on an absurd plan throws inside the render. It reaches the route's
  error boundary, not a friendly message. Acceptable for v1 because the form caps inputs (50 loans,
  ₱21M, 60 months). Flagged for a `try` around `forecast` if the owner wants a message.
- **The page has no `loading.tsx`.** Sibling routes have one (`pending/loading.tsx`). Copy it.
- **`'use client'` + `confirm()`** in `DeletePlanButton` needs JavaScript. That's acceptable: deleting
  without confirmation is worse than not deleting without JS, which is the same trade the
  CONVENTIONS.md wrapped-action trap describes.
- **Label checks owed (label-truth):** "Estimated interest in {month}", "Estimated total from today
  to the end of {month}", "Not in either line … already overdue", the on-time sentence, "Pot size
  (cash + capital out)" and each lender's "re-lends up to N%". With the database unreachable from
  this session, the implementer must run the proving queries in Phase 7's issues before shipping.
- **"Pot size" vs the lender page's "Pot total".** The lender page's donut is labelled Pot total, and
  its exact definition wasn't read for this plan. If Pot total is not cash + capital out, either
  match it or keep the words "Pot size (cash + capital out)" so the two can't be confused. Check
  `lenders/[id]/page.tsx` before choosing.

**Issues identified:** reuse the existing bps formatter; add `loading.tsx`; donut status-colour use
raised separately.

### Phase 7: Dashboard preview

#### Step 7.1: Preview card on the dashboard

**File:** `src/app/(app)/projection-preview.tsx`, `src/app/(app)/page.tsx`, `src/server/projections/queries.ts`
**Verify:** `npm run verify`

A small card: whole pot, best case and realistic, for the newest saved plan (or running loans only),
with a link to the page. It reuses the dashboard's own `listLenders` result rather than reading the
ledgers twice.

`src/server/projections/queries.ts`, let the caller pass lenders it already has:

```diff
-export async function projectionContext(userId: string): Promise<ProjectionContext> {
+export async function projectionContext(
+  userId: string,
+  known?: Awaited<ReturnType<typeof listLenders>>,
+): Promise<ProjectionContext> {
   const today = calendarDate(new Date())
   const from = historyWindowStart(today)
 
   const [lenders, running, history] = await Promise.all([
-    listLenders(userId),
+    known ?? listLenders(userId),
```

New `src/app/(app)/projection-preview.tsx` (server component):

```tsx
import Link from 'next/link'
import { TrendingUp } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { centavos } from '@/lib/money/centavos.ts'
import { DEFAULT_HORIZON_MONTHS, type Plan, forecast, forecastView } from '@/lib/money/forecast.ts'
import { type ProjectionContext } from '@/server/projections/queries.ts'

const PREVIEW_MONTHS = 12

/**
 * WHAT THE FIGURES ARE (label-truth): forecastView(..., { kind: 'pot' }) for the
 * newest saved plan, or for the running loans alone when none is saved — every
 * pot's interest plus the Admin cut, COLLECTED from today to the end of the
 * 12th month. An estimate, and the card says so in its title. Money already
 * overdue today is not in it, as on the Projections page.
 */
export function ProjectionPreview({ ctx, plan, planName }: { ctx: ProjectionContext; plan: Plan | null; planName: string | null }) {
  const p: Plan = plan ?? {
    horizonMonths: DEFAULT_HORIZON_MONTHS, newLoansPerMonth: 0, loanAmount: centavos(1), termWeeks: 1,
    borrowerRateBps: ctx.defaults.borrowerRateBps, adminCutBps: ctx.defaults.adminCutBps,
    collection: 'AT_END', relend: false, moves: [],
  }
  const f = forecast(
    { today: ctx.today, plan: { ...p, horizonMonths: PREVIEW_MONTHS }, lenders: ctx.lenders, realRows: ctx.realRows, shares: ctx.shares, habits: ctx.habits },
    { onTimeBps: ctx.onTime.bps, lateDelayDays: ctx.lateDelayDays },
  )
  const best = forecastView(f.best, { kind: 'pot' }).at(-1)
  const realistic = f.realistic ? forecastView(f.realistic, { kind: 'pot' }).at(-1) : null
  return (
    <Link href="/projections" className="bg-card block rounded-2xl p-4 ring-1 ring-border/70">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <TrendingUp className="size-3.5" /> Estimated interest, next {PREVIEW_MONTHS} months
      </p>
      <p className="text-xl font-semibold"><Money amount={best?.interestToDate ?? centavos(0)} variant="display" /></p>
      <p className="text-muted-foreground text-xs">
        {realistic ? <>Realistic: <Money amount={realistic.interestToDate} variant="display" /> · </> : null}
        {planName ? `plan “${planName}”` : 'running loans only, no new loans'}
      </p>
    </Link>
  )
}
```

`src/app/(app)/page.tsx`. The dashboard already has `lenders` from `listLenders`, so the context is
read after that `Promise.all`:

```diff
 import { dueThisWeek, interestSummary, overdueSummary } from '@/server/loans/queries.ts'
+import { listPlans, plansById, projectionContext } from '@/server/projections/queries.ts'
+
+import { ProjectionPreview } from './projection-preview.tsx'
@@
     dueThisWeek(user.id),
   ])
+
+  // After the Promise.all on purpose: it reuses `lenders` instead of reading
+  // every ledger a second time (listLenders is the heavy read).
+  const [projection, plans] = await Promise.all([projectionContext(user.id, lenders), listPlans(user.id)])
+  const newest = plans[0] ? (await plansById(user.id, [plans[0].id]))[0] ?? null : null
@@
       <StatTile
         hero
         ...
       />
+
+      <ProjectionPreview ctx={projection} plan={newest?.plan ?? null} planName={newest?.name ?? null} />
```

The implementer places the card where the dashboard layout fits. "After the hero" is a suggestion,
since only the first 80 lines of `page.tsx` were read.

#### Phase 7 — Potential Issues

- **Dashboard load time.** The preview adds two reads (running fundings, history loans) and a few
  milliseconds of arithmetic to the most-opened screen. The dashboard's own comments show it has
  been tuned before (`topBorrowers`). The second `await` is sequential after the first batch, because
  it needs `lenders`. If that turns out to be slow, run the two non-lender reads in the first batch
  and pass `lenders` in only for the final assembly.
- **The demo account** gets the card too, built from its fictional loans. That's correct: scoped by
  `userId`.
- **Proving queries owed before shipping (label-truth).** None could be run here (no `.env`). On the
  real database, run `node .claude/harness/db-ro.mjs --grants`, then:
  1. the sum of `earningsCentavos + adminCutCentavos` over `LoanFunding` on `ACTIVE`, non-deleted
     loans with `dueOn >= today`, AT_END only, for the user, must equal the preview's real-loans-only
     total with a horizon long enough to cover the latest `dueOn`.
  2. The on-time count: due amounts in the window vs live `Payment.paidOn`, sampled on an extended
     loan (must be measured against the moved `Loan.dueOn`), an undone payment, and a weekly loan
     with a gap. Those are the divergent rows the skill names. Confirm the owner's statement that no
     loan is unpaid past its due date, dated.
  3. Re-lend habits, for two or three lenders: total returned (live payments × their share) vs
     principal lent afterwards, by month. Compare with that lender's DEPOSIT rows in the same months
     to see how far deposit-funded lending inflates the "up to" share.
  4. The 6-month capital shares: `SUM(principalCentavos)` per lender on non-deleted, non-continuation
     loans started in the window, against what the page prints.
  5. Record the results under `.claude/reconciliation/projections.md` (the `data-truth` agent's
     place), each with the date it was measured.

**Issues identified:** dashboard read cost; label proofs must be run where the database is reachable.

## 3. Related Files

Read for this plan (reviews in `references/`):

- `src/lib/money/projection.ts`: the scheduling this plan extracts and reuses
- `src/lib/money/split.ts`: `splitLoan`, private `distribute`
- `src/lib/money/floating.ts`: `shortfalls`, `lenderPosition`
- `src/lib/money/interest.ts`, `src/lib/money/weekly.ts`, `src/lib/money/weeks.ts`, `src/lib/money/centavos.ts`
- `src/lib/track-record.ts`: the existing "on time" rule
- `src/server/lenders/queries.ts`: `projectedFloating`, `listLenders`
- `src/server/loans/terms.ts`: `DEFAULT_*_BPS`, `parseRate`
- `src/server/pending/actions.ts`, `src/server/lenders/actions.ts`, `src/server/forms.ts`: action shape
- `src/app/(app)/lenders/[id]/where-the-money-is.tsx`: the existing chart (hand-drawn SVG)
- `src/app/(app)/page.tsx` (lines 1–80), `src/components/shell/nav-items.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261020120000_loan_reminders/`,
  `prisma/migrations/20261105120000_assistant_memory/`, `prisma/manual/2026-10-20-loan-reminders.sql`
- `tests/money/projection.test.ts`
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
- `.claude/skills/label-truth/SKILL.md`

Created: `src/lib/money/forecast-history.ts`, `src/lib/money/forecast.ts`,
`tests/money/forecast-history.test.ts`, `tests/money/forecast.test.ts`,
`prisma/migrations/20261108120000_projection_plans/migration.sql`,
`prisma/manual/2026-11-08-projection-plans.sql`, `src/server/projections/queries.ts`,
`src/server/projections/actions.ts`, `src/app/(app)/projections/{page,plan-form,projection-chart}.tsx`,
`src/app/(app)/projections/loading.tsx`, `src/app/(app)/projection-preview.tsx`.

Modified: `weeks.ts`, `centavos.ts`, `split.ts`, `projection.ts`, three test files, `schema.prisma`,
`nav-items.ts`, `(app)/page.tsx`.

## 4. Follow Ups

### Questions / Clarifications

**All answered or defaulted on 2026-11-08** — see §1.2 for the full list. In short:

- "Reach ₱X": both, user picks (interest from today, or pot size).
- Extended loans: not late; measured against the extended `Loan.dueOn`.
- No allowance for unpaid money.
- Re-lending: per lender, from each lender's own share and lag; default 100% / 1 month, labelled.
- Defaulted: count amounts not pesos; earliest re-lend is next month; FIXED_AMOUNT in split, on-time
  and habits but not the default rate; pretend loans weekly-rate only; Admin-cut view is the cut only;
  shares and habits frozen at today's history; no backup or demo-seed change; keep writing the
  manual SQL file.

Still open (not owner questions, but for whoever implements):

- `MIN_RELEND_CENTAVOS` = ₱1,000 is a judgement call. Change it if the owner prefers.
- Whether "Pot size" should equal the lender page's "Pot total" (Phase 6 issues).

### Issues Found

| Phase | Issue | Severity | Status |
| --- | --- | --- | --- |
| — | `CONVENTIONS.md` still carries its `harness:scaffold` marker, though nearly every section is filled. Out of date as a status, not in content. | Low | Open |
| — | Database not reachable from this session (`db-ro.mjs`: no `.env`). No history figure measured; the label proofs in Phase 7 are owed. | Medium | Open |
| — | Baseline `npm run verify` not run by this session. Establish it before Phase 1 (an earlier log recorded lint noise from plan `references/`, since fixed by ignoring `.claude/**`). | Low | Open |
| 4 | CONVENTIONS.md's list of six date-only columns should gain `ProjectionMove.fromMonth` / `untilMonth`. | Low | Open |
| 5 | Lenders deleted while money is still out are left out of the projection (the same scope as Pot total). | Low | Open |
| 6 | `lenders/[id]/where-the-money-is.tsx` callers colour parts with `--status-good` / `--status-critical`, which looks like it breaks the CONVENTIONS.md "colour means loan state only" rule. Not touched by this plan. | Low | Open |
| 6 | `loan-export.ts` has a bps formatter; the page's local `pct` should use it. | Low | Open |
| — | FEATURES.md doesn't describe Projections. Requirements and the owner's answers (2026-11-08, §1.2) should be added as a FEATURES.md section. | Low | Open |
| 2 | The re-lend share is an upper bound (deposit-funded lending counts as re-lending). Labelled "up to"; measure it in Phase 7 check 3. | Low | Open |
| — | Saved plans not in the backup export or demo seed (owner default). Revisit if wanted. | Low | Deferred |
