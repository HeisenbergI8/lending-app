# Verification: weekly-interest loans, LIVE (post-migration)

**Date:** 2026-09-25
**Scope:** Behavioural verification of the weekly-interest-loans feature now that
`prisma/migrations/20260925120000_weekly_interest/` is applied. Follows the
checklist from the earlier `verification.md` and the post-audit fixes at the
bottom of `implementation-log.md`. All writes are confined to the `demo` account
(id `cmuamptr50000d1oonpoyn55d`). the real account (real book) and a third, empty account are untouched.
**Dependencies reachable:** DB reachable read-only via db-ro.mjs; migration confirmed
applied (`interestCollection`, `nextDueOn` on Loan; `weekNumber` on Payment all
exist). Dev server / app driving TBD.

## Results

_run in progress — nothing verified yet_

## Failures

## Not Verified

## STOPPED EARLY — turn limit hit

Report below written from the run's actual findings. See SubagentHandback message
delivered to the coordinator for the full structured report (checklist items 1-6
VERIFIED with artifacts, 7 VERIFIED, 8/9/10 and the edit-form check NOT REACHED).

Screenshots and scripts are in the session scratchpad under `pw/shots/` and are not
committed anywhere — they are session-local evidence, referenced by filename in
the handback report.
