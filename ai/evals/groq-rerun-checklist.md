# Groq rerun of the 38 local-model failures (started 2026-11-04)

The 38 scenarios that failed on the local `qwen3:8b` model (see `results-2026-11-04.md`), run again on
Groq through the testing link, signed in as demo. Plan: run all 38 and record them, then fix the bugs,
then retest the failures. No fixes until all 38 have run.

How it runs: `runner/prep-scenario.ts <id>` resets the demo data and does the setup on this Mac;
`runner/browser-turns.js` sends the chat turns from the signed-in testing-link tab.

Code tested: commit `c7291cb`. Models: 120b = `openai/gpt-oss-120b` (main), 20b = `openai/gpt-oss-20b`,
27b = `qwen/qwen3.8-27b` (backups).

## Checklist

Tested: 12 of 38. Passed 4, failed 8.

| | Scenario | Status | Model | Result |
|---|---|---|---|---|
| [x] | READ-09 | Tested | 120b | Pass |
| [x] | READ-15 | Tested | 120b | Fail |
| [x] | READ-16 | Tested | 120b | Fail |
| [x] | READ-21 | Tested | 120b | Fail |
| [x] | RULE-02 | Tested | 120b | Fail |
| [x] | RULE-03 | Tested | 20b | Pass |
| [x] | RULE-08 | Tested | 20b | Pass |
| [x] | RULE-11 | Tested | 20b | Fail |
| [x] | NAME-05 | Tested | 20b | Fail |
| [x] | LOANX-05 | Tested | 27b | Fail |
| [x] | LOAN-02 | Tested | 20b | Pass |
| [x] | LOAN-15 | Tested | 20b | Fail |
| [ ] | LOAN-20 | Untested | | Tried 3 times, Groq refused every time (busy) |
| [ ] | LOAN-24 | Untested | | |
| [ ] | LOANX-01 | Untested | | |
| [ ] | LOANX-11 | Untested | | |
| [ ] | LOANX-12 | Untested | | |
| [ ] | LOANX-14 | Untested | | |
| [ ] | LOANX-15 | Untested | | Needs a reset and setup |
| [ ] | PAY-01 | Untested | | |
| [ ] | PAY-02 | Untested | | |
| [ ] | PAY-04 | Untested | | Needs a reset and setup |
| [ ] | PAY-05 | Untested | | Needs a reset and setup |
| [ ] | PPL-01 | Untested | | |
| [ ] | PPL-02 | Untested | | |
| [ ] | PPL-04 | Untested | | |
| [ ] | PPL-05 | Untested | | |
| [ ] | PPL-09 | Untested | | Needs a reset and setup |
| [ ] | PPL-13 | Untested | | |
| [ ] | PPL-17 | Untested | | Needs a reset and setup |
| [ ] | MON-01 | Untested | | |
| [ ] | MON-08 | Untested | | |
| [ ] | MON-09 | Untested | | Needs a reset and setup |
| [ ] | REQ-01 | Untested | | |
| [ ] | REQ-04 | Untested | | Needs a reset and setup |
| [ ] | MT-08 | Untested | | Presses Confirm, needs a reset |
| [ ] | MT-10 | Untested | | Presses Confirm, needs a reset |
| [ ] | MT-12 | Untested | | |

The untested ones with no note never press Confirm, so they can run together after one reset.

## Failures found so far

| Scenario | Model | What went wrong | Likely cause |
|---|---|---|---|
| READ-15 | 120b | "How much did Maria earn in October?" It said it can't tell, but never pointed to the lender page. | Model (small miss) |
| READ-16 | 120b | Gave ₱95,000.00 (out on loan now) as the total of every loan ever made. Right answer: ₱190,000.00 over 8 loans. | Code: no tool gave an all-time total. **Fixed**, needs retest |
| READ-21 | 120b | "Who's the biggest borrower?" It said it can't see each borrower's balance. Right answer: Angel, ₱38,400.00. | Code: no tool ranked borrowers by amount owed. **Fixed**, needs retest |
| RULE-02 | 120b | Said Dan's Bad label matches the rule with 1 overdue loan. By the rule, 1 overdue is Okay. | Code: the model had to work out the rule's label itself. **Fixed**, needs retest |
| RULE-11 | 20b | Gave ₱4,200.00 interest but left out the ₱24,200.00 total. | Model |
| NAME-05 | 20b | "How much does Cruz have?" Answered only for Angel Dela Cruz; never mentioned Maria Cruz the lender. | Model (the lookup already lists her as a lender) |
| LOANX-05 | 27b | Made a delete card for Angel's active loan instead of asking which of her 3 loans. | Model |
| LOAN-15 | 20b | Card right except the due date: "3 days" became Nov 11 (7 days) instead of Nov 7. | Code: the loan form only took weeks, so days were rounded to a week. **Fixed**, needs retest |

