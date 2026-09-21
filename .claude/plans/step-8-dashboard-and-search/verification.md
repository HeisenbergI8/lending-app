# Verification: Step 8 — Dashboard and search

**Date:** 2026-09-21
**Scope:** working tree diff on main — src/lib/loan-filter.ts (new), src/server/loans/queries.ts,
src/app/(app)/loans/search-form.tsx (new), src/app/(app)/loans/page.tsx, src/app/(app)/page.tsx,
src/lib/money/weeks.ts, src/server/forms.ts, src/app/(app)/loans/loan-form.tsx
**Dependencies reachable:** dev server already running (`next dev`, pid 74749 -> next-server pid
85900). **CORRECTION:** port 3000 is occupied by an unrelated project
(`Work-related/new-admin-frontend`, confirmed via `lsof -p 61356` cwd) — testing against it would
have produced a false report. The lending-app's own next-server (v16.3.5, matches package.json)
is on **port 3001**, confirmed via `lsof -p 85900` cwd = this repo, and `<title>Sign in · Lending
App · Lending App</title>` at http://localhost:3001/login. All checks below use port 3001.
No browser automation available in this sandbox (no `chromium-cli`, no Playwright install) — all
checks done via `curl` against the real running Next.js server (real HTTP responses, not mocks).
JS-only behaviour (the live client-side "= 4 weeks" badge) cannot be observed this way and is
reported as NOT VERIFIED rather than guessed.

All checks driven with a real headless Chromium (Playwright, freshly installed into the
scratchpad — not part of the repo) against the actual `next dev` server at localhost:3001, logged
in as demo/demo1234. SP below = `/private/tmp/claude-501/-Users-johnrossrivera-Desktop-personal-lending-app/a67e55cb-2688-4329-9e3d-926bb5822c11/scratchpad`.

**Mid-run source change:** the coordinator flagged that the Overdue-tile figure changed (loans ->
distinct borrowers) while this run was in progress. Re-checked against the live app after the
change (screenshot 22) — confirmed below.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| dashboard renders, no runtime error | PASS | `SP/22_dashboard_recheck.png` (final, post source-change); console/pageerror listeners empty — `node dashboard_recheck.js` -> `CONSOLE_ERRORS: []` |
| Overdue tile links to /loans?status=overdue | PASS | href read from DOM = `/loans?status=overdue`; direct nav screenshot `SP/03_loans_overdue.png` shows the Overdue chip active, 1 match, Dan Aquino ₱15,360.00 |
| search: name ("Dan") | PASS | `SP/04_search_dan.png` — 1 match, URL `?q=Dan&from=&to=` |
| search: full name "Angel Cruz" (borrower is actually "Angel Dela Cruz" — tests token/partial match with middle name skipped) | PASS | `SP/05_search_angel_cruz.png` — 3 matches, all "Angel Dela Cruz" loans, URL `?q=Angel+Cruz&from=&to=` |
| search: amount 30000 | PASS | `SP/06_search_amount_30000.png` — 2 matches, both ₱30,000.00 principal, ₱15,000 loan correctly excluded |
| search: due-date range | PASS | wide range (2026 full year) `SP/07_search_date_range.png` = 8/8 matches; narrow range (Aug 2026) `SP/15_narrow_date_range.png` = 3/8, correctly excludes the rest |
| search: status chips (Active/Overdue/Paid) | PASS | `SP/08b_chip_active.png` (4 matches), `SP/09_chip_overdue.png`/`SP/03_loans_overdue.png` (1 match), `SP/10b_chip_paid.png` (3 matches) — each chip highlighted, correct URL (`?status=active` etc.) |
| search: clear link | PASS | `SP/11b_before_clear.png` (q=Dan&status=overdue) -> `SP/12b_after_clear.png` (URL back to bare `/loans`, chips unselected, search box empty, all 8 rows back) |
| URL carries search / reload shows same rows | PASS | `SP/16_reload_1.png` vs `SP/17_reload_2.png` — `diff` of the extracted page text on the two loads is byte-identical |
| empty state ("nothing matches") | PASS (bonus, not explicitly requested but relevant) | `SP/18_empty_state.png` — "Nothing matches that" + working "Clear filters" button |
| no-JS form submission (GET form + chips) | PASS | real no-JS: Playwright context created with `javaScriptEnabled: false` (no React hydration at all, not a simulation). Search box + Search button: `SP/19_nojs_loans_initial.png` -> `SP/20_nojs_after_search.png` (2 matches for "Bea"). Status chip (plain `<a href>`): `SP/21_nojs_chip_paid.png` (3 Paid matches, chip highlighted) |
| loan form "= 4 weeks" live badge | PASS | `SP/24_loan_form_4weeks.png` — badge reads exactly "= 4 weeks" for Sep 1 -> Sep 29, 2026. Invalid range: `SP/25_loan_form_invalid_weeks.png` — badge reads "19 days is not a whole number of weeks. Try Sep 15, 2026 or Sep 22, 2026.", `aria-invalid="true"` on the due-date input |
| loan create date validation | PASS | Created a real loan (₱5,000, 4-week term) end to end: `SP/29_after_submit_valid.png` shows the saved loan detail page, "Sep 1, 2026 -> Sep 29, 2026 · 4 weeks at 7% a week", interest ₱1,400.00 (5000 × 7% × 4), matching the live preview exactly |
| loan edit date validation | PASS | Edited that loan's due date to Sep 25, 2026 (24 days, not a whole week): `SP/31_edit_invalid_date.png` shows the same client badge; clicking "Save changes" round-tripped to the **server action** and was rejected — `SP/32_after_invalid_submit.png` shows the page still on `/edit` with a server-rendered error banner "24 days is not a whole number of weeks. Try Sep 22, 2026 or Sep 29, 2026." (i.e. this is `describeWeeksError` running again on the server, not just the client preview) |

