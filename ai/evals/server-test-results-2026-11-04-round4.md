# Dex-E server-only test results, round 4 (final pass, 2026-11-04, commit 5bcd3ce)

- **Where:** https://lending-app-git-feature-ask-pondex-ui-john-ross-projects1.vercel.app, demo account.
- **Build check:** `total money out on loan per pot` returned "**₱95,000.00** out on loan, across 4 lenders" on the
  first try (10:23 PM Philippines time), so 5bcd3ce was live.
- **How:** every prompt sent to `/api/assistant` with `serverOnly: true`, one fresh conversation each; button
  follow-ups sent as the next message with history. Philippines date: November 04, 2026.
- **Safety:** demo account checked before starting, every 25 prompts (11 checks) and at the end, all true. Every
  response had model `server` or `none`. No card confirmed, `/api/assistant/act` never called, no code, git or
  database changes.
- **Figures:** all per-lender and per-borrower figures match round 3, which matched the Dashboard pot cards. No new
  figure looked wrong, so no Reports page was opened.

## Summary

| Section | Passed | Failed | Total |
|---|---|---|---|
| 18. Any figure (Q-01 to Q-44) | 44 | 0 | 44 |
| 17. Reports and screens (RP-01 to RP-29) | 29 | 0 | 29 |
| 1. New loans: plain, synonyms, Taglish | 18 | 0 | 18 |
| 2. New loans: typos | 6 | 0 | 6 |
| 3. Missing details | 8 | 0 | 8 |
| 4. Several lenders | 5 | 0 | 5 |
| 5. Edge cases | 8 | 0 | 8 |
| 6. Pending requests | 5 | 0 | 5 |
| 7. Payments | 16 | 0 | 16 |
| 8. Undoing payments | 5 | 0 | 5 |
| 9. Money in and out | 18 | 0 | 18 |
| 10. Fixing/deleting money entries | 5 | 0 | 5 |
| 11. Labels | 9 | 0 | 9 |
| 12. People | 14 | 0 | 14 |
| 13. Loans: extend, notes, etc. | 20 | 0 | 20 |
| 14. Checks | 12 | 0 | 12 |
| 15. Off-topic and tricks | 9 | 0 | 9 |
| **Total (listed prompts)** | **231** | **0** | **231** |
| My round 3 questions (OWN-01 to OWN-17) | 17 good | 0 | 17 |
| New questions of my own (NEW-01 to NEW-12) | 9 good, 1 to the AI by design | 1 wrong, 1 missed (to the AI) | 12 |

All three round 3 regressions are fixed (D-05 / Q-42, W-03, N-14 / Q-43 make cards again), and all round 3 own-question
problems are fixed (OWN-04, 05, 07, 08, 09, 10).

## Failures

None in the listed prompts.

From my new questions:

