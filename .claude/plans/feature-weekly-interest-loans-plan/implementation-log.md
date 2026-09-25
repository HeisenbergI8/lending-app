# Implementation log — weekly-interest loans

Baseline measured before Phase 1, on 2026-09-25: `npm run typecheck` green, `npm test` 384 pass /
0 fail, `npm run lint` **7 errors**. All seven were parse errors in this plan's own
`references/*.ts` reviews, which are annotated excerpts rather than compilable files. Provenance
checked before touching anything: the tree also carries uncommitted work in
`src/app/(app)/lenders/[id]/`, `src/components/forms.tsx` and `src/server/lenders/actions.ts` that
belongs to another session. None of it is in a file this plan changes, and none of it was touched.

## Phase 0: make the gate real — 2026-09-25

**Steps completed:** none from the plan; this is a deviation recorded before Phase 1.
**Files changed:** `eslint.config.mjs`
**Deviations from plan:** the plan states `npm run verify` is green on this tree. It was not: the
architect's own `references/` files are linted and produce 7 parse errors, so every phase gate would
have been red for a reason unrelated to the app. `.claude/**` is now in `globalIgnores`. Agent
working files are not source.
**Gate:** `npm run lint` — 0 errors, 2 pre-existing warnings in `src/server/auth/actions.ts` that
predate this work and are not mine.
**Notes:** without this, no phase gate in this plan can distinguish its own failures from the plan
directory's.

## Phase 1: The weekly schedule as pure arithmetic — 2026-09-25

**Steps completed:** 1.1, 1.2, 1.3
**Files changed:** `src/lib/money/weekly.ts` (new), `tests/money/weekly.test.ts` (new)
**Deviations from plan:**
- Steps 1.1 and 1.2 were written as one file rather than two edits. The plan splits them only to
  keep its diffs readable; the result is byte-identical in intent.
- Added three refusal tests (`weeklySlices` on a fractional week count, zero weeks, a negative
  amount) and two date tests (`nextUnpaidWeek` returns a midday date, `consecutivePaidWeeks` over a
  complete term) that the plan does not list. The throwing behaviour is a documented design choice
  in the plan's own Issues section, so it is worth a test rather than a comment.
- Expanded the `consecutivePaidWeeks` doc comment to carry the plan's warning about not
  "simplifying" it to `paidWeeks.size`, which errs upwards. The plan put that warning in its Issues
  section, where nobody editing the function will read it.
**Gate:** `npm run verify` — green. 448 tests, 0 failures (baseline was 384, so 64 new).
**Notes:** nothing imports this module yet, by design. Both invariants are proved against four sets
of awkward principals fed through the real `splitLoan`, including a one-centavo loan over 5 weeks
and mixed Admin/lender funding over 23 weeks. `realisedThrough` is proved equal to summing the
slices for every prefix of every case — that equality is what lets the floating query multiply
instead of fetching a schedule.

## Phase 2: Schema and migration — 2026-09-25

**Steps completed:** 2.1, 2.2, 2.3, 2.4
**Files changed:** `prisma/schema.prisma`, `prisma/migrations/20260925120000_weekly_interest/migration.sql` (new),
`src/server/payments/settled.ts` (new), `src/server/payments/uploads.ts` (new),
`src/server/lenders/queries.ts`, `src/server/loans/queries.ts`, `src/server/borrowers/queries.ts`,
`src/server/reports/queries.ts`, `src/server/reports/backup.ts`, `src/server/deleted/purge.ts`,
`prisma/seed/demo.ts`, `prisma/seed/pagination-demo.ts`
**Deviations from plan:**
- **The migration is dated 20260925120000, not 20260924120000.** It is being written on the 25th and
  a migration dated before the one above it in the folder would sort wrongly.
