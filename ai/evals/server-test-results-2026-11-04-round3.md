# Dex-E server-only test results, round 3 (2026-11-04, commit af15374)

- **Where:** https://lending-app-git-feature-ask-pondex-ui-john-ross-projects1.vercel.app, demo account.
- **Build check:** `earnings of each lender in October` returned "**₱28,000.00** earned in October 2026, across 4
  lenders" on the first try (9:54 PM Philippines time), so af15374 was live.
- **How:** every prompt sent to `/api/assistant` with `serverOnly: true`, one fresh conversation each; button
  follow-ups sent as the next message with history. Date in the Philippines: November 04, 2026.
- **Safety:** demo account checked before starting, every 25 prompts (10 checks) and at the end, all true. Every
  response had model `server` or `none`. No card confirmed, `/api/assistant/act` never called, no code, git or
  database changes.
- **Figures cross-check:** the per-lender figures (floating, out on loan, earned in all) match the Dashboard pot cards
  (Demo Admin ₱26,000.00 / ₱35,000.00 / ₱11,000.00, John Ross ₱134,500.00 / ₱10,000.00 / ₱19,500.00, Jun
  ₱18,000.00 / ₱22,000.00 / ₱0.00, Maria ₱45,000.00 / ₱28,000.00 / ₱8,000.00). Deposits per lender also add up:
  floating + out on loan = deposits − withdrawals + earned, for every pot. No figure looked wrong, so no Reports page
  was needed this round.

## Summary

| Section | Passed | Failed | Total |
|---|---|---|---|
| 18. Any figure, anyone, any time (Q-01 to Q-34) | 34 | 0 | 34 |
| 17. Reports and screens (RP-01 to RP-29) | 29 | 0 | 29 |
| 1. New loans: plain, synonyms, Taglish | 18 | 0 | 18 |
| 2. New loans: typos | 6 | 0 | 6 |
| 3. Missing details | 8 | 0 | 8 |
| 4. Several lenders | 5 | 0 | 5 |
| 5. Edge cases | 8 | 0 | 8 |
| 6. Pending requests | 5 | 0 | 5 |
| 7. Payments | 16 | 0 | 16 |
| 8. Undoing payments | 5 | 0 | 5 |
| 9. Money in and out | 16 | 2 | 18 |
| 10. Fixing/deleting money entries | 5 | 0 | 5 |
| 11. Labels | 9 | 0 | 9 |
| 12. People | 13 | 1 | 14 |
| 13. Loans: extend, notes, etc. | 20 | 0 | 20 |
| 14. Checks | 12 | 0 | 12 |
| 15. Off-topic and tricks | 9 | 0 | 9 |
| **Total (listed prompts)** | **218** | **3** | **221** |
| My own questions (not in the list) | 11 good | 3 wrong, 3 went to the AI | 17 |

## Failures

All three are **regressions**: commands that used to make a card are now read as questions. They answer with
a figure and make no card, so the Admin may think the change went through when nothing is recorded.

1. **D-05 `Maria sent another 20k for her pot`** (round 2: CARD money in ₱20,000.00) → ANSWER "₱45,000.00 floating
   in Maria Cruz's pot…". The "her pot" wording pulls it into a floating question.
2. **W-03 `take 2k out of Jun pot`** (round 2: CARD money out ₱2,000.00) → ANSWER "₱18,000.00 floating in Jun
   Reyes's pot…".
3. **N-14 `Jun started with 30000`** (round 2: CARD starting capital ₱30,000.00) → ANSWER "₱0.00 starting capital
   for Jun Reyes…". A statement with an amount is read as a question about starting capital.

## My own questions: wrong answers

1. **OWN-05 `which borrower paid the least last month?`** → "₱78,000.00 paid by Bea Villanueva in October 2026, the
   least of the borrowers." Wrong: Bea is the only one who paid, so she paid the **most**. The other four paid ₱0.00
   but are left out of the ranking.
2. **OWN-08 `how many loans did Maria fund?`** → "8 loans in all" (every loan on the account). Maria is ignored; she
   funded only some of them.
3. **OWN-10 `sino ang may pinakamalaking utang`** ("who has the biggest debt") → the total owed by all 5 borrowers
   (₱119,920.00). The rows are sorted, so Angel is on top, but the headline doesn't answer "who". The English
   `who owes the most?` (OWN-02) works.

