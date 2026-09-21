# Step 8 — Dashboard and search

Build order step 8 (docs/ARCHITECTURE.md). Written on the main thread rather than by the
architect: the contracts it needs — `listLoans`, `listLenders`, `listBorrowers`, `loanState`,
`lenderPosition` — all already exist and are tested, so there was nothing unverified to plan
around.

**Spec:** docs/FEATURES.md §8 (main screen, search and filters) and §10 (home dashboard).

**One reading to record:** §8 describes a single main screen — lenders across the top, borrowers
below — and the app has since split those onto their own routes. So §8's *layout* lands on the
dashboard (lenders across the top, borrowers below, both already built as list screens) and §8's
*search* lands on the loans list, which is the only screen where borrower name, lender name,
amount, date range and Active/Overdue/Paid all mean something.

## Phases

1. **Filter in the server layer.** A pure `src/lib/loan-filter.ts` reading the query string, and
   `listLoans(userId, filter)` narrowing in SQL rather than in JS.
2. **Search on the loans list.** A GET form — no server action, so it works without JavaScript —
   plus the three status chips.
3. **Dashboard to spec.** §10's four figures, lenders across the top with Floating · Out · Earned,
   borrowers below with their ratings.
4. **Tests and docs.** `tests/` for the filter and the new date helpers; ARCHITECTURE and README
   updated to say step 8 is real.