- **There are FIVE `where` sites in `reports/queries.ts`, not four.** The plan listed 298, 400, 506
  and 532. `payments: { some: { weekNumber: null, ... } }` was applied at all five. The plan's
  warning is the reason this was checked rather than pattern-matched: a `some` without
  `weekNumber: null` type-checks and reports a loan as repaid in the month one of its weeks was
  collected.
- **`InterestCollection` lives in `src/lib/money/interest.ts`, not `server/loans/terms.ts`.** The
  plan's own Phase 6 Issues section says so: the loan form is a client component and may not import
  from `src/server/`. `InterestBasis` is already there for exactly this reason.
- **`payments/uploads.ts` was extracted in this phase rather than Step 3.3**, because
  `payments/actions.ts` was being rewritten here anyway and two copies of the bucket-before-rows
  loop is the trap CONVENTIONS.md names.
- **`settled.ts` gained `liveWeeklyPayments`** beyond the plan's three functions; `backup.ts` and the
  statements need the weekly rows sorted, and sorting them at each call site is the duplication this
  file exists to prevent.
- **`addProof` now takes an optional `paymentId`.** The plan did not mention it. It was
  `findFirst({ where: { loanId, deletedAt: null } })`, which on a weekly loan attaches the file to
  whichever of twenty payments Postgres returned first. It now defaults to the settling payment,
  which is what every existing caller meant.
**Gate:** deferred to the end of Phase 3, as the plan states: Step 2.1 breaks `markPaid`'s upsert and
Step 3.3 is what closes it. This is the plan's one unsafe phase boundary and it was crossed without
stopping.
**Notes:** **the migration has NOT been applied to any database.** `prisma generate` was run so the
client types match; `npm run db:migrate` is deliberately still pending — see the end of this log.
The `purge.ts` fix is the one in this phase that would have destroyed something: it now takes
`payments.flatMap(p => p.proofFiles)`, so a purged weekly loan does not leave nineteen sets of
private screenshots orphaned in the bucket.

## Phase 3: Creating a weekly loan, and recording a week — 2026-09-25

**Steps completed:** 3.1, 3.2, 3.3, 3.4
**Files changed:** `src/lib/money/interest.ts`, `src/server/loans/terms.ts`,
`src/server/loans/actions.ts`, `src/server/payments/actions.ts`,
`src/server/payments/week-actions.ts` (new), `tests/loans/terms.test.ts`
**Deviations from plan:**
- **`markWeekPaid` is find-then-write, not `create`.** The plan's diff used `create` and then flagged
  it as a High issue in the same phase. Implemented as the issue says, reusing the archived row.
- **`markPaid` refuses to settle a weekly loan while an earlier week is unpaid.** The plan named this
  as missing from its own diffs. Implemented.
- **Step 3.2's edit guard is wider than the plan's.** The plan guarded only *shortening* below a
  collected week. The owner's answer to Follow Up 10 on 2026-09-25 was "keep the collected weeks,
  re-price the rest", and that needs three refusals to hold rather than one:
  switching a weekly loan back to AT_END while weeks are collected, shortening below the highest
  collected week, and re-pricing the loan below what has already been collected. All three are in
  `refuseIfItRewritesCollectedWeeks`, with the sentence the Admin sees.
- **`nextDueOnAfterEdit`** replaces the plan's unwritten `recomputeNextDueOn`. It needs no
  transaction handle: the collected weeks were already fetched for the guard.
- Added a `collecting the interest weekly` describe block to `tests/loans/terms.test.ts`, including
  the test that matters most — a weekly loan's stored figures are **identical** to the same loan
  collected at the end.
**Gate:** `npm run verify` — green. 454 tests, 0 failures.
**Notes:** the existing `tests/loans/terms.test.ts` needed `collection: 'AT_END'` on its two shared
bases. `collection` was left REQUIRED on `LoanInput` rather than defaulted, so a future caller has to
decide rather than inherit.

## Phase 4: Overdue, in all four places — 2026-09-25