Cleanup: the test loan created above was reverted via the app's own "Undo loan" action.
Post-cleanup dashboard (`SP/34_dashboard_after_cleanup.png`) matches the original baseline
figures exactly (₱95,000 out on loan, ₱223,500 floating, ₱11,000 earned, same 4 pots/5 borrowers)
— demo data left as found.

## Failures

None found in the behaviours this task asked me to check.

**Process note, not a product bug:** several early Playwright runs (dashboard Overdue-tile click,
status chips, Clear link) appeared to fail to navigate. Root cause was my own driver script, not
the app: `page.waitForLoadState('networkidle')` never resolves in `next dev` because the
Webpack/Turbopack HMR websocket keeps a connection open forever, so my script's post-click wait
was timing out/racing, not the click itself. Confirmed by re-running the identical clicks with a
`waitForURL`/short-timeout pattern instead of `networkidle` — all navigated correctly on the first
try (see the `*b_*` and `*2.js` reruns above). Also worth recording: the dev server on port 3000
belongs to an unrelated project (`Work-related/new-admin-frontend`); this app's `next-server`
(v16.3.5, matching `package.json`) is the one on **port 3001** — confirmed via `lsof -p <pid>` cwd
before any testing began, so no findings below are contaminated by the wrong app.

## Not Verified

- **Server action progressive-enhancement for the LOGIN form specifically** — not part of this
  task's scope (search/dashboard), so not pursued further. Hand-crafted `curl` reproduction of the
  React Server Action multipart encoding returned a 500 on my first attempt; this is very likely a
  mistake in my manually-assembled multipart body (matching the encoded action id/bound-args
  format by hand is error-prone), not a real app bug — I did not spend further budget on it since
  a real no-JS browser context (used for the loans search, above) is strictly better evidence
  anyway and did not show this problem anywhere it was used.
- **Full page.url() timing** in a couple of intermediate driver scripts occasionally logged a
  stale URL for one tick before the final screenshot/text dump (which was always correct) — noted
  only because it's visible in the raw console output preserved in this session; it did not affect
  any conclusion above, all of which are backed by the screenshot/text artifact, not the log line.
- **`npm run verify` / typecheck / unit tests** were not re-run by me — the task said this was
  already established (256 tests, later 266 per the coordinator's note) and asked specifically for
  behavioural verification in the running app.