## Bugs already fixed during this run (commit `c7291cb`)

1. A lender's name (Maria) made the AI offer to add her as a new borrower. The lookup now says she is a lender.
2. The AI sometimes wrote "Proposed action ... Please confirm" as plain text with no real card. That is now caught and sent back.

## Bugs fixed after the first 12 (commit below this file's, 2026-11-04)

3. **READ-16, READ-21:** the dashboard lookup now also gives all loans ever made (count and capital) and the 3
   borrowers who owe the most now. Checked on demo: 8 loans, ₱190,000.00; Angel ₱38,400.00 first.
4. **RULE-02 (and RULE-03):** the borrower lookup now gives the label your rule gives beside the saved one.
   Checked on demo: Dan saved Bad, rule Okay; Rico saved Okay, rule Good. Unit tests added.
5. **LOAN-15:** loans can run a number of days. "for 3 days" in the Admin's words sets the due date 3 days out,
   even if the model sent 1 week. Checked on demo: Bea's loan due Nov 7. Unit tests added.

After these: `npm run verify` 697 pass, card checks 32/32, Confirm checks 49/49 (demo).

## Fewer tokens per question (2026-11-04)

- A plain question now gets short instructions and only the lookup tools; a change gets everything. The
  instructions and tool list go with every call (about 580 + 1,050 tokens), so this is the biggest saving.
- If a change has no change words, the AI can still reach for find_action, and the question switches to change mode.
- Measured on the Mac model, same questions: plain questions about 15 to 16% fewer tokens (3,650 to 3,076).
  Changes about the same.
- Change words added: pahiram, pautang, hulog, deposited, set, update, edit.
- The borrower lookup's label fields are now savedLabel and ruleWouldGive. The first name ("labelByYourRule")
  made the small model think Lyn was already Good, so "mark Lyn as good" made no card. Now 3 of 3 make the card.

## Typos in the action word (2026-11-04)

Found by asking "what if someone types kend instead of lend": the app treated it as a plain question, the AI looked
up a borrower called "kend rico", and said nobody was found. Nothing wrong was saved, but the answer was useless.

Fixed on the server (checked directly, no AI needed):
- A change word with one slipped letter still counts as a change: kend, mrak, delte, restor, payed.
- The action search reads the slipped word as the real one, and an action word counts double, so "lend Rico 10k
  ... 3 weeks" finds the new-loan action first (before, even correctly spelled, "mark a week paid" came first).
- The name lookup drops a misspelt action word when the whole name finds nobody ("mrak lyn" finds Lyn), and offers
  people matching one word of the name as a question ("Juan Dela Cruz": "did you mean Angel Dela Cruz?"), never a pick.

Extra prompts for the Groq rerun (untested end to end; the Mac model is too unreliable to judge):

| | Prompt | Expected |
|---|---|---|
| [ ] | kend Rico 10k from Maria for 3 weeks starting today | New-loan card for Rico, ₱10,000.00 from Maria |
| [ ] | mrak lyn as paid | Mark-paid card for Lyn's loan (screenshot needed) |
| [ ] | Lyn is good now, set it | Set-label card, Lyn Good |

## Groq free plan findings

- The main model (120b) ran out for the day after about 16 questions. Groq counts a rolling 24 hours, so yesterday's
  tests still counted. Back about 6:13 PM Manila.
- The 20b backup ran out next. Back about 3:07 PM Manila.
- The last backup (27b) refuses partway through a question: its limit is 8,000 tokens a minute, and one question
  that makes a change needs more than that. So once the first two models are used up, change requests fail on
  the free plan. Worth knowing for the live app.

## Next

1. Run the 26 untested scenarios when a model is back (set to start about 3:08 PM Manila).
2. Compile all failures, fix the code bugs, then retest every failure and run `npm run verify`.
3. Put the final numbers in `results-2026-11-04.md`.