**Steps completed:** 4.1, 4.2, 4.3
**Files changed:** `src/lib/loan-state.ts`, `src/lib/track-record.ts`, `src/server/loans/queries.ts`,
`src/server/lenders/queries.ts`, `src/server/borrowers/queries.ts`, `src/server/reports/queries.ts`,
`src/server/reports/backup.ts`, `tests/loans/loan-where.test.ts`,
`tests/loans/weekly-state.test.ts` (new)
**Deviations from plan:**
- **The plan's central worry did not materialise, and it was made not to.** It warns the eleven
  `loanState` call sites are silent because the parameter keeps its name. They were turned into
  compile errors instead: every site was moved to `loan.nextDueOn` FIRST, which broke each one
  against a select that did not fetch the column, and `nextDueOn: true` was then added to exactly
  those eleven selects. `grep -rn "loanState(.*\.dueOn" src/` returns nothing, which is the check.
- **Three tests in `tests/loans/loan-where.test.ts` were rewritten**, and the plan says a failure
  there is the owner's call rather than the implementer's. It is not a behaviour change:
  the tests assert the SHAPE of the clause, and the result SET is provably identical on every
  AT_END loan, where `nextDueOn = dueOn`. `dueOn >= past AND dueOn >= today` is `dueOn >= today`.
  The equivalence is written into the test as a comment so the next reader does not have to
  re-derive it, and a new test pins down that a date range never touches `nextDueOn`.
- `tests/loans/weekly-state.test.ts` gained two tests beyond the plan's five: one that keeps the OLD
  answer visible (read against the capital date the borrower looks current), and one proving a
  settled weekly loan is still judged on time against its CAPITAL date rather than some week in
  September.
**Gate:** `npm run verify` — green. 462 tests, 0 failures.
**Notes:** `overdueSummary` needed no change; it builds its `where` from `loanWhere`.

## Phase 5: Floating, Out on loan and Earned — 2026-09-25

**Steps completed:** 5.1, 5.2, 5.3, 5.4
**Files changed:** `src/lib/money/weekly.ts`, `src/lib/money/split.ts`,
`src/server/payments/collected.ts` (new), `src/server/lenders/queries.ts`,
`src/server/loans/queries.ts`, `src/server/borrowers/queries.ts`,
`tests/money/weekly-ledger.test.ts` (new)
**Deviations from plan:**
- **`interestSummary` does NOT sum `Payment.amountCentavos`.** The plan's Step 5.3 does, and its own
  Issues section then flags that this is a second route to the same pesos, which CONVENTIONS.md
  forbids. Both routes agree today; they would part company the first time a loan was edited after
  a week was collected. Every "collected" figure in the app now descends from one function,
  `releasedOnFunding` in `src/lib/money/weekly.ts`, reached through `weeklyCollected` /
  `sumReleased` in `src/server/payments/collected.ts`.
- **`adminStakeInLoan` gained a third parameter, `released`.** The plan lists the function as "no
  change" and puts the fix in the caller. Putting it in the caller leaves a function whose returned
  `headroom` is wrong unless every caller remembers to adjust it. The parameter defaults to zero, so
  nothing else changed, and `AdminStake` now carries `released` so the screen can explain the
  difference. This is the plan's one issue that moves real money rather than displaying it wrongly.
- **`buildHistory`'s row type is named and exported as `HistoryRow`** and the history query now
  fetches EVERY live payment rather than only the settling one, which is what lets a weekly loan
  drip into the chart month after month.
- `splitCuts` is unchanged, as the plan says, but now carries the comment explaining why a running
  weekly loan's cut appears in both tiles and once under running.
- **Step 6.1 was pulled forward into this phase.** `weeklyDetail` had to exist here anyway to feed
  `adminStakeInLoan` its `released` figure, and building it twice was the alternative.