1. **NEW-07 `how much interest will I still get?`** → "₱24,920.00 interest still to come, across 4 lenders" (every
   lender's total). "I" means the Admin's own pot, so it should lead with **Demo Admin ₱14,120.00**. Compare Q-30
   `how much is in my pot?`, which reads "my" correctly.
2. **NEW-10 `magkano na ang naibalik ni Bea`** ("how much has Bea paid back so far") → went to the AI. `naibalik` /
   `ibinalik` (returned, paid back) isn't read as "paid". Q-22 `how much has Bea paid in all?` gives the right
   answer (₱78,000.00).

NEW-05 `what is the average loan size?` went to the AI, which is fine: averages are not one of the server's figures.

## Odd or badly worded (passed)

- **Q-20** "₱75,000.00 each: Angel Dela Cruz and Bea Villanueva in all, the most of any borrower." The tie is now
  named (good), but the sentence is clunky. Better: "Angel Dela Cruz and Bea Villanueva borrowed the most, ₱75,000.00
  each."
- **Q-36 / OWN-05** "₱0.00 each: Angel Dela Cruz, Dan Aquino, Lyn Bautista and Rico Mendoza in October 2026, the
  least of any borrower." Correct, but "paid nothing in October" would read more naturally than "₱0.00 each … the
  least".
- **OWN-14** `how many loans are overdue?` → "1 loan overdue right now." with no row saying whose (Q-25 lists Dan).
- **"your" in screen text** still appears in RP-26/RP-27 ("your rule gives Okay"), C-04 ("the one you saved") and
  O-01 ("for you to confirm"). Q-27 now says "the Admin's pot" (fixed).
- **"These are as of today."** shows on Q-38 / OWN-10 but not on Q-15 / Q-31, which show the same figure.
- **OWN-15** starting capital ₱0.00 for John Ross although ₱125,000.00 was deposited (unchanged from rounds 1 and 3;
  probably the saved field, but it looks odd to an owner).

## Every result

Kinds: CARD, ASK (question with buttons), ANSWER, → AI (test-mode reply).

### 18. Any figure

| ID | Prompt | Kind | Actual (short) | Result |
|---|---|---|---|---|
| Q-01 | how much did each lender earn this month? | ANSWER | ₱0.00 across 4 lenders; Nov 01 to 04 | PASS |
| Q-02 | earnings of each lender in October | ANSWER | ₱28,000.00: John Ross ₱12,000.00, Demo Admin ₱8,000.00, Maria ₱8,000.00, Jun ₱0.00 | PASS |
| Q-03 | how much did all lenders earn? | ANSWER | ₱38,500.00 in all, row per lender | PASS |
| Q-04 | who earned the most in October? | ANSWER | ₱12,000.00 John Ross, the most of any lender | PASS |
| Q-05 | who earned the least? | ANSWER | ₱0.00 Jun Reyes, the least | PASS |
| Q-06 | how much did each pot earn last month? | ANSWER | same as Q-02 | PASS |
| Q-07 | magkano kinita ng bawat lender nung October | ANSWER | same as Q-02 | PASS |
| Q-08 | total earnings in October? | ANSWER | same as Q-02 | PASS |
| Q-09 | how much does each lender have? | ANSWER | ₱223,500.00 across 4 pots | PASS |
| Q-10 | which lender has the most floating? | ANSWER | ₱134,500.00 John Ross, the most | PASS |
| Q-11 | how much of each lender's money is out on loan? | ANSWER | ₱95,000.00 across 4 lenders | PASS |
| Q-12 | how much interest is still to come for each lender? | ANSWER | ₱24,920.00 across 4 lenders | PASS |
| Q-13 | how much did each lender deposit this year? | ANSWER | ₱295,000.00, one total per lender | PASS |
| Q-14 | withdrawals per lender? | ANSWER | ₱15,000.00, Maria ₱15,000.00, others ₱0.00 | PASS |
| Q-15 | how much does each borrower owe? | ANSWER | ₱119,920.00 from 5 borrowers, ranked | PASS |
| Q-16 | who owes the least? | ANSWER | ₱8,560.00 Lyn, the least | PASS |
| Q-17 | how much did each borrower pay in October? | ANSWER | ₱78,000.00 from 1 borrower: Bea | PASS |
| Q-18 | who paid the most last month? | ANSWER | ₱78,000.00 Bea, the most | PASS |
| Q-19 | how much did each borrower borrow in October? | ANSWER | ₱75,000.00 from 3 borrowers | PASS |
| Q-20 | who borrowed the most? | ANSWER | ₱75,000.00 each: Angel and Bea, the most | PASS (note) |
| Q-21 | how much is overdue for each borrower? | ANSWER | ₱15,360.00, Dan | PASS |
| Q-22 | how much has Bea paid in all? | ANSWER | ₱78,000.00; still owes ₱32,000.00 | PASS |
| Q-23 | how much does Maria have? | ANSWER | ₱45,000.00; out ₱28,000.00; earned ₱8,000.00 | PASS |
| Q-24 | how much does Angel owe? | ANSWER | ₱38,400.00; ₱30,000.00 loan due Nov 18 | PASS |
| Q-25 | how many borrowers are overdue? | ANSWER | 1 borrower overdue; Dan ₱15,360.00 | PASS |
| Q-26 | how many borrowers owe money? | ANSWER | 5 borrowers, ranked rows | PASS |
| Q-27 | how many lenders do I have? | ANSWER | 4 lenders, the Admin's pot included | PASS |
| Q-28 | how many loans are unpaid? | ANSWER | 5 loans | PASS |
| Q-29 | how many loans have been fully paid? | ANSWER | 3 loans | PASS |
| Q-30 | how much is in my pot? | ANSWER | ₱26,000.00 in Demo Admin's pot | PASS |
| Q-31 | how much do the clients owe in total? | ANSWER | ₱119,920.00 from 5 borrowers | PASS |
| Q-32 | utang ng lahat ng borrowers? | ANSWER | same as Q-31 | PASS |
| Q-33 | how much did the investors earn last month? | ANSWER | same as Q-02 | PASS |
| Q-34 | total profit last month | ANSWER | same as Q-02 | PASS |
| Q-35 | magkano ang hawak ni Jun | ANSWER | ₱18,000.00 floating in Jun Reyes's pot | PASS |
| Q-36 | which borrower paid the least last month? | ANSWER | ₱0.00 each: Angel, Dan, Lyn, Rico; Bea ₱78,000.00 last | PASS (note) |
| Q-37 | how many loans did Maria fund? | ANSWER | 3 loans funded by Maria (2 unpaid, 1 paid) | PASS |
| Q-38 | sino ang may pinakamalaking utang | ANSWER | ₱38,400.00 Angel, the most | PASS |
| Q-39 | how much did each lender withdraw last month | ANSWER | ₱15,000.00 in October, Maria ₱15,000.00 | PASS |
| Q-40 | total money out on loan per pot | ANSWER | ₱95,000.00 across 4 lenders | PASS |
| Q-41 | how much did Jun earn? | ANSWER | ₱0.00 earned by Jun Reyes in all | PASS |
| Q-42 | Maria sent another 20k for her pot | CARD | Money in: Maria ₱20,000.00, Nov 04 | PASS |
| Q-43 | Jun started with 30000 | CARD | Starting capital: Jun ₱30,000.00 | PASS |
| Q-44 | how many borrowers are overdue? | ANSWER | 1 borrower overdue; Dan | PASS |

### 17. Reports and screens

All the same as round 3.

| ID | Kind | Actual (short) | Result |
|---|---|---|---|
| RP-01 | ANSWER | ₱0.00 John Ross this month | PASS |
| RP-02 | ANSWER | ₱8,000.00 Maria in October | PASS |
| RP-03 | ANSWER | same as RP-02 | PASS |
| RP-04 | ANSWER | ₱0.00 Maria this month | PASS |
| RP-05 | ANSWER | ₱8,000.00 Maria, Oct 01 to 15 | PASS |
| RP-06 | ANSWER | ₱8,000.00 in all; asks for a month | PASS |
| RP-07 | ANSWER | ₱8,000.00 Demo Admin; from the Admin's cut | PASS |
| RP-08 | ANSWER | ₱0.00 Angel in October; owes ₱38,400.00 | PASS |
| RP-09 | ANSWER | ₱78,000.00 Bea in October | PASS |
| RP-10 | ANSWER | ₱20,000.00 Rico borrowed in October | PASS |
| RP-11 | ANSWER | ₱0.00 cut this month; ₱160.00 on loans made; ₱14,120.00 to come | PASS |
| RP-12 | ANSWER | ₱8,000.00 cut in October; ₱13,000.00 on loans made | PASS |
| RP-13 | ANSWER | ₱75,000.00 lent in October + summary | PASS |
| RP-14 | ANSWER | ₱78,000.00 collected in October | PASS |
| RP-15 | ANSWER | 3 loans made in October | PASS |
| RP-16 | ANSWER | October summary rows | PASS |
| RP-17 | ANSWER | Nothing came in last week; Oct 26 to Nov 01 | PASS |
| RP-18 | ANSWER | ₱33,000.00 went out; Maria, Demo Admin | PASS |
| RP-19 | ANSWER | No deposits for Maria this month (no card) | PASS |
| RP-20 | ANSWER | ₱15,000.00 withdrawn in October | PASS |
| RP-21 | ANSWER | Maria October in/out, 3 rows | PASS |
| RP-22 | ANSWER | ₱328,060.00 by November 30 | PASS |
| RP-23 | ANSWER | ₱77,400.00 Maria by November 30 | PASS |
| RP-24 | ANSWER | Rico due Nov 11; Nov 11 to 17 | PASS |
| RP-25 | ANSWER | none due in December 2026 | PASS |
| RP-26 | ANSWER | Dan saved Bad, rule Okay | PASS |
| RP-27 | ANSWER | Rico saved Okay, rule Good | PASS |
| RP-28 | ANSWER | Recently Deleted is empty. | PASS |
| RP-29 | CARD | Money in: Maria ₱5,000.00 | PASS |

### Sections 1 to 15

All give the same kind and key facts as round 2 (which matched every Expected), now including the three round 3
regressions fixed.

| ID | Kind | Actual (short) | Result |
|---|---|---|---|
| L-01 | CARD | Rico ₱10,000.00, Nov 04 → Nov 25, Maria | PASS |
| L-02 | CARD | Rico ₱5,000.00, → Nov 18 | PASS |
| L-03 | CARD | Rico ₱8,000.00, Jun Reyes | PASS |
| L-04 | CARD | Rico ₱3,000.00, → Nov 11 | PASS |
| L-05 | CARD | Bea ₱7,000.00, Nov 03 → Nov 17 | PASS |
| L-06 | CARD | Dan ₱4,000.00, Jun | PASS |
| L-07 | CARD | Rico ₱10,000.00, Maria | PASS |
| L-08 | CARD | Lyn ₱2,000.00, Nov 04 → Nov 11, Jun | PASS |
| L-09 | CARD | Angel ₱5,000.00 | PASS |
| L-10 | CARD | Rico ₱10,000.00, 3 weeks | PASS |
| L-11 | CARD | Rico ₱20,000.00 | PASS |
| L-12 | CARD | Rico ₱10,000.00, 3 weeks | PASS |
| L-13 | CARD | Rico ₱1,500.00 | PASS |
| L-14 | CARD | Rico ₱10,000.00 | PASS |
| L-15 | CARD | start Nov 05, 8% a week | PASS |
| L-16 | CARD | Demo Admin ₱10,000.00 | PASS |
| L-17 | CARD | Demo Admin ₱5,000.00 | PASS |
| L-18 | CARD | Bea, John Ross, → Dec 02 | PASS |
| T-01 | CARD | Rico ₱10,000.00 | PASS |
| T-02 | CARD | Rico Mendoza | PASS |
| T-03 | CARD | Maria Cruz | PASS |
| T-04 | → AI | test-mode reply | PASS |
| T-05 | CARD | Angel Dela Cruz | PASS |
| T-06 | CARD | 3 weeks | PASS |
| M-01 | ASK → CARD | 1–4 weeks → 3 weeks | PASS |
| M-02 | ASK → CARD | 4 lenders → Maria | PASS |
| M-03 | ANSWER | How much is the loan to Rico? | PASS |
| M-04 | ASK → CARD | Split evenly → ₱5,000.00 each | PASS |
| M-05 | ASK → CARD | 4/8/12 weeks → 4 weeks | PASS |
| M-06 | ASK → CARD | Nov 11 / Nov 18 → Nov 11 | PASS |
| M-07 | ASK → CARD | Nov 25 / Dec 02 → Nov 25 | PASS |
| M-08 | ANSWER | How much is the loan to Rico? | PASS |
| S-01 | CARD | Maria ₱6,000.00, Jun ₱4,000.00 | PASS |
| S-02 | CARD | ₱5,000.00 each | PASS |
| S-03 | CARD | ₱5,000.00 each | PASS |
| S-04 | CARD | ₱5,000.00 each | PASS |
| S-05 | CARD | Demo Admin + Maria ₱5,000.00 each | PASS |
| E-01 | ANSWER | can't be negative | PASS |
| E-02 | ANSWER | asks how much | PASS |
| E-03 | ANSWER | Maria only has ₱45,000.00 | PASS |
| E-04 | ANSWER | Jun only has ₱18,000.00 | PASS |
| E-05 | → AI | test-mode reply | PASS |
| E-06 | → AI | test-mode reply | PASS |
| E-07 | ANSWER | Rico is a borrower, which lenders? | PASS |
| E-08 | ANSWER | one change at a time | PASS |
| R-01 | CARD | pending request Rico ₱10,000.00, 4 weeks | PASS |
| R-02 | CARD | pending request Lyn ₱5,000.00 | PASS |
| R-03 | CARD | pending request Dan ₱3,000.00 | PASS |
| R-04 | ANSWER | no pending requests | PASS |
| R-05 | ANSWER | no pending requests | PASS |
| P-01 | CARD | Mark paid Dan, Nov 04 | PASS |
| P-02 | CARD | Dan, Nov 04 | PASS |
| P-03 | CARD | Dan, Nov 04 | PASS |
| P-04 | CARD | Dan, Nov 04 | PASS |
| P-05 | CARD | Bea ₱25,000.00 | PASS |
| P-06 | CARD | Bea ₱25,000.00 | PASS |
| P-07 | CARD | Lyn, Nov 04 | PASS |
| P-08 | CARD | Lyn, Nov 04 | PASS |
| P-09 | CARD | Lyn, Nov 03 | PASS |
| P-10 | ASK → CARD | Yes, paid in full → Nov 04 | PASS |
| P-11 | ASK → CARD | same → Nov 04 | PASS |
| P-12 | ASK → CARD | same → Nov 04 | PASS |
| P-13 | CARD | Angel ₱30,000.00 (unpaid) | PASS |
| P-14 | CARD | Dan, Nov 04 | PASS |
| P-15 | ANSWER | one change at a time | PASS |
| P-16 | → AI | test-mode reply | PASS |
| U-01 | ASK → CARD | 2 loans → Undo Angel ₱15,000.00 | PASS |
| U-02 | CARD | Undo Bea ₱50,000.00 | PASS |
| U-03 | ANSWER | Dan has no paid loan | PASS |
| U-04 | ANSWER | Lyn has no weekly loan | PASS |
| U-05 | ANSWER | Dan has no paid loan | PASS |
| D-01 | CARD | Money in Maria ₱5,000.00 | PASS |
| D-02 | CARD | Money in Maria ₱10,000.00 | PASS |
| D-03 | CARD | Money in Maria ₱2,000.00 | PASS |
| D-04 | CARD | Money in Jun ₱3,000.00 | PASS |
| D-05 | CARD | Money in Maria ₱20,000.00 (fixed) | PASS |
| D-06 | CARD | Money in Demo Admin ₱5,000.00 | PASS |
| D-07 | CARD | Money in Maria ₱5,000.00 | PASS |
| D-08 | ASK → CARD | 4 lenders → Maria ₱5,000.00 | PASS |
| D-09 | ANSWER | How much did Maria put in? | PASS |
| W-01 | CARD | Money out Jun ₱2,000.00, Nov 03 | PASS |
| W-02 | CARD | Money out Jun ₱1,500.00 | PASS |
| W-03 | CARD | Money out Jun ₱2,000.00 (fixed) | PASS |
| W-04 | CARD | Money out Jun ₱1,000.00 | PASS |
| W-05 | CARD | Money out Maria ₱3,000.00 | PASS |
| W-06 | CARD | Money out Maria ₱5,000.00 | PASS |
| W-07 | CARD | Money out Jun ₱3,000.00 | PASS |
| W-08 | ANSWER | Jun only has ₱18,000.00 | PASS |
| W-09 | ANSWER | two changes | PASS |
| F-01 | CARD | Edit deposit → ₱90,000.00 | PASS |
| F-02 | CARD | Edit withdrawal → ₱12,000.00 | PASS |
| F-03 | ASK → CARD | which entry → withdrawal → ₱6,000.00 | PASS |
| F-04 | CARD | Delete withdrawal ₱15,000.00 | PASS |
| F-05 | ANSWER | no deleted money entries | PASS |
| B-01 | CARD | Lyn, Bad | PASS |
| B-02 | CARD | Lyn, Bad | PASS |
| B-03 | CARD | Angel, Bad | PASS |
| B-04 | CARD | Lyn, Good | PASS |
| B-05 | CARD | Rico, Okay | PASS |
| B-06 | CARD | Lyn, Good | PASS |
| B-07 | CARD | Lyn, Cleared | PASS |
| B-08 | → AI | test-mode reply | PASS |
| B-09 | ANSWER | Dan saved Bad, rule Okay | PASS |
| N-01 | CARD | Add borrower Juan Dela Cruz | PASS |
| N-02 | CARD | Add borrower Ana De Los Santos | PASS |
| N-03 | CARD | Add lender Ana Santos | PASS |
| N-04 | ANSWER | asks first and last name | PASS |
| N-05 | CARD | Rename → Ricardo Mendoza | PASS |
| N-06 | CARD | Rename lender → Junior Reyes | PASS |
| N-07 | CARD | Delete lender Maria Cruz | PASS |
| N-08 | CARD | Delete lender Jun Reyes | PASS |
| N-09 | ASK → CARD | Keep the loans → Delete borrower Lyn | PASS |
| N-10 | → AI | test-mode reply | PASS |
| N-11 | → AI | test-mode reply | PASS |
| N-12 | ANSWER | Angel has no photo to remove | PASS |
| N-13 | CARD | Starting capital Maria ₱50,000.00 | PASS |
| N-14 | CARD | Starting capital Jun ₱30,000.00 (fixed) | PASS |
| X-01 | CARD | Extend Rico 2 weeks | PASS |
| X-02 | CARD | Extend Angel 1 week, interest paid now | PASS |
| X-03 | CARD | Extend Rico 1 week | PASS |
| X-04 | ASK → CARD | 1–4 weeks → Extend Bea 1 week | PASS |
| X-05 | CARD | Weekly interest Rico | PASS |
| X-06 | CARD | Weekly interest Angel | PASS |
| X-07 | CARD | Note Dan "will pay Friday" | PASS |
| X-08 | CARD | Note Rico "asked for more time" | PASS |
| X-09 | CARD | Note Rico "Rico pays on Saturdays" | PASS |
| X-10 | ANSWER | What should the note say? | PASS |
| X-11 | ANSWER | no note on Dan's loan | PASS |
| X-12 | CARD | Delete Dan's loan | PASS |
| X-13 | CARD | Delete Dan's loan | PASS |
| X-14 | ANSWER | Dan has no deleted loan | PASS |
| X-15 | CARD | Edit Bea → ₱20,000.00 | PASS |
| X-16 | ANSWER | 2 lenders, how much from each | PASS |
| X-17 | CARD | Edit Angel, 8% a week | PASS |
| X-18 | CARD | Advance Rico ₱3,000.00 | PASS |
| X-19 | CARD | Proof Rico | PASS |
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
| C-10 | ANSWER | ₱45,000.00 Maria | PASS |
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

### My round 3 questions (rerun)

| ID | Prompt | Actual (short) | Verdict |
|---|---|---|---|
| OWN-01 | how much is floating in each pot | ₱223,500.00 across 4 pots | Good |
| OWN-02 | who owes the most? | ₱38,400.00 Angel, top 3 | Good |
| OWN-03 | how much did John Ross earn in October? | ₱12,000.00 | Good |
| OWN-04 | magkano ang hawak ni Jun | ₱18,000.00 floating in Jun's pot | Good (fixed) |
| OWN-05 | which borrower paid the least last month? | ₱0.00 each: Angel, Dan, Lyn, Rico | Good (fixed) |
| OWN-06 | how much has Rico paid so far | ₱0.00; still owes ₱25,600.00 | Good |
| OWN-07 | how much did each lender withdraw last month | ₱15,000.00, Maria | Good (fixed) |
| OWN-08 | how many loans did Maria fund? | 3 loans (2 unpaid, 1 paid) | Good (fixed) |
| OWN-09 | total money out on loan per pot | ₱95,000.00 across 4 lenders | Good (fixed) |
| OWN-10 | sino ang may pinakamalaking utang | ₱38,400.00 Angel, the most | Good (fixed) |
| OWN-11 | how much interest will Jun still get? | ₱4,400.00 for Jun | Good |
| OWN-12 | how much did we earn this year | ₱38,500.00 in 2026 | Good |
| OWN-13 | how much did Dan borrow | ₱12,000.00 in all | Good |
| OWN-14 | how many loans are overdue? | 1 loan overdue right now | Good (note: no row saying whose) |
| OWN-15 | what's John Ross's starting capital? | ₱0.00 | Good (₱0.00 looks odd) |
| OWN-16 | how much did Lyn borrow this month | ₱8,000.00 | Good |
| OWN-17 | kita ni Maria ngayong taon | ₱8,000.00 in 2026 | Good |

### New questions of my own

| ID | Prompt | Kind | Actual (short) | Verdict |
|---|---|---|---|---|
| NEW-01 | how much did Angel pay in total? | ANSWER | ₱55,500.00 paid by Angel in all; still owes ₱38,400.00 | Good |
| NEW-02 | sino pinakamaraming kinita | ANSWER | ₱19,500.00 John Ross, the most of any lender | Good |
| NEW-03 | how many loans does Rico have? | ANSWER | 1 loan (1 unpaid) | Good |
| NEW-04 | how much does Jun have out on loan? | ANSWER | ₱22,000.00 of Jun's money out on loan | Good |
| NEW-05 | what is the average loan size? | → AI | test-mode reply | OK (not a server figure) |
| NEW-06 | who deposited the most this year? | ANSWER | ₱125,000.00 John Ross, the most | Good |
| NEW-07 | how much interest will I still get? | ANSWER | ₱24,920.00 across 4 lenders | **Wrong** (should be Demo Admin ₱14,120.00) |
| NEW-08 | how much did Bea borrow last year? | ANSWER | ₱0.00 in 2025; owes ₱32,000.00 today | Good |
| NEW-09 | Jun deposited 5k | CARD | Money in: Jun ₱5,000.00, Nov 04 | Good |
| NEW-10 | magkano na ang naibalik ni Bea | → AI | test-mode reply | **Missed** (should be ₱78,000.00 paid) |
| NEW-11 | how much did each borrower pay this month? | ANSWER | Nothing paid this month for any borrower | Good |
| NEW-12 | Jun has 18k floating right? | ANSWER | ₱18,000.00 floating in Jun's pot (no card) | Good |
