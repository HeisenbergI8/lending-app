# Verification: Projections feature

**Date:** 2026-11-08
**Scope:** d33cd91..8a308ed on claude/trusting-hawking-qmhjex
**Dependencies reachable:** local Postgres yes

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| npm run verify | PASS (941 pass, 0 fail, 3 pre-existing lint warnings) | /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/verify.log, exit 0 |
| Numbers: running loans only = earnings+cut on ACTIVE loans due >= today | PASS | page 21,560.00 = DB 21,560.00; per view Admin cut 3,360 / Admin 9,800 / John 2,000 / Jun 2,000 / Maria 4,400 all equal DB sums; /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/a3.cjs, a3-*.png |
| View switch, ?month=, target (interest + pot), pot hidden on Admin cut | PASS | /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/a2.cjs, a3.cjs output; forced targetKind=pot on admin falls back to interest |

| Plan create/edit/rename clash/invalid inputs (cut>rate, weekly 1wk, 0 and 61 months, blank name, blank/0 amount, 53 weeks, 999 loans, bad rate, huge amount) | PASS | /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/b1.cjs, b2.cjs output; every case shows a clear message and saves nothing |
| Planned moves once / every month with until / remove; until<from; blank amount; blank month | PASS | /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/b2.cjs, b2-moves.png |
| Compare 3 plans, delete plan (with confirm), + New plan | PASS (see UX notes) | /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/b4.cjs, b4-compare.png, d3.cjs |
| Re-lend on/off | PASS | /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/c2.cjs: R0 on 21,283,650.91, off 21,560.00 |
| Re-lend engine vs spec, independent hand calc | PASS | Dec 2026 interest 27,872.32 = 28% of 99,544.00 re-lent (Admin 4,816,000 + John 58.2% of 1,200,000 + Jun 1,200,000 + Maria 3,240,000 centavos); /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/c1.cjs |
| Cash-shortage warning | PASS | T1 (5 x 50,000 a month): "March 2027: John..., Maria..., Jun... would need their share..." b1/d1 output, b4-compare.png |
| Dashboard card | PASS | d1.cjs: "Estimated interest, next 12 months" + plan name, link to /projections |
| 390px width, no horizontal scroll | PASS except one edge case | d3.cjs: scrollWidth 390 on /projections variants; 534 when a plan name has 60 chars with no space (d1.cjs/d2.cjs) |
| TZ=America/Los_Angeles (server via next start :3006, browser tz LA too) | PASS | e1.cjs: 7 pages byte-identical text vs UTC server; e2.cjs: move stored 2027-04-01..2027-06-01, shown "April 2027 to June 2027". :3006 stopped afterwards |
| npm run build | PASS, exit 0 | /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/build.log |
| No realistic line (nothing due in 6 months) | NOT RUN | cannot be made without editing demo loans; code path forecast.ts:431 and page.tsx message read only |

## Failures

### 1. A plan can crash /projections and the dashboard (high)

- **New or pre-existing:** new (this work). Known in a code comment (page.tsx:56-57), but not guarded.
- **Reproduction:** as demo, /projections?plan=new, name "Aa60", 3 loans, 30000, 4 weeks, 7 / 2, At the end, 60 months, re-lend ticked, Create plan. Also: an edit of a plan with 0 loans, re-lend on, 36 months (30 months still works, 73.3M).
- **Observed:** "This page couldn't load" on that plan, on /projections (plan list order puts it first) and on / (dashboard). Log: "Money calculation exceeded safe integer range (1000000 x 31195579440 = 31195579440000000)" at split.ts:228 <- forecast.ts:302 (re-lend pretendLoan) <- page.tsx:55 and (app)/page.tsx:57. The Delete button is on the broken page, so the plan cannot be deleted from the UI (I removed mine by posting the delete form from another plan's page).
- **Expected:** an error message on the plan, or a cap on the horizon, never a dead dashboard. One lender re-lending above about 90 million pesos in one month trips it; the form allows horizons up to 60.
- **Confidence:** high

### 2. "Already overdue" is the whole pot in every view (low)

- page.tsx:127-129 prints best.lateNow (all lenders, capital + interest) under Admin cut and each lender view. Admin cut view shows 15,360.00 overdue next to a 3,360.00 cut. DB overdue loan is 12,000.00 capital + 3,360.00 interest.
- Repro: /projections?plan=new&view=admin. Confidence high.

### 3. Narrow screen overflow with a long unbroken plan name (low)

- A 60-character name with no spaces makes /projections 534px wide at 390px (plans list li, page.tsx:211). Names with spaces were fine. Repro: create plan named xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx, open at 390px.

### 4. Small friction (not defects against the plan)

- Saving a plan edit gives no "saved" message. "+ compare" on an already compared plan does nothing, so a plan cannot be dropped from the chart except by editing the URL. A plan with 0 new loans still needs an amount typed. The add-move form keeps its values after a successful add.

## Re-lend growth: not a bug

Plan section 1.2 and 3.1: each lender re-lends 100% (default) or their measured share of everything returned (capital + interest + cut), one month later, as a new 4-week loan at 7% (28% per loan). I recomputed December 2026 by hand from the DB rows: 27,872.32 = 28% x 99,544.00, an exact match. Growth is about 1.28x a month, so about 33.8M at 24 months is the specified result. Two things worth a label: the demo has only 2 lenders with real habits (Admin 100%, John 58.2%), the other two use the 100% default; and nothing limits how much borrowers can take. February 2027 shows 0.00 correctly (a 1 Feb loan is due 1 Mar).

## Not Verified

- Production/Supabase data, or the migration on it (local Postgres only).
- No-realistic-line message in a browser.
- Weekly-collection plans and real EXTENDED/FIXED_AMOUNT loans (none in demo data).
- Print/PWA, dark mode.

## Re-check against a321e98 (2026-11-08)

Same environment, demo only, no source edits. Script: /tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/h1.cjs.

| Item | Result | Evidence |
| --- | --- | --- |
| 1. Aa60 (3 x 30,000, 60 months, re-lend) and 0 loans + re-lend + 36 months | PASS | page loads; alert "“Aa60” grows too large to calculate ... Showing running loans only. Shorten its months ahead, or turn re-lending off."; Delete plan button present and worked; dashboard loads (shows the plan's 12-month card) for both |
| 2. Overdue per view | PASS | DB funding row of the overdue loan: principal 1,200,000, earnings 240,000, cut 96,000 centavos (funder Jun). Agree with expected values. Page: Whole pot 15,360.00, Admin cut 960.00, Jun 14,400.00; Admin, John, Maria show no overdue line |
| 3. 60-char unbroken name at 390px | PASS | scrollWidth 390 = clientWidth 390, h1-long.png |
| 4a. "Saved." after edit | PASS | text appears |
| 4b. "− remove" on compared plan | PASS | link present, click returns to the single-plan view |
| 4c. blank amount with 0 loans | PASS | plan created |
| 4d. add-move form clears | PASS | amount and month empty, move listed |
| npm run verify | PASS | 943 pass, 0 fail, 3 pre-existing warnings, exit 0 (/tmp/claude-0/-home-user-lending-app/72e4ab4c-03ed-54e8-adc6-54a8020a04ce/scratchpad/verify2.log) |
| Cleanup | done | only "Steady growth" remains |