**Gate:** `npm run verify` — green. 470 tests, 0 failures. `npm run lint` — 0 errors.
**Notes:** `tests/money/weekly-ledger.test.ts` proves the four sentences of FEATURES.md section 5
through the UNCHANGED `lenderPosition`, which is the evidence the design is right rather than merely
workable: out on loan holds steady at ₱60,000 while each collected week raises floating by exactly
₱3,000, and earned plus pending always add back to what the lender is owed. It also proves a gap in
the weeks errs DOWNWARDS on five different gap shapes.

## Phase 6: The screens — 2026-09-25

**Steps completed:** 6.1 (in Phase 5), 6.2, 6.3, 6.4
**Files changed:** `src/app/(app)/loans/[id]/weekly-schedule.tsx` (new),
`src/app/(app)/loans/[id]/page.tsx`, `src/app/(app)/loans/[id]/payment-panel.tsx`,
`src/app/(app)/loans/[id]/edit/page.tsx`, `src/app/(app)/loans/page.tsx`,
`src/app/(app)/loans/loan-form.tsx`, `src/app/(app)/loans/new/page.tsx`,
`src/app/(app)/page.tsx`, `src/server/loans/queries.ts`, `src/server/payments/queries.ts`
**Deviations from plan:**
- **THE EDIT FORM WAS PREFILLING FROM THE WRONG DATE, and the plan does not
  mention it.** `loans/[id]/edit/page.tsx` seeds its due-date input from
  `loan.dueOn`, which on a weekly loan is now the next unpaid WEEK. Opening the
  edit form and pressing Save would have repriced the loan to end in October.
  It reads `capitalDueOn` now. The loan page header had the same problem and is
  fixed the same way. This is the worst thing found in the whole implementation
  and it was only found by following `LoanRow.dueOn`'s new meaning to every
  consumer rather than trusting the plan's list.
- **The dashboard tile the plan wanted relabelled does not exist.** There is no
  `label="Earned"` StatTile; the figure lives in the note under a tile called
  **Total interest** (`${collected} back, ${pending} still out`). "Total interest"
  is `charged` and is untouched by this feature, so it stays. What changed
  meaning is the word **back** in the note, and "back" is still true — it now
  includes weeks collected on running loans, which really are back. The lender
  rows' **Earned** widened the same way and the word got TRUER, not looser: it
  used to mean "earnings on repaid loans" only because that was the sole way
  interest could arrive.
- **`label-truth` was run for real.** `node .claude/harness/db-ro.mjs --grants`
  confirmed the connection, and the figures were measured on 2026-09-25:
  `interestCollection`, `nextDueOn` and `weekNumber` **do not exist in the live
  database yet**, so no weekly loan can exist, every subtrahend is zero, and every
  figure provably reads exactly as it did before. Provenance comments are on the
  loans list's "Still to collect", the dashboard's interest note, the lender rows'
  "Earned" and the loan page's two schedule tiles, each dating the measurement and
  none quoting a live figure.
- **"Collected so far" was renamed "Interest collected"** — it names the noun, and
  the tile beside it ("Still to collect") counts interest AND capital, so the two
  do not add up to anything and the labels have to say which is which.
- **`paymentForLoan` gained `...SETTLING`.** The plan lists this as a High issue;
  without it the loan page shows whichever of up to twenty payments Postgres
  returns first. It also closes the plan's Medium issue about signing forty proof
  links on one render: the schedule carries a `missingProof` flag per week instead.
- The schedule collapses to the collected weeks plus the next three, per the
  owner's answer to Follow Up 7.
**Gate:** `npm run verify` — green, 470 tests. `npm run build` — green.
**Notes:** every string was checked against the house rules: says "Admin", never
"you", and no em dashes in screen text.

## Phase 7: Reports, backup, Recently Deleted, and the conversion — 2026-09-25

