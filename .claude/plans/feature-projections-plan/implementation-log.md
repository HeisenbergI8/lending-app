# Implementation log — Projections

## Phase 1: Shared arithmetic groundwork — 2026-11-08

**Steps completed:** 1.1, 1.2, 1.3, 1.4
**Files changed:** `src/lib/money/weeks.ts`, `src/lib/money/centavos.ts`, `src/lib/money/split.ts`, `src/lib/money/projection.ts`, `tests/money/split.test.ts`, `tests/money/weeks.test.ts`, `tests/money/centavos.test.ts`, `tests/money/projection.test.ts`
**Deviations from plan:** none
**Gate:** `npm run verify` — 916 pass, 0 fail; lint 0 errors
**Notes:** existing projection tests unchanged and passing after the `scheduleArrivals` extraction.
