# Verification: Edit/Delete transaction on lender profile

**Date:** 2026-09-25
**Scope:** uncommitted diff — `src/app/(app)/lenders/[id]/page.tsx`, `src/app/(app)/lenders/[id]/transaction-form.tsx`,
`src/components/forms.tsx`, `src/server/lenders/actions.ts`
**Dependencies reachable:** yes. Logged into the dev server at http://localhost:3001 as the `demo` /
`demo1234` account (own session, not the user's), driven with Playwright (installed locally with
`npm install --no-save playwright@1.63.0`, matching the already-cached browser binaries, and removed
again afterward — `git status` before/after confirms `package.json`/`package-lock.json` were untouched).
Read-only DB confirmed reachable via `node .claude/harness/db-ro.mjs --grants`.

Per the task, `npm run build` / `npm run verify` were NOT re-run — this report is behavioural only.

All screenshots referenced below are saved at
`.claude/plans/lender-txn-edit-verification/screenshots/`.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| A — edit dialog opens from row tap, saves corrected amount/date/note, money figures move | PASS | `screenshots/08-edit-dialog-open.png`, `09-after-edit-to-13600.png` (advance ₱5,000→₱13,600: Floating ₱21,000→₱12,400, Pot total ₱70,120→₱61,520); `16-maria-deposit-edit-open.png`, `19-maria-confirmed-81000-ui.png` (plain deposit ₱80,000→₱81,000: Floating ₱45,000→₱46,000, Pot total ₱77,400→₱78,400) |
| B — delete from inside edit dialog works, dialog closes, no nested-dialog lockup | PASS | `screenshots/12-nested-alertdialog-open.png` (AlertDialog opens cleanly over the Dialog), `13-after-delete-confirmed.png` (both dialogs closed, row gone, Floating back to ₱26,000.00 exactly), `14-after-nav-click-sanity.png` (nav link behind the dialogs still clickable afterward — no stuck backdrop/pointer-events lock) |
| C — advance row's "open the loan" link still clickable, not swallowed by overlay | PASS | `screenshots/06-after-open-the-loan-click.png` — clicked the link by accessible role/name and landed on `/loans/cmuat90gh000pc2oopd4ufi4p` (Rico Mendoza's loan), not the edit dialog |
| D — editing an advance re-checks headroom with the row's OWN old amount excluded; resaving unchanged must not be refused | PASS | `screenshots/09-after-edit-to-13600.png` + `11-after-resave-unchanged.png` — see reasoning below; this is the regression the task called most likely and it does not reproduce |
| E — `recordAdvance` still refuses an over-ceiling advance exactly as before | PASS | `screenshots/07-over-ceiling-refusal.png` — refused with `"That is more than this loan still owes the Admin pot. ₱8,600.00 is left after the ₱5,000.00 already drawn."` |
| static gate (build/verify) | NOT RUN | explicitly excluded by the task ("already pass, do not just re-run") |
| unit | NOT RUN | no new/changed test files in the diff to run (`git diff --stat` shows only app/server/component files, no `tests/**` changes) — see Coverage gap below |

## How item D was actually tested (not just read)

The task flagged this as the most likely bug, so it needed a test that would fail if `excluding` were
missing or wired wrong — not just "edit succeeds," since a small edit would pass either way.

1. Recorded a fresh ₱5,000 advance against Rico Mendoza's loan (headroom was ₱13,600 before any
   advance — `03-advance-dialog-open.png`). `04-after-advance-recorded.png` / `05-lender-after-advance.png`
   confirm Floating dropped ₱26,000 → ₱21,000.
2. Edited that same row's amount from ₱5,000 up to ₱13,600 — the loan's *entire* headroom
   (`09-after-edit-to-13600.png`, Floating → ₱12,400). This step alone is diagnostic: without
   `excluding`, the check would add the row's stale ₱5,000 to the new ₱13,600 request against a
   ₱13,600 stake and refuse it (18,600 > 13,600). It didn't — it saved.
3. The literal regression from the task description: reopened the same row (now ₱13,600) and hit
   **Save changes with the amount left unchanged** (`10-reopen-13600-dialog.png` →
   `11-after-resave-unchanged.png`). Without `excluding`, this is the sharpest possible failure: the
   row's own ₱13,600 would count against itself, headroom would read as ₱0, and an unchanged resave
   would be refused. It was not — the dialog closed with no error, and Floating stayed at ₱12,400.00
   (unchanged, as it should for a same-amount save).

Server-side, this matches `advanceRefusal(userId, loanId, wanted, excluding?)` in
`src/server/lenders/actions.ts:169-236`, which filters `loan.advances` by `row.id !== excluding` before
summing, and `updateTransaction` passes `existing.id` as `excluding` when `existing.loanId` is set
(`src/server/lenders/actions.ts:344-347`). The behavioural test above is the thing that would have
caught it if that filter, or the argument being passed through, were wrong — reading the code alone
would not have (a call site that forgot to pass `excluding` still type-checks and still compiles).

## Also observed (not explicitly requested, but part of the same diff)

- The "Out with" section heading total (`outPrincipal` in `page.tsx`) renders correctly: `01-lender-before.png` shows "2 loans running · ₱35,000.00 out", matching the sum of the two funding rows below it (₱10,000 + ₱25,000).
- `EditTransaction`'s pre-fill is correct in both directions: an advance row hides the direction radios and pins `type=WITHDRAWAL` (`08-edit-dialog-open.png`), a plain deposit row shows both radios with "Money in" pre-selected (`16-maria-deposit-edit-open.png`).
- Cleanup: all test data was reverted. The ₱13,600 test advance was deleted (item B test), restoring Demo Admin's Floating to its original ₱26,000.00 / Pot total ₱75,120.00 (`13-after-delete-confirmed.png`). Maria Cruz's deposit was edited to ₱81,000 then reverted back to ₱80,000 / "Initial capital" (`20-maria-reverted.png`), matching the original baseline (`15-maria-before.png`).

## Not Verified

- **Static gate / full test suite**: explicitly not re-run per the task's instructions (already known green).
- **Coverage gap**: there is no automated test (unit or otherwise) covering `updateTransaction` or the
  `excluding` exclusion logic in `advanceRefusal`. `tests/` has no changes in this diff. This is exactly
  the kind of contract boundary (server action re-deriving a ceiling against a row's own prior state)
  that regresses silently later — worth a `node --test` case in `tests/server/` or wherever
  `recordAdvance`'s existing coverage lives, asserting `advanceRefusal(..., excluding: id)` does not
  double-count. I did not add one myself (tester agents don't write source/product code, and this is
  arguably plan-level work, not a bug to report).
- **Radix nested-dialog problem at a deeper level**: B was verified for the specific flow the task
  described (open edit → delete → confirm → both close cleanly, page still interactive). I did not
  fuzz other paths (e.g., opening delete's AlertDialog then pressing Escape twice, or clicking outside
  the AlertDialog specifically) — the one flow that matters (confirm-delete) works cleanly.
- **Mobile / narrow-viewport behaviour** of the new invisible full-row overlay button and the
  `z-10` link lift: only tested at the default Playwright viewport (1280px). Not screenshotted at
  phone width.
- I did not attempt to log in as the real admin account (`immanuel` / `sophy`) — no credentials were
  available or requested. All testing used the `demo` account, which is what the dev seed script and
  the login page itself point to for this exact purpose.

## Bottom line

No failures found. All five priority items (A–E) hold up under a real click-through with money figures
checked before/after, not just a code read. The regression the task worried about most (D) was
specifically engineered to fail if broken, and it didn't.