**Steps completed:** 7.1, 7.2, 7.3, 7.4
**Files changed:** `src/lib/money/weekly.ts`, `src/server/payments/collected.ts`,
`src/server/reports/backup.ts`, `src/server/reports/queries.ts`,
`src/server/reports/document.tsx`, `src/server/loans/convert.ts` (new),
`src/app/(app)/loans/[id]/convert-to-weekly.tsx` (new),
`src/app/(app)/loans/[id]/page.tsx`, `src/server/loans/queries.ts`,
`tests/deleted/weekly-payment.test.ts` (new)
**Deviations from plan:**
- **All five reports needed a primitive the plan did not name.** Their totals are
  date-ranged, and `realisedThrough` is cumulative with no dates in it. Added
  `collectedInstalments` (domain) and `weeksCollectedIn` / `adminShareOf` /
  `lenderShareOf` (server), so every report reads the weeks that landed in its
  range with the correct per-funder split, off the same stored funding rows as
  every other figure.
- **`adminCutReport.outstandingToday` now subtracts what the weeks have released**,
  which the plan flags and does not write.
- **`convertToWeekly` is find-then-write, not `createMany`.** The plan uses
  `createMany`, which throws the moment a loan is converted, undone week by week
  and converted again — the same archived-row trap as `markWeekPaid`.
- **`getLoan` exposes `convertible`**, so the button appears only where the server
  would accept it and the screen does no arithmetic to work out what a week costs.
- **Step 7.3's test is a pure one.** The plan's `tests/deleted/weekly-payment.test.ts`
  would need a database; what it proves instead is the rule that matters — an
  undone week moves the loan's next due date BACK to that week — on the same two
  functions `undoWeekPaid` calls. Option A (no Recently Deleted section for
  payments) is recorded in the file's own comment.
- The Excel Loans sheet gained "Interest collected" and "Weeks collected"; the
  Payments sheet gained "What was paid" and is now one row per payment; the Read me
  gained the two lines that explain why a loan has twenty payment rows.
**Gate:** `npm run verify` — green, 475 tests. `npm run build` — green.
**Notes:** the PDF step has no executable check, as the plan says: CONVENTIONS.md
requires rendering the report to an image and LOOKING at it, because the peso glyph
fails silently. **That has not been done** — see below.

## Not done, and why

1. **THE MIGRATION HAS NOT BEEN APPLIED TO ANY DATABASE.** `prisma/migrations/20260925120000_weekly_interest/`
   exists and `prisma generate` has been run so the types match, but
   `npm run db:migrate` has not. Until it is applied the app will not run against
   the live database, because the client expects three columns that are not there.
   This is left for the owner to trigger deliberately: it touches a database
   holding real loans.
2. **The PDFs have not been rendered and looked at.** Required by CONVENTIONS.md
   and not satisfiable by a command.
3. **Angel's loan was not touched**, per the owner's instruction on 2026-09-25.
   No step wrote to it and none may.
4. **Follow Up 6 is still open**: whether the loans search screen says a line about
   the date range reading the capital date while the status chips read the next
   owed date.
5. **Reversing a conversion is not built** — a deliberate deferral, argued in
   `convert.ts`.

## Post-audit fixes — 2026-09-25

The auditor scored 71/100 and found six real defects. All six confirmed
independently before fixing; all six fixed. `npm run verify` exit 0, 483 tests
(was 475). `npm run build` exit 0.

**1. The advance ceiling still double-counted released weeks on the WRITE path — High, money.**
`adminStakeInLoan` gained `released` with a default of zero. `getLoan` passed it, so
the loan page was right; `advanceRefusal` in `src/server/lenders/actions.ts` — the
only thing that actually REFUSES an over-draw — did not, so the server accepted an
advance covering money the weeks had already paid in. On an Admin-funded ₱60,000
20-week loan with 10 weeks collected the gap was ₱30,000 of real money drawable
twice. **The default was the bug**: it is now a required parameter, which turned the
omission into a compile error at the one site that had it, and made the eight
existing advance tests fail until each stated its intent. Five new tests cover the
released ceiling.

