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