Went to the AI (not wrong, but the server could have answered): `magkano ang hawak ni Jun` ("how much is Jun
holding", floating), `how much did each lender withdraw last month` (Q-14 "withdrawals per lender?" works, but the
verb plus a period does not) and `total money out on loan per pot` (Q-11's wording works).

## Odd or badly worded (passed)

- **Q-20** `who borrowed the most?`: headline names only Angel Dela Cruz (₱75,000.00), but Bea is tied at
  ₱75,000.00. Better: "Angel Dela Cruz and Bea Villanueva, ₱75,000.00 each".
- **Q-25** `how many borrowers are overdue?` leads with the amount ("₱15,360.00 overdue, from 1 borrower") instead
  of the count. OWN-14 `how many loans are overdue?` does the same and never says "1 loan".
- **Q-17** "across 1 borrower" reads oddly; "from 1 borrower" (as in Q-25) is better.
- **Q-27** "4 lenders, your own pot included": uses "your" (the UI rule says "Admin").
- **Q-26** rows are in name order, while Q-15 (same figure) is ranked by amount. Mixed.
- **Q-04 / Q-10 / Q-16** "the most of the lenders" / "the least of the borrowers" is a bit stiff; "the most of any
  lender" reads better.
- **OWN-15** John Ross's starting capital is ₱0.00 although ₱125,000.00 was deposited (same for Jun and Maria). It
  is probably the saved field, but an owner would expect the first deposit. Same note as round 1 (C-10).
- "These are as of today." is added on some answers (OWN-10, OWN-11, W-03) but not on others with the same kind of
  figure (Q-09, Q-15).

## Every prompt

Kinds: CARD, ASK (question with buttons), ANSWER, → AI (test-mode reply). Card dates are spelled out.

### 18. Any figure

| ID | Prompt | Kind | Actual (short) | Result |
|---|---|---|---|---|
| Q-01 | how much did each lender earn this month? | ANSWER | ₱0.00 across 4 lenders, all ₱0.00; Nov 01 to 04 | PASS |
| Q-02 | earnings of each lender in October | ANSWER | ₱28,000.00: John Ross ₱12,000.00, Demo Admin ₱8,000.00, Maria ₱8,000.00, Jun ₱0.00 | PASS |
| Q-03 | how much did all lenders earn? | ANSWER | ₱38,500.00 in all: John Ross ₱19,500.00, Demo Admin ₱11,000.00, Maria ₱8,000.00, Jun ₱0.00 | PASS |
| Q-04 | who earned the most in October? | ANSWER | ₱12,000.00 by John Ross Santos, the most; ranked rows | PASS |
| Q-05 | who earned the least? | ANSWER | ₱0.00 by Jun Reyes in all, the least; ranked rows | PASS |
| Q-06 | how much did each pot earn last month? | ANSWER | same as Q-02 | PASS |
| Q-07 | magkano kinita ng bawat lender nung October | ANSWER | same as Q-02 | PASS |
| Q-08 | total earnings in October? | ANSWER | same as Q-02 | PASS |
| Q-09 | how much does each lender have? | ANSWER | ₱223,500.00 floating across 4 pots, one row each | PASS |
| Q-10 | which lender has the most floating? | ANSWER | ₱134,500.00 John Ross Santos, the most; ranked | PASS |
| Q-11 | how much of each lender's money is out on loan? | ANSWER | ₱95,000.00: Demo Admin ₱35,000.00, Maria ₱28,000.00, Jun ₱22,000.00, John Ross ₱10,000.00 | PASS |
| Q-12 | how much interest is still to come for each lender? | ANSWER | ₱24,920.00: Demo Admin ₱14,120.00, Jun ₱4,400.00, Maria ₱4,400.00, John Ross ₱2,000.00 | PASS |
| Q-13 | how much did each lender deposit this year? | ANSWER | ₱295,000.00 in 2026 so far: John Ross ₱125,000.00, Maria ₱80,000.00, Demo Admin ₱50,000.00, Jun ₱40,000.00 | PASS |
| Q-14 | withdrawals per lender? | ANSWER | ₱15,000.00 in all: Maria ₱15,000.00, others ₱0.00 | PASS |
| Q-15 | how much does each borrower owe? | ANSWER | ₱119,920.00 across 5 borrowers, ranked | PASS |
| Q-16 | who owes the least? | ANSWER | ₱8,560.00 Lyn Bautista, the least; ranked | PASS |
| Q-17 | how much did each borrower pay in October? | ANSWER | ₱78,000.00 across 1 borrower: Bea ₱78,000.00 | PASS (note) |
| Q-18 | who paid the most last month? | ANSWER | ₱78,000.00 Bea Villanueva, the most | PASS |
| Q-19 | how much did each borrower borrow in October? | ANSWER | ₱75,000.00: Angel ₱30,000.00, Bea ₱25,000.00, Rico ₱20,000.00 | PASS |
| Q-20 | who borrowed the most? | ANSWER | ₱75,000.00 Angel, the most; rows Angel ₱75,000.00, Bea ₱75,000.00, Rico, Dan, Lyn | PASS (note) |
| Q-21 | how much is overdue for each borrower? | ANSWER | ₱15,360.00 across 1 borrower: Dan Aquino | PASS |
| Q-22 | how much has Bea paid in all? | ANSWER | ₱78,000.00 by Bea in all; still owes ₱32,000.00 | PASS |
| Q-23 | how much does Maria have? | ANSWER | ₱45,000.00 floating; out on loan ₱28,000.00; earned ₱8,000.00 | PASS |
| Q-24 | how much does Angel owe? | ANSWER | ₱38,400.00; ₱30,000.00 loan due Nov 18 | PASS |
| Q-25 | how many borrowers are overdue? | ANSWER | ₱15,360.00 overdue, from 1 borrower: Dan Aquino | PASS (note) |
| Q-26 | how many borrowers owe money? | ANSWER | 5 borrowers owing money, one row each | PASS |
| Q-27 | how many lenders do I have? | ANSWER | 4 lenders, your own pot included; floating per lender | PASS (note) |
| Q-28 | how many loans are unpaid? | ANSWER | 5 loans still unpaid | PASS |
| Q-29 | how many loans have been fully paid? | ANSWER | 3 loans fully paid | PASS |
| Q-30 | how much is in my pot? | ANSWER | ₱26,000.00 in Demo Admin's pot; out ₱35,000.00; earned ₱11,000.00 | PASS |
| Q-31 | how much do the clients owe in total? | ANSWER | ₱119,920.00 across 5 borrowers | PASS |
| Q-32 | utang ng lahat ng borrowers? | ANSWER | same as Q-31 | PASS |
| Q-33 | how much did the investors earn last month? | ANSWER | same as Q-02 | PASS |
| Q-34 | total profit last month | ANSWER | same as Q-02 | PASS |

### 17. Reports and screens

All 29 gave the same answers as the round 2 retest after 5c96278 (with the fixed wording: "From the Admin's cut",
"Cut on loans made", "Still to come (as of today)", Dates rows on last-week answers, "Demo Admin", next week
November 11 to 17).

| ID | Kind | Actual (short) | Result |
|---|---|---|---|
| RP-01 | ANSWER | ₱0.00 John Ross this month, Nov 01 to 04 | PASS |
| RP-02 | ANSWER | ₱8,000.00 Maria in October, 1 loan repaid | PASS |
| RP-03 | ANSWER | same as RP-02 | PASS |
| RP-04 | ANSWER | ₱0.00 Maria this month | PASS |
| RP-05 | ANSWER | ₱8,000.00 Maria, Oct 01 to 15 | PASS |
| RP-06 | ANSWER | ₱8,000.00 in all; asks for a month | PASS |
| RP-07 | ANSWER | ₱8,000.00 Demo Admin; from the Admin's cut ₱8,000.00; own loans repaid 0 | PASS |
| RP-08 | ANSWER | ₱0.00 Angel in October; owes ₱38,400.00 | PASS |
| RP-09 | ANSWER | ₱78,000.00 Bea in October | PASS |
| RP-10 | ANSWER | ₱20,000.00 Rico borrowed in October | PASS |
| RP-11 | ANSWER | ₱0.00 cut this month; cut on loans made ₱160.00; still to come ₱14,120.00 | PASS |
| RP-12 | ANSWER | ₱8,000.00 cut in October; ₱13,000.00 on loans made; ₱14,120.00 to come | PASS |
| RP-13 | ANSWER | ₱75,000.00 lent in October + summary rows | PASS |
| RP-14 | ANSWER | ₱78,000.00 collected in October | PASS |
| RP-15 | ANSWER | 3 loans made in October | PASS |
| RP-16 | ANSWER | October summary rows | PASS |
| RP-17 | ANSWER | Nothing came in last week; Oct 26 to Nov 01 | PASS |
| RP-18 | ANSWER | ₱33,000.00 went out; Maria −₱8,000.00, Demo Admin −₱25,000.00 | PASS |
| RP-19 | ANSWER | No deposits for Maria this month (no card) | PASS |
| RP-20 | ANSWER | ₱15,000.00 withdrawn in October, Maria Oct 05 | PASS |
| RP-21 | ANSWER | Maria October: ₱28,000.00 in, ₱35,000.00 out, 3 rows | PASS |
| RP-22 | ANSWER | ₱328,060.00 by November 30, row per pot | PASS |
| RP-23 | ANSWER | ₱77,400.00 Maria by November 30 | PASS |
| RP-24 | ANSWER | 1 loan: Rico, due Nov 11; Nov 11 to 17 | PASS |
| RP-25 | ANSWER | No unpaid loan due in December 2026 | PASS |
| RP-26 | ANSWER | Dan saved Bad, rule Okay | PASS |
| RP-27 | ANSWER | Rico saved Okay, rule Good | PASS |
| RP-28 | ANSWER | Recently Deleted is empty. | PASS |
| RP-29 | CARD | Money in: Maria ₱5,000.00, Nov 04 | PASS |

### Sections 1 to 15 (regression)

Everything not marked FAIL gave the same kind and key facts as round 2.

| ID | Kind | Actual (short) | Result |
|---|---|---|---|
| L-01 | CARD | Rico ₱10,000.00, Nov 04 → Nov 25, Maria | PASS |
| L-02 | CARD | Rico ₱5,000.00, → Nov 18, Maria | PASS |
| L-03 | CARD | Rico ₱8,000.00, Jun Reyes | PASS |
| L-04 | CARD | Rico ₱3,000.00, → Nov 11 | PASS |
| L-05 | CARD | Bea ₱7,000.00, Nov 03 → Nov 17 | PASS |
| L-06 | CARD | Dan ₱4,000.00, Jun | PASS |
| L-07 | CARD | Rico ₱10,000.00, Maria, 2 weeks | PASS |
| L-08 | CARD | Lyn ₱2,000.00, Nov 04 → Nov 11, Jun | PASS |
| L-09 | CARD | Angel ₱5,000.00, Maria | PASS |
| L-10 | CARD | Rico ₱10,000.00, 3 weeks | PASS |
| L-11 | CARD | Rico ₱20,000.00 | PASS |
| L-12 | CARD | Rico ₱10,000.00, 3 weeks | PASS |
| L-13 | CARD | Rico ₱1,500.00 | PASS |
| L-14 | CARD | Rico ₱10,000.00, 2 weeks | PASS |
| L-15 | CARD | start Nov 05, 8% a week | PASS |
| L-16 | CARD | Demo Admin ₱10,000.00 | PASS |
| L-17 | CARD | Demo Admin ₱5,000.00 | PASS |
| L-18 | CARD | Bea ₱10,000.00, John Ross, → Dec 02 | PASS |
| T-01 | CARD | Rico ₱10,000.00, Maria | PASS |
| T-02 | CARD | Rico Mendoza ₱5,000.00 | PASS |
| T-03 | CARD | Maria Cruz ₱10,000.00 | PASS |
| T-04 | → AI | test-mode reply | PASS |
| T-05 | CARD | Angel Dela Cruz ₱5,000.00 | PASS |
| T-06 | CARD | 3 weeks | PASS |
| M-01 | ASK → CARD | [1–4 weeks] → 3 weeks → due Nov 25 | PASS |
| M-02 | ASK → CARD | [4 lenders with floating] → Maria | PASS |
| M-03 | ANSWER | How much is the loan to Rico? | PASS |
| M-04 | ASK → CARD | [Split evenly] → ₱5,000.00 each | PASS |
| M-05 | ASK → CARD | [4/8/12 weeks] → 4 weeks → Dec 02 | PASS |
| M-06 | ASK → CARD | [Nov 11 / Nov 18] → Nov 11 | PASS |
| M-07 | ASK → CARD | [Nov 25 / Dec 02] → Nov 25 | PASS |
| M-08 | ANSWER | How much is the loan to Rico? | PASS |
| S-01 | CARD | Maria ₱6,000.00, Jun ₱4,000.00 | PASS |
| S-02 | CARD | ₱5,000.00 each | PASS |
| S-03 | CARD | ₱5,000.00 each | PASS |
| S-04 | CARD | ₱5,000.00 each | PASS |
| S-05 | CARD | Demo Admin ₱5,000.00, Maria ₱5,000.00 | PASS |
| E-01 | ANSWER | can't be negative | PASS |
| E-02 | ANSWER | How much is the loan to Rico? | PASS |
| E-03 | ANSWER | Maria only has ₱45,000.00 floating | PASS |
| E-04 | ANSWER | Jun only has ₱18,000.00 floating | PASS |
| E-05 | → AI | test-mode reply | PASS |
| E-06 | → AI | test-mode reply | PASS |
| E-07 | ANSWER | Rico is a borrower, not a lender… which lenders? | PASS |
| E-08 | ANSWER | one change at a time | PASS |
| R-01 | CARD | pending request Rico ₱10,000.00, 4 weeks | PASS |
| R-02 | CARD | pending request Lyn ₱5,000.00, 2 weeks | PASS |
| R-03 | CARD | pending request Dan ₱3,000.00, 2 weeks | PASS |
| R-04 | ANSWER | There are no pending requests. | PASS |
| R-05 | ANSWER | There are no pending requests. | PASS |
| P-01 | CARD | Mark paid: Dan ₱12,000.00, Nov 04 | PASS |
| P-02 | CARD | Dan, Nov 04 | PASS |
| P-03 | CARD | Dan, Nov 04 | PASS |
| P-04 | CARD | Dan, Nov 04 | PASS |
| P-05 | CARD | Bea ₱25,000.00 | PASS |
| P-06 | CARD | Bea ₱25,000.00 | PASS |
| P-07 | CARD | Lyn ₱8,000.00, Nov 04 | PASS |
| P-08 | CARD | Lyn, Nov 04 | PASS |
| P-09 | CARD | Lyn, Nov 03 | PASS |
| P-10 | ASK → CARD | [Yes, paid in full] → Lyn, paid Nov 04 | PASS |
| P-11 | ASK → CARD | same → paid Nov 04 | PASS |
| P-12 | ASK → CARD | same → paid Nov 04 | PASS |
| P-13 | CARD | Angel ₱30,000.00 (unpaid one) | PASS |
| P-14 | CARD | Dan, Nov 04 | PASS |
| P-15 | ANSWER | one change at a time | PASS |
| P-16 | → AI | test-mode reply | PASS |
| U-01 | ASK → CARD | [2 loans] → Undo Angel ₱15,000.00 | PASS |
| U-02 | CARD | Undo: Bea ₱50,000.00 | PASS |
| U-03 | ANSWER | Dan has no paid loan to undo. | PASS |
| U-04 | ANSWER | Lyn has no weekly loan. | PASS |
| U-05 | ANSWER | Dan has no paid loan to undo. | PASS |
| D-01 | CARD | Money in: Maria ₱5,000.00, Nov 04 | PASS |
| D-02 | CARD | Money in: Maria ₱10,000.00 | PASS |
| D-03 | CARD | Money in: Maria ₱2,000.00 | PASS |
| D-04 | CARD | Money in: Jun ₱3,000.00 | PASS |
| D-05 | ANSWER | ₱45,000.00 floating in Maria Cruz's pot… (no card) | **FAIL** |
| D-06 | CARD | Money in: Demo Admin ₱5,000.00 | PASS |
| D-07 | CARD | Money in: Maria ₱5,000.00 | PASS |
| D-08 | ASK → CARD | [4 lenders] → Maria ₱5,000.00 | PASS |
| D-09 | ANSWER | How much did Maria put in? | PASS |
| W-01 | CARD | Money out: Jun ₱2,000.00, Nov 03 | PASS |
| W-02 | CARD | Money out: Jun ₱1,500.00 | PASS |
| W-03 | ANSWER | ₱18,000.00 floating in Jun Reyes's pot… (no card) | **FAIL** |
| W-04 | CARD | Money out: Jun ₱1,000.00 | PASS |
| W-05 | CARD | Money out: Maria ₱3,000.00 | PASS |
| W-06 | CARD | Money out: Maria ₱5,000.00 | PASS |
| W-07 | CARD | Money out: Jun ₱3,000.00 | PASS |
| W-08 | ANSWER | Jun only has ₱18,000.00 floating | PASS |
| W-09 | ANSWER | two changes, one by one | PASS |
| F-01 | CARD | Edit entry: deposit → ₱90,000.00 | PASS |
| F-02 | CARD | Edit entry: withdrawal → ₱12,000.00 | PASS |
| F-03 | ASK → CARD | [Withdrawal / Deposit] → withdrawal → ₱6,000.00 | PASS |
| F-04 | CARD | Delete entry: withdrawal ₱15,000.00 | PASS |
| F-05 | ANSWER | no deleted money entries | PASS |
| B-01 | CARD | Lyn, Bad | PASS |
| B-02 | CARD | Lyn, Bad | PASS |
| B-03 | CARD | Angel, Bad | PASS |
| B-04 | CARD | Lyn, Good | PASS |
| B-05 | CARD | Rico, Okay | PASS |
| B-06 | CARD | Lyn, Good | PASS |
| B-07 | CARD | Lyn, Cleared | PASS |
| B-08 | → AI | test-mode reply | PASS |
| B-09 | ANSWER | Dan saved Bad, rule Okay; no card | PASS |
| N-01 | CARD | Add borrower Juan Dela Cruz | PASS |
| N-02 | CARD | Add borrower Ana De Los Santos | PASS |
| N-03 | CARD | Add lender Ana Santos | PASS |
| N-04 | ANSWER | asks first and last name | PASS |
| N-05 | CARD | Rename → Ricardo Mendoza | PASS |
| N-06 | CARD | Rename lender → Junior Reyes | PASS |
| N-07 | CARD | Delete lender Maria Cruz | PASS |
| N-08 | CARD | Delete lender Jun Reyes | PASS |
| N-09 | ASK → CARD | [Keep / Delete] → Keep → Delete borrower Lyn | PASS |
| N-10 | → AI | test-mode reply | PASS |
| N-11 | → AI | test-mode reply | PASS |
| N-12 | ANSWER | Angel has no photo to remove. | PASS |
| N-13 | CARD | Starting capital: Maria ₱50,000.00 | PASS |
| N-14 | ANSWER | ₱0.00 starting capital for Jun Reyes… (no card) | **FAIL** |
| X-01 | CARD | Extend Rico, 2 weeks | PASS |
| X-02 | CARD | Extend Angel, 1 week, interest paid now | PASS |
| X-03 | CARD | Extend Rico, 1 week | PASS |
| X-04 | ASK → CARD | [1–4 weeks] → Extend Bea, 1 week | PASS |
| X-05 | CARD | Weekly interest: Rico | PASS |
| X-06 | CARD | Weekly interest: Angel | PASS |
| X-07 | CARD | Note: Dan, "will pay Friday" | PASS |
| X-08 | CARD | Note: Rico, "asked for more time" | PASS |
| X-09 | CARD | Note: Rico, "Rico pays on Saturdays" | PASS |
| X-10 | ANSWER | What should the note say? | PASS |
| X-11 | ANSWER | no note on Dan's loan | PASS |
| X-12 | CARD | Delete Dan's loan | PASS |
| X-13 | CARD | Delete Dan's loan | PASS |
| X-14 | ANSWER | Dan has no deleted loan. | PASS |
| X-15 | CARD | Edit Bea's loan → ₱20,000.00, Demo Admin | PASS |
| X-16 | ANSWER | 2 lenders, how much from each | PASS |
| X-17 | CARD | Edit Angel's loan, 8% a week | PASS |
| X-18 | CARD | Advance: Rico ₱3,000.00 | PASS |
| X-19 | CARD | Proof: Rico | PASS |
| X-20 | ANSWER | one change at a time | PASS |
| C-01 | ANSWER | ₱95,000.00, 5 borrowers | PASS |
| C-02 | ANSWER | ₱15,360.00, Dan | PASS |
| C-03 | ANSWER | ₱223,500.00 across 4 pots | PASS |
| C-04 | ANSWER | label rule | PASS |
| C-05 | ANSWER | Lyn, November 08, 2026 | PASS |
| C-06 | ANSWER | ₱8,560.00, Nov 04 to 10 | PASS |
| C-07 | ANSWER | ₱38,400.00 Angel | PASS |
| C-08 | ANSWER | same as C-07 | PASS |
| C-09 | ANSWER | ₱25,600.00 Rico | PASS |
| C-10 | ANSWER | ₱45,000.00 Maria; out ₱28,000.00; earned ₱8,000.00 | PASS |
| C-11 | ANSWER | Dan ₱15,360.00 | PASS |
| C-12 | ANSWER | 5 borrowers | PASS |
| O-01 | ANSWER | I'm Dex-E… | PASS |
| O-02 | ANSWER | same as O-01 | PASS |
| O-03 | ANSWER | only Pondex | PASS |
| O-04 | ANSWER | only Pondex, no card | PASS |
| O-05 | → AI | test-mode reply | PASS |
| O-06 | ANSWER | ₱8,000.00 Maria in October | PASS |
| O-07 | → AI | test-mode reply | PASS |
| O-08 | → AI | test-mode reply | PASS |
| O-09 | → AI | test-mode reply | PASS |

### My own questions

Judged by what a lending-business owner would mean.

| ID | Prompt | Kind | Actual (short) | Verdict |
|---|---|---|---|---|
| OWN-01 | how much is floating in each pot | ANSWER | ₱223,500.00 across 4 pots, one row each | Good |
| OWN-02 | who owes the most? | ANSWER | ₱38,400.00 Angel, the most; top 3 ranked | Good |
| OWN-03 | how much did John Ross earn in October? | ANSWER | ₱12,000.00, 1 loan repaid | Good |
| OWN-04 | magkano ang hawak ni Jun | → AI | test-mode reply | Went to AI (expected Jun's floating ₱18,000.00) |
| OWN-05 | which borrower paid the least last month? | ANSWER | ₱78,000.00 Bea, "the least of the borrowers" | **Wrong** (Bea paid the most; others ₱0.00 left out) |
| OWN-06 | how much has Rico paid so far | ANSWER | ₱0.00 by Rico in all; still owes ₱25,600.00 | Good |
| OWN-07 | how much did each lender withdraw last month | → AI | test-mode reply | Went to AI (expected Maria ₱15,000.00) |
| OWN-08 | how many loans did Maria fund? | ANSWER | 8 loans in all (unpaid 5, paid 3, overdue 1) | **Wrong** (ignores Maria) |
| OWN-09 | total money out on loan per pot | → AI | test-mode reply | Went to AI (expected ₱95,000.00 per lender) |
| OWN-10 | sino ang may pinakamalaking utang | ANSWER | ₱119,920.00 still owed across 5 borrowers (Angel first) | **Wrong** (asked who, got the total) |
| OWN-11 | how much interest will Jun still get? | ANSWER | ₱4,400.00 for Jun; floating ₱18,000.00; out ₱22,000.00 | Good |
| OWN-12 | how much did we earn this year | ANSWER | ₱38,500.00 in 2026 so far, row per lender | Good |
| OWN-13 | how much did Dan borrow | ANSWER | ₱12,000.00 in all; still owes ₱15,360.00 | Good |
| OWN-14 | how many loans are overdue? | ANSWER | ₱15,360.00 overdue, from 1 borrower (Dan, 42 days late) | Good (but leads with amount, not "1 loan") |
| OWN-15 | what's John Ross's starting capital? | ANSWER | ₱0.00; floating ₱134,500.00; out ₱10,000.00; earned ₱19,500.00 | Good (₱0.00 looks odd, see notes) |
| OWN-16 | how much did Lyn borrow this month | ANSWER | ₱8,000.00 this month; owes ₱8,560.00 | Good |
| OWN-17 | kita ni Maria ngayong taon | ANSWER | ₱8,000.00 earned in 2026 so far | Good |