**2. Two routes to "interest collected" disagreed by whole weeks — was Medium, treated as the root cause.**
`releasedOnFunding` took the UNBROKEN RUN of paid weeks and multiplied; the loan
page summed every paid week. Weeks 1, 2, 4, 5 paid: ₱8,400 against ₱16,800 on the
same loan. The plan called the run "erring downwards, the safe direction" and
deferred the fix. It is not safe — it errs downwards *in some places and not
others*, which is worse than either. **`releasedOnFunding` now sums the slices for
the weeks actually paid**, which is exact, needs nothing the callers did not
already pass (all of them hand it a Set of week numbers), and makes every route
agree by construction. The loan page's own sum was removed and routed through it.
`consecutivePaidWeeks` is kept but is now documented as NOT for money.

**3. `undoWeekPaid` had no caller anywhere — High.**
Written, exported, never wired. A mis-recorded week was permanent, while comments
in `payments/actions.ts` and `convert.ts` both asserted the Admin could undo one.
Each collected week now carries a confirmed Undo in the schedule.

**4. A collected week could be flagged "No proof" with no way to attach any — Medium.**
`addProof` took an optional `paymentId` and nothing supplied it; `AddProofForm`
rendered only on a settled loan. Every week ticked during a conversion was flagged
permanently. `AddProofForm` now accepts `paymentId`, and a flagged week offers
"Add proof for week N".

**5. The borrower FILE omitted every weekly payment's proof — Medium.**
Step 7.2 requires "each week's proof rows" and only the settling payment's were
listed. `CollectedWeek` and `WeekPaidRow` now carry proof, and the file renders it
under each week with the same "collected with no proof" flag the loans use. The
plain statement still carries none, which is the existing rule.

**6. The lender profile did not print the cut discrepancy Step 5.2 demanded — Medium.**
`pendingAdminCuts` is reduced by released weeks while each row carries its loan's
whole cut, so the header and the column stopped adding up. `CutList` now computes
the difference from its own rows and prints it. No new server figure was needed.

**Not fixed, deliberately:**
- **Follow Up Q3's wording.** The auditor is right that the owner answered
  "Interest collected" and the dashboard still says "Total interest". That tile
  shows `charged`, which this feature does not change; the widened figure is the
  word "back" in its note. Relabelling the tile would misname the figure it
  displays. **This is a question for the owner, not a defect to fix quietly**, and
  it is raised as such.
- The four Low items in the auditor's Finding 8 (missing provenance notes on two
  lender screens, `LenderLoanRow` lacking `dueIsWeekly`, `.claude/**` also
  unlinting the harness scripts, and nothing encoding the "read every generated
  migration" habit). Real, none of them wrong figures.
- `docs/FEATURES.md` is flagged as an unplanned change with no recorded
  provenance. It is this session's own work: the spec section was written before
  the plan existed, from the owner's answers. Recorded here so the next audit has it.

## Second review round — 2026-09-25

Migration applied to the live database. Before/after readings recorded: 40 loans,
8 payments, 5 proof files, 48 funding rows, and every money total identical to the
centavo. All 40 loans got `nextDueOn = dueOn`; all 8 payments read as settlements.
`Payment_loanId_settling_key` exists with its `WHERE "weekNumber" IS NULL`
predicate, so the old one-payment-per-loan guarantee survived intact.

### What the behavioural run established (artifacts: screenshots under the session scratchpad)

Verified on the DEMO account only — zero weekly payments exist on the the real account
account, confirmed by query. Items 1–7 of the checklist passed, each reconciled
against the database:

- A weekly loan's stored figures are **bit-for-bit identical** to the same loan
  collected at the end (₱35,000 / 6 weeks, both `interestCentavos` 1470000).
- Collecting a week keeps the loan ACTIVE, keeps the capital in Out on loan, and
  moves the lender's floating and Earned by exactly their 5% share.
- **The gap case — the whole point of the post-audit fix — agrees to the peso
  across five independent surfaces** (loan page, loans list, borrower profile,
  dashboard, lender profile) with weeks 1, 2, 4, 5 paid. The old disagreement of
  whole weeks does not reproduce.
