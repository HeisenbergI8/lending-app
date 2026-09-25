# Review of CONVENTIONS.md — the authority, and the eleven traps this feature can fall into

Only what constrains this plan.

## Status of the file

It carries a `harness:scaffold` marker at the top, but the marker's own text says why:
Features and stack **are** decided; "Commands" and "Where things live" were the placeholders, and
both are now filled in and marked **REAL**. **This is not a half-filled scaffold and the plan is not
written conservatively on account of it.** The marker should probably come out; that is not this
feature's to do.

## What binds the plan

> "The borrower is charged 7% per week; the funding lender earns 5% and the admin keeps 2%. Interest
> is simple, charged on the original capital, and computed **once when the loan is created** — there
> is no recurring job and the total never changes afterwards."

**IMPORTANT.** Weekly-interest loans do not touch a word of this. FEATURES.md §5 is explicit:
"This is not a third interest basis ... Nothing recalculates; there is still no background job."

> "Money is stored as whole centavos (integers) ... the remainder from a lender split is assigned
> deliberately — never dropped. This is the single easiest way to silently shortchange a lender."

The weekly schedule is a second remainder problem. §1.2 of the plan assigns it deliberately, to the
final week, per FEATURES.md §5.

> **Read this first:** `src/lib/money/split.ts` ... "Model any new money code on it, and read
> `tests/money/split.test.ts` alongside it — the reconciliation test there is the one that matters."

Done. Both have reviews. `weekly.ts` and `weekly.test.ts` are modelled on them.

## Commands — what `verify-plan.mjs` can actually run

`harness.config.json` declares exactly two: `verify` → `npm run verify`, `verifyFast` →
`npm run typecheck`. Plus `test -f` and `grep` from the allowlist. **`npm test` and
`node --test tests/money/split.test.ts` are in CONVENTIONS.md's table but NOT in the config**, so a
step gated on a single test file would be reported blocked, not run. Every `Verify:` line in the plan
uses one of the four that work.

`npm run verify` was run on this tree on 2026-09-24: **384 tests, 0 failures.** It is a usable gate,
and `plan.unsatisfiable` is not set in the config, so there are no known-failing suites to avoid.

> "`npm run typecheck` is `next typegen && tsc --noEmit`, and the `typegen` half is not optional."

## Layering

UI → Server → Domain, one way. `src/lib/money/` imports nothing from the other two.
**`src/lib/money/weekly.ts` therefore holds the arithmetic and `getLoan` builds the schedule; the
schedule component does no maths.**

> "Tests are plain TypeScript run by Node itself — `node --test`, no Vitest, no Jest, no loader ...
> every import inside `src/lib/money/` and `tests/` must carry an explicit `.ts` extension."

**IMPORTANT.** Every import in the new module and its test ends in `.ts`. Easy to miss, and it fails
at run time rather than at typecheck.

## The traps that apply

1. **Colour means loan state and nothing else.** Four tokens, never borrowed. Every status ships an
   icon AND a word. The twenty-row schedule is where this is most tempting to break.
2. **`tabular-nums` in table columns, not on standalone figures.** `<Money variant="column">` for the
   schedule, `"display"` for the tiles above it.
3. **Files into the bucket BEFORE any row is written**, with cleanup of anything already uploaded.
   `markWeekPaid` reuses `uploadAll` rather than copying it.
4. **Wrapping a server action costs the no-JavaScript fallback.** `MarkPaidPanel` is the worked
   example of leaving one unwrapped; the week panel is the same case.
5. **"Undoing a payment archives the row, and `Payment.loanId` is unique."** The trap this feature
   removes, and the plan keeps the guarantee via a partial index. **The wording of this trap must be
   updated when the plan lands**, or it describes a constraint that is gone.
6. **A client component must not import from `src/server/`.** Why the two new refusal sentences in
   `terms.ts` cannot drive a live badge, and why the form hides the checkbox instead.
7. **A loan's stored figures are never recomputed on read.** The weekly schedule is *derived from*
   stored figures, never recomputed from a rate — which is the distinction that makes it legal.
8. **Rounding happens in ONE pass, never per row.** The reason week k is the sum of its funder slices
   rather than an independent division of the loan's interest.
9. **A calendar day is carried at local MIDDAY.** Twenty dates instead of one. `addDays` only.
10. **`src/components/*.tsx` cannot be imported by `node --test`.** Every testable weekly rule is in
    `src/lib/`.
11. **`db` is a Proxy built on first use.** Nothing in the plan constructs a client at module scope.

## Reporting rules that shaped the Follow Ups

> "A deferral is not a gap." — The deferral list is currently empty. Reversing a conversion and the
> Recently Deleted decision are both candidates for it.

> "A claim that ages carries the date it was measured." — Every database figure in the plan says
> 2026-09-24 and names the query.

> "Red is not automatically yours." — Two files are modified in the working tree
> (`docs/FEATURES.md`, `src/app/(app)/lenders/[id]/page.tsx`). The first is this feature's
> specification. **Neither was touched.**

> "A priority label is not permission to start." — The plan implements nothing.
