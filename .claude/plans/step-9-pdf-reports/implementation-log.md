# Implementation log — step 9

## Phase 0: proving the renderer — 2026-09-21

**Steps completed:** the decisions recorded at the top of plan.md
**Files changed:** `package.json` (+ `@react-pdf/renderer` 4.9.0),
`src/server/reports/fonts/` (Geist Regular + SemiBold + licence)
**Gate:** a spike rendered a real PDF (`%PDF-` header, embedded font) before any report code existed.
**Notes:** the first spike printed `±30,000.00` where `₱30,000.00` belonged — the PDF standard fonts
carry no ₱ glyph and fail silently. Found by rendering the spike to an image and looking at it, not
by reading the bytes. The bundled font fixes it and was confirmed the same way.

## Phase 1: report data — 2026-09-21

**Steps completed:** 1.1 range rules, 1.2 the three report queries
**Files changed:** `src/lib/report-range.ts` (new), `src/server/reports/queries.ts` (new)
**Deviations from plan:** none.
**Gate:** `npm run typecheck` — green.
**Notes:** nothing here recomputes money the app already derives — a lender's position comes from
`listLenders`, a borrower's record from `trackRecord`, every loan figure from the row it was stored
in. The full file is the borrower report with `withProof`, not a fourth query.

## Phase 2: the documents — 2026-09-21

**Steps completed:** 2.1 font registration and page shell, 2.2 the four layouts
**Files changed:** `src/server/reports/document.tsx` (new)
**Deviations from plan:** none.
**Gate:** `npm run typecheck` — green.
**Notes:** every peso goes through `formatPesos`, the same function the screens use — a document
somebody is handed must not be able to disagree with the screen it came from. Hyphenation is turned
off, or "Dela Cruz" breaks as "De-la Cruz" in a narrow column.

## Phase 3: the route — 2026-09-21

**Steps completed:** 3.1 validation and rendering, 3.2 attachment headers
**Files changed:** `src/app/api/reports/route.ts` (new), `src/server/reports/document.tsx`
**Deviations from plan:** `/api/reports?kind=…` rather than ARCHITECTURE's `/api/reports/[kind]/`.
A plain GET form cannot change its own action without JavaScript, and this app works without it.
**Gate:** `npm run build` — green; the route builds as a dynamic function.
**Notes:** a posted id is a request, not a permission — every query re-checks the person belongs to
this account and the route answers "not on this account" rather than rendering anything.

## Phase 4: the page — 2026-09-21

**Steps completed:** 4.1 three GET forms, 4.2 empty states
**Files changed:** `src/app/(app)/reports/page.tsx` (new)
**Deviations from plan:** none. `/reports` was already in the navigation, waiting for this.
**Gate:** `npm run build` — green.
**Notes:** the borrower card has two submit buttons carrying the kind, so "Statement" and "Full
file" are each one tap and neither needs a toggle or any JavaScript.

## Phase 5: tests, config and docs — 2026-09-21

**Steps completed:** 5.1 tests, 5.2 font tracing, 5.3 docs
**Files changed:** `tests/reports/report-range.test.ts` (new), `next.config.ts`,
`src/server/reports/queries.ts`, `docs/ARCHITECTURE.md`, `README.md`, `CONVENTIONS.md`
**Deviations from plan:** ONE, and it was recorded here as "none" until the auditor caught it.
Phase 5 promised tests for the range rules AND the report arithmetic; only the range rules were
tested. Corrected in phase 6.
- **Real bug, found by a test.** The range filter was being used BOTH as a SQL clause and as a JS
  predicate. In SQL Postgres compares calendar days and the bounds are right; in JS a date column
  arrives at midnight UTC — morning in Manila — while the range's ends are carried at local midday,
  so the day AFTER the range fell inside it by twelve hours. `inRange` now compares calendar days
  and the SQL clause keeps its own job. Boundaries were then checked against the live database: a
  single-day range returned exactly the rows on that day, and a range ending the day before
  returned none of them.
**Gate:** `npm run verify` — green, 282 tests (was 266). `npm run build` — green.
**Notes:** `outputFileTracingIncludes` is what keeps the font files in the deployed function. Without
it the fonts are traced out, the renderer falls back, and every ₱ in every report silently becomes
`±` — in production only, which is the worst place to find it.

## Phase 6: audit fixes — 2026-09-21

**Steps completed:** not planned — raised by the auditor after phase 5
**Files changed:** `src/lib/money/split.ts`, `src/server/loans/queries.ts`,
`src/server/reports/queries.ts`, `src/server/reports/document.tsx`,
`src/app/(app)/reports/page.tsx`, `src/lib/report-range.ts`, `tests/money/split.test.ts`

- **A lender statement said how much was out, and not where.** FEATURES §9 asks for "which loans".
  Both loan tables were range-filtered, so a loan that started before the range and has not been
  repaid appeared in neither — and the page defaults to this month, so that was the normal case,
  not an edge. There is now a "Where your money is, today" table listing every loan their capital
  is still in, whatever its dates.
- **The arithmetic that was promised tests now has them.** `adminTakeOnLoan` is lifted out of both
  `loans/queries.ts` and `reports/queries.ts` into `money/split.ts`, beside the split that produces
  the numbers, and tested — including that what the admin takes plus what the other funders keep IS
  the interest the borrower was charged. The loan screen and the report now read the same function,
  so they cannot drift.
- **An archived lender could not be given a closing statement** while an archived borrower could.
  The lender report goes through `getLender` now, which finds them either way — and which is what
  supplies the "where your money is" list.
- `missingProof` was computed and then re-derived in the document; the document uses the field.
- `describeRange`'s comment gave a date format the function does not produce.
- The borrower card says the full file covers the dates you pick, since both its buttons share the
  month-to-date default.

**Gate:** `npm run verify` — green, 287 tests (was 282). `npm run build` — green.
**Notes:** the auditor also observed that this plan carries no machine-checkable checks, so
`verify-plan.mjs` reports nothing for it. True, and worth knowing before citing the harness as
assurance for step 9: everything here was established by hand or by the tester.

## Verification note — 2026-09-21

The "where your money is, today" fix was confirmed in the running app: John Ross Santos's September
statement now lists the Rico Mendoza loan (started 31 Aug, outside the range) and the listed capital
sums to the page's own "Out on loan" figure.

**NOT VERIFIED at runtime:** the archived-lender path. `getLender` has no `archivedAt` filter on the
lender row, which is the fix, but it was only read — not run. Archiving a lender cannot be undone in
the app today: `/archive` is in the navigation and returns 404, and nothing in the lender screens
restores a record. FEATURES §11 specifies that screen; the build order never scheduled it. Nobody
archived anything to find out.