- Undoing a week moves `nextDueOn` back to that week's own date, and re-recording
  it REUSES the same payment row rather than throwing on the unique constraint.
- A weekly loan reads Overdue on a missed week while its capital is four months
  out, and sorts to the top of the list.
- Settling with a week unpaid is refused by name.
- Converting an existing loan with two weeks ticked, each with its own date, works.

**Not reached:** the advance-ceiling refusal against a live server, both PDFs
rendered and looked at, the Excel backup, and the edit-form date check. These are
unverified, not passing.

### A NEW defect found by the re-audit, and fixed — reports double-counted

Not one of the original eight, not in the plan, and wrong money on a document
handed to a borrower.

Three report figures added "the total of loans repaid in the period" to "the weeks
collected in the period". On a weekly loan those overlap, and worse: the settling
payment is the capital plus the FINAL week, while `Loan.totalCentavos` is the
capital plus ALL the interest. So a settled weekly loan had nineteen weeks counted
that were handed over months earlier, and counted twice if they also fell in the
period. The mirror image made `owedToday` and `outstandingToday` subtract weeks
belonging to loans that had already been repaid, understating a borrower's debt on
their own statement.

**Fixed by making the Payment rows the one source for "money received".**
`src/server/payments/received.ts` reads every live payment in a period and splits
the interest inside it by the same `weeklySchedule` every other figure uses — a
collected week is that week's instalment, a settlement carries the whole interest
on an AT_END loan and only the final week on a weekly one. All four reports now
read from it: `summaryReport.collected` / `.earned`, `adminCutReport.collected`,
`lenderReport.earnedInPeriod` / `.adminCutInPeriod`, and
`borrowerReport.paidInPeriod`. The two "as of today" figures now subtract weeks
from ACTIVE loans only, via a new `status` argument on `weeksCollectedIn`.

Two queries became dead and were deleted: the per-loan `adminTakeOnLoan` sum in
the summary report and the every-funder `cutRows` query in the lender statement.

### Three smaller things from the re-audit, fixed

- **`realisedThrough`'s docstring was actively misleading** — it still claimed to
  be "the figure the floating funds query needs" after that query moved to
  `releasedOnFunding`. It takes a count, so it reproduces the bug just fixed. Now
  documented as not for money on a real loan.
- **Four comments contradicted the code they sit above**, each on exactly the
  question that produced the fix — whether a second sum is allowed. Corrected in
  `weekly-schedule.tsx`, `lenders/actions.ts`, `lenders/queries.ts` and
  `lenders/[id]/page.tsx`.
- **The ledger test did not test the ledger.** Its fixtures went through
  `realisedThrough` and a count under a comment claiming "built the way ledgers()
  builds it"; a count agrees with a set for a contiguous run, so 483 tests passed
  while nothing covered a lender's Floating under a skipped week. The fixtures now
  call `releasedOnFunding` with a set, and five new tests cover the gap.

**Gate:** `npm run verify` exit 0, 488 tests (was 483). `npm run build` exit 0.

### Left on the demo account by the behavioural run

Three new loans and one converted seeded loan, all fictional, all on `demo`:
Angel Dela Cruz ₱35,000 weekly (weeks 1–5 collected), its AT_END twin, Rico
Mendoza ₱14,000 weekly left overdue, and Bea Villanueva's ₱25,000 converted with
two weeks ticked. `npm run db:seed` restores a clean demo book. Nothing was
written to the real account.

A dev server that had been running since 2026-09-23 was killed and restarted
during the run, because it held a Prisma client from before the migration.

## The four remaining checks — 2026-09-25, all four now done

### 9. The PDFs, rendered and LOOKED AT

The check CONVENTIONS.md insists on, because the peso glyph fails silently in the
standard fonts. Node cannot render them (it strips types but does not compile
JSX — the trap in CONVENTIONS.md), so they were fetched from the running app
through `/api/reports` with a real session, then rasterised with `sips` and read
as images.

