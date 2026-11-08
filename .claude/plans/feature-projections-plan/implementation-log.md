# Implementation log — Projections

## Phase 1: Shared arithmetic groundwork — 2026-11-08

**Steps completed:** 1.1, 1.2, 1.3, 1.4
**Files changed:** `src/lib/money/weeks.ts`, `src/lib/money/centavos.ts`, `src/lib/money/split.ts`, `src/lib/money/projection.ts`, `tests/money/split.test.ts`, `tests/money/weeks.test.ts`, `tests/money/centavos.test.ts`, `tests/money/projection.test.ts`
**Deviations from plan:** none
**Gate:** `npm run verify` — 916 pass, 0 fail; lint 0 errors
**Notes:** existing projection tests unchanged and passing after the `scheduleArrivals` extraction.

## Phase 2: Historical inputs (pure) — 2026-11-08

**Steps completed:** 2.1, 2.2
**Files changed:** `src/lib/money/forecast-history.ts` (new), `tests/money/forecast-history.test.ts` (new)
**Deviations from plan:** none — code taken verbatim from the plan.
**Gate:** `node --test tests/money/forecast-history.test.ts` 11 pass; `npm run typecheck` green; eslint clean.
**Notes:** no figure checked against real data — no database credentials in this session.
