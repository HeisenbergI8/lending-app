# Implementation log — step 8

## Phase 1: filter in the server layer — 2026-09-21

**Steps completed:** 1.1 pure filter module, 1.2 filtered query
**Files changed:** `src/lib/loan-filter.ts` (new), `src/server/loans/queries.ts`,
`src/lib/money/weeks.ts`, `src/server/forms.ts`, `src/app/(app)/loans/loan-form.tsx`
**Deviations from plan:** `parseCalendarDate` / `toDateInput` added to `money/weeks.ts` rather than
written a third time. The same "2026-09-21" parse — including the `new Date(2026, 1, 31)` is 3 March
check — already existed in `server/forms.ts` and again in `loan-form.tsx`; the URL is the third
caller, so both were pointed at the shared one.
**Gate:** `npm run typecheck` — green.
**Notes:** the status filters are the loan states, so Active means running and not late; overdue is
`status = ACTIVE AND dueOn < today`, never a column. A query that parses as money searches the
amount (capital or total) instead of names.

## Phase 2: search on the loans list — 2026-09-21

**Steps completed:** 2.1 search form, 2.2 filtered list and its empty state
**Files changed:** `src/app/(app)/loans/search-form.tsx` (new), `src/app/(app)/loans/page.tsx`
**Deviations from plan:** none.
**Gate:** `npm run typecheck` — green.
**Notes:** a GET form, so it is a server component, stays out of the browser bundle and works with
no JavaScript. The status chips are links, not radios — one tap, and tapping the one already on
clears it. Under a search the tiles describe the matches rather than the whole book; the subtitle
says "N matches" so the two cannot be confused.

## Phase 3: dashboard to spec — 2026-09-21

**Steps completed:** 3.1 the four figures, 3.2 lender pots across the top, 3.3 borrowers with ratings
**Files changed:** `src/app/(app)/page.tsx`
**Deviations from plan:** the old "Due next" table came off the dashboard. FEATURES §8 puts the
lenders and the borrowers on this screen, and keeping a third list as well made the home screen a
scroll rather than a glance — the Overdue tile now links straight to `/loans?status=overdue`, which
answers "who do I chase" in one tap and sorts by due date anyway.
**Gate:** `npm run typecheck` — green.
**Notes:** every figure is summed from `listLenders` / `listBorrowers` / `listLoans`, never from a
separate dashboard aggregate — a second way of adding up the same money is a second answer waiting
to disagree. Admin earnings come from the `isSelf` lender's position, so there is no admin branch.

## Phase 4: tests and docs — 2026-09-21

**Steps completed:** 4.1 tests, 4.2 docs
**Files changed:** `tests/loans/loan-filter.test.ts` (new), `tests/money/weeks.test.ts`,
`docs/ARCHITECTURE.md`, `README.md`
**Deviations from plan:** none.
**Gate:** `npm run verify` — green, 256 tests (was 237). `npm run build` — green.
**Notes:** every filter combination was also run against the live demo account through
`listLoans`: 8 loans split 4 active + 1 overdue + 3 paid with no overlap, "30000" found both
₱30,000 loans, "angel cruz" found all three of Angel Dela Cruz's.

## Phase 5: audit fixes — 2026-09-21

**Steps completed:** not planned — raised by the auditor after phase 4
**Files changed:** `src/app/(app)/page.tsx`, `src/server/loans/queries.ts`,
`tests/loans/loan-where.test.ts` (new)
**Deviations from plan:** none — these are corrections.
- **Real bug.** FEATURES §10 asks how many BORROWERS are overdue; the tile was counting overdue
  loans. One person late on two loans read as two people to chase. It now counts distinct
  borrowers, with the loan count and the unpaid total in the note.
- `loanWhere` is exported and tested (10 cases): account scoping, overdue-is-not-a-column, and the
  rule that `status=active` plus a `from` date keeps whichever start date is later rather than
  overwriting one bound with the other. That translation was the riskiest untested code in the step.
**Gate:** `npm run verify` — green, 266 tests.
**Notes:** two auditor findings were judged and NOT changed. Typing in the search box and then
tapping a status chip discards the typed text, because the chips are links built from the URL —
making them submit buttons inside the form would fight the hidden field that carries the status
back the other way, for a case the Enter key already handles. And the dashboard no longer shows
what is due SOON, only what is already late; the loans list sorted by due date is one tap away,
and a third list on the home screen was what made it a scroll rather than a glance.