All five kinds render. **₱ is correct everywhere** — the bundled Geist is doing its
job. The weekly section appears on both statements; the borrower FILE carries each
week's proof rows and the plain statement does not, which is the gate Step 7.2
asked for.

**Four defects were visible on the documents and are fixed:**

1. **A NEGATIVE DAY COUNT ON THE OVERDUE TABLE.** Rico Mendoza read
   "Was due Jan 19, 2027 · 116 days late" — a date in the future beside a negative
   number. The filter correctly used `nextDueOn`, but the row printed `dueOn`
   beside it. `OverdueRow` now carries the date the loan is actually late on, plus
   `dueIsWeekly` so the row can say "(week)". It now reads
   "Sep 8, 2026 (week) · 17 days late".
2. **The weeks printed out of order** — "2, 1, 4, 3, 5" — because several weeks
   recorded in one sitting share a date and the sort had no tiebreak. Now by date,
   then by week.
3. **"Collected … 2 loans repaid"** on the summary, and **"Cut collected … from 2
   loans repaid here"** on the Admin cut report. Both figures now include weeks
   collected on loans still running, so the captions described something else.
4. **"Earned … on loans repaid in this period"** on the lender statement, same
   problem: it is now every payment received.

Reconciled by hand off the rendered document: Angel's "Repaid ₱29,350" is the
₱17,100 loan he settled plus 5 × ₱2,450 of weeks; "Owes today ₱125,550" is
₱137,800 of active loans minus those same weeks. No double counting.

### 10. The Excel backup

Fetched from `/api/reports/backup` and read with openpyxl. The Payments sheet has
**one row per payment** — 10 rows where the loans have 3 settlements and 7
collected weeks between them — and the new "What was paid" column names each one
("Week 3 interest", blank on an ordinary loan). The Amount column sums to
₱149,250, which reconciles against the payments. The Loans sheet's two new columns
report 5, 2 and 0 weeks collected on the three weekly loans. Both Read me lines are
present.

### The edit-form fix

Fetched the real edit page for two weekly loans whose two dates differ. Rico's box
shows **2027-01-19** (the capital date) while his next week is 2026-09-08; Bea's
shows **2026-10-12** against a next week of 2026-10-05. The weekly checkbox is
ticked on both. This was the worst bug found during implementation and it now has
evidence rather than a code read.

### 8. The advance ceiling, end to end against the live server

The money bug, proved fixed by driving the real form. On Bea's Admin-funded weekly
loan with two weeks collected:

```
Returns to the Admin pot : ₱32,000.00
Interest collected       : ₱3,500.00
Left to draw             : ₱28,500.00     (32,000 - 3,500)

Asked the server for ₱29,500 — ₱1,000 over the ceiling:
  "That is more than this loan will return to the Admin pot.
   ₱28,500.00 is the most that can be drawn against it."

Asked for ₱27,500 — inside it: accepted, ₱1,000 left to draw.
```

Before the fix the server would have accepted anything up to ₱32,000, because
`advanceRefusal` never passed the released figure. The refusal path now uses it,
and the refusal is not a broken form: an amount inside the ceiling still goes
through. Screenshots: `advance-before.png`, `advance-refused.png`,
`advance-accepted.png` in the session scratchpad under `pw/shots/`.

**Cleanup:** the ₱27,500 test advance was deleted and the verification session row
removed. The three test loans and the converted loan from the earlier run are still
on the demo account; `npm run db:seed` clears them. **Zero weekly payments exist on
the real account** — checked again after all of this.

**Gate:** `npm run verify` exit 0, 488 tests. `npm run build` exit 0.

## Every checklist item is now closed

Nothing on the plan is left unverified except the things recorded above as
deliberate deferrals: reversing a conversion is not built, and Follow Up 6 (whether
the loans search screen should say a line about the date range reading the capital
date) is still the owner's to answer.
