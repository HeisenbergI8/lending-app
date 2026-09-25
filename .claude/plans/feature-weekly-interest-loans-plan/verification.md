# Verification: weekly-interest loans feature

**Date:** 2026-09-25
**Scope:** working tree diff (git status) implementing weekly-interest loans, per
`.claude/plans/feature-weekly-interest-loans-plan/implementation-log.md`
**Dependencies reachable:** database is reachable read-only via `db-ro.mjs`, but the migration
adding `Loan.interestCollection`, `Loan.nextDueOn`, `Payment.weekNumber` has NOT been applied
(deliberately, per the hard constraint in this task). No write to any database was performed.
No dev server was started; no page was loaded.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run verify` (typecheck+lint+tests) | PASS | exit code 0; typecheck clean; lint 0 errors / 2 pre-existing warnings in `src/server/auth/actions.ts` (unrelated, matches log's baseline note); tests **475 pass / 0 fail / 101 suites**, matches implementation log's Phase 7 gate figure exactly |
| `npm run build` | PASS | exit code 0; `next build` compiled successfully, all 20 routes listed, no errors |
| unit — feature-relevant test files, run individually | PASS | `node --test tests/money/weekly.test.ts` 64/64; `tests/money/weekly-ledger.test.ts` 8/8; `tests/loans/terms.test.ts` 42/42; `tests/loans/weekly-state.test.ts` 7/7; `tests/loans/loan-where.test.ts` 11/11; `tests/deleted/weekly-payment.test.ts` 5/5. All exit 0. |
| Independent stress test of `src/lib/money/weekly.ts` (not trusting the existing tests) | PASS | script written and run by me: `.claude/plans/feature-weekly-interest-loans-plan/stress-weekly-check.ts`, run via `node .claude/plans/feature-weekly-interest-loans-plan/stress-weekly-check.ts` — **17,224 checks, 0 failures, exit 0**. Covers `weeklySlices`, `weeklySchedule`, `realisedThrough`, `weeklyDueDates`, `nextUnpaidWeek`, `consecutivePaidWeeks`, `releasedOnFunding`, `collectedInstalments` against 5 hand-built awkward-principal loans built through the real `splitLoan` (non-dividing capitals, up to 52 weeks, 3-way funder splits) plus 500 randomised (total, weeks) pairs. Both stated invariants held in every case: every week's per-funder shares sum to that week's total, and every funder's weeks sum to their stored total. |
| `realisedThrough` vs `weeklySlices` agreement on every prefix | PASS | same script, section 3 and the fuzz loop: for every case and every `paid` from 0..weeks, `realisedThrough(total, weeks, paid)` was checked equal to the running sum of `weeklySlices` up to `paid`, including the boundary `paid = weeks` (full total) and `paid = weeks-1` (last, uneven slice excluded). No mismatch across 5 hand cases x 2 totals (earnings, adminCut) x (weeks+1) prefixes, plus 500 fuzz cases x (weeks+1) prefixes. |
| `grep -rn "loanState(.*\.dueOn" src/` returns nothing | PASS | ran the exact command, exit code 1 (grep found nothing), output empty. Cross-checked all 11 `loanState(` call sites separately — all pass `loan.nextDueOn` / `row.loan.nextDueOn` / `funding.loan.nextDueOn`, none pass `.dueOn`. |
| Migration safety read (`prisma/migrations/20260925120000_weekly_interest/migration.sql`) | PASS — cannot destroy or rewrite money | see full statement-by-statement breakdown below. Not applied to any database (confirmed by not running it — no `db:migrate` invoked). |

### Migration read, statement by statement

File: `prisma/migrations/20260925120000_weekly_interest/migration.sql`

1. `CREATE TYPE "InterestCollection"` — new enum type. Additive, no data touched.
2. `ALTER TABLE "Loan" ADD COLUMN "interestCollection" ... DEFAULT 'AT_END', ADD COLUMN "nextDueOn" DATE` — adds two new columns. Postgres 11+ backfills a `DEFAULT` on an added column as a metadata operation, not a table rewrite. No existing column is touched.
3. `UPDATE "Loan" SET "nextDueOn" = "dueOn" WHERE "nextDueOn" IS NULL` — the one UPDATE in the file. It writes only into the brand-new `nextDueOn` column, copying from `dueOn`. `dueOn` itself, and every money column (`capitalCentavos`, etc.), is not written by this statement or any other in the file.
4. `ALTER TABLE "Loan" ALTER COLUMN "nextDueOn" SET NOT NULL` — safe given step 3 populated every row first.
5. `CREATE INDEX "Loan_userId_status_nextDueOn_idx"` — additive index.
6. `ALTER TABLE "Payment" ADD COLUMN "weekNumber" INTEGER` — new nullable column, no backfill needed (NULL already means "the settling payment", which is what every existing row is).
7. `DROP INDEX "Payment_loanId_key"` then `CREATE UNIQUE INDEX "Payment_loanId_settling_key" ON "Payment"("loanId") WHERE "weekNumber" IS NULL` — replaces the old "one payment per loan" unique constraint with a partial one scoped to settling payments. Since every existing `Payment` row has `weekNumber` NULL (just added), this partial index enforces exactly the same uniqueness the old one did over the existing data, so it will not fail on real data — no row is dropped or rewritten, only an index is swapped. Prisma migrations run inside one transaction on Postgres, so there is no window where the constraint is simply absent from a running app's perspective.
8. `CREATE UNIQUE INDEX "Payment_loanId_weekNumber_key" ON "Payment"("loanId", "weekNumber")` — additive; Postgres treats each NULL as distinct so this does not conflict with existing settling rows.
9. `CREATE INDEX "Payment_loanId_idx"`, `CREATE INDEX "Payment_userId_archivedAt_idx"` — additive indexes.

**Conclusion: nothing in this file deletes a row, drops a column, or overwrites an existing money or date column.** The only write is the `UPDATE`, and it only populates the new `nextDueOn` column from the existing `dueOn` column — it does not modify `dueOn`. This matches the log's own claim in Phase 2. I did not run it and did not connect it to any database in a way that could apply it.

## Failures

None found in anything I was able to run. `npm run verify`, `npm run build`, every feature-relevant
test file, and my own independent stress script all pass with 0 failures. The 2 ESLint warnings in
`src/server/auth/actions.ts` are pre-existing per the implementation log's own baseline note and are
not touched by this diff (confirmed by `git diff --stat`, which does not list that file).

## Not Verified — everything behavioural, blocked by the withheld migration

The migration adding `Loan.interestCollection`, `Loan.nextDueOn` and `Payment.weekNumber` has
deliberately NOT been applied to any database, per this task's hard constraint. The Prisma client
generated against the new schema expects those three columns; the live database does not have them.
I did not start the dev server or load any page, because doing so would either hit that mismatch (an
expected, not-a-defect error) or require writing to the database, which was off-limits. Everything
below is genuinely unverified — not passing, not failing, simply not run:

- Creating a weekly-interest loan through the loan form (`src/app/(app)/loans/new/page.tsx`,
  `loan-form.tsx`) and confirming it saves with the right `interestCollection`, `nextDueOn`, and
  per-funder `LoanFunding` rows.
- Collecting a week (`src/server/payments/week-actions.ts` — `markWeekPaid`) and confirming: the
  find-then-write reuse of an archived row works on a re-collected week, the "refuse to settle while
  an earlier week is unpaid" guard fires, and floating/earned figures move by exactly one week's
  slice.
- Undoing a collected week (`undoWeekPaid` — moves `nextDueOn` back to that week) —
  `tests/deleted/weekly-payment.test.ts` proves the pure logic, but the actual Recently Deleted
  screen flow and the database write were not driven.
- The weekly schedule rendering (`src/app/(app)/loans/[id]/weekly-schedule.tsx`) — collapsing to
  collected weeks + next three, the `missingProof` flag per week, and that the schedule agrees with
  what the stress script computed for a real stored loan.
- The Active Loans list and loan detail page showing the correct date after the Phase 6 fix (reading
  `capitalDueOn` instead of `dueOn` in the edit form and loan header) — this was the worst bug the
  implementer found in their own work and it has no automated test; only a human loading the edit
  screen on a real weekly loan can confirm it.
- The conversion flow: `convert-to-weekly.tsx` button visibility (`getLoan().convertible`),
  `convertToWeekly`'s find-then-write behaviour on a loan converted, undone, and reconverted.
- Dashboard and lender-page figures actually moving when a week is collected — the pure ledger math
  is proven in `tests/money/weekly-ledger.test.ts` and my own script, but nobody has watched a real
  screen's numbers change after a real collection.
- The two PDFs (loan/lender reports via `src/server/reports/document.tsx`) — CONVENTIONS.md requires
  rendering to an image and looking at it because the peso glyph fails silently in the standard PDF
  fonts. The implementation log says explicitly this has not been done. I did not do it either; it
  cannot be done without data to report on, and even a smoke render would need the app running
  against a real (or seeded) database.
- The loans search screen behaviour named in "Follow Up 6" of the log (date range vs. status chips
  reading different date fields) — recorded there as still open, not something I can resolve.

### Checklist for the owner, once the migration is applied

1. Run `npm run db:migrate` deliberately (it touches the real loan book) and confirm it completes
   without error.
2. Create one weekly-interest loan with a single funder and one with 2-3 funders on awkward
   (non-round) amounts; confirm the created `LoanFunding` rows and schedule match what the loan form
   shows before submit.
3. Collect week 1, then week 2; confirm the loan page's schedule, floating funds, and lender "Earned"
   figures move by exactly one week's slice each time, and that the numbers match hand arithmetic.
4. Try to settle the loan (mark fully paid) while a week is still unpaid — confirm it is refused with
   a clear message.
5. Undo a collected week and confirm the next-due date moves back to that week, not to the week after
   it.
6. Open the Edit Loan form and the loan detail header on a running weekly loan — confirm the seeded
   due date is the capital due date, not the next unpaid week's date (this is the bug the
   implementer found and fixed; it is the single highest-value thing to re-check by hand).
7. Convert an AT_END loan to weekly, undo a week, and convert again — confirm no duplicate-row error
   from the archived-row reuse logic.
8. Look at the dashboard's "Total interest" note and a lender's "Earned" figure before and after
   collecting a week on a real loan — confirm the words "back" / "Earned" still read true.
9. Generate both PDFs (loan report, lender/backup report) for a loan or lender with at least one
   weekly loan, render to an image, and visually confirm every peso amount shows "₱" and not "±".
10. Check the loans search screen for whether the date range and status chips read consistent date
    fields (Follow Up 6, still open per the log).
