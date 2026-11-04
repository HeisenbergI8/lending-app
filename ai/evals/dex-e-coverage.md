# What Pondex shows and does, and how Dex-E covers it (2026-11-04)

Every screen, report and filter in the app, with who in Dex-E answers it:

- **Server**: answered by the server itself, no AI, instant (`src/lib/quick-answers.ts`, `src/server/assistant/server-cards.ts`).
- **AI tool**: the AI can look it up (`src/server/assistant/tools.ts`), for wordings the server does not catch.
- Both use the same functions as the screen, so Dex-E and the app never disagree.

## Reading (questions)

| Screen | What it shows | Example question | Server | AI tool |
|---|---|---|---|---|
| Dashboard | Out on loan, floating, earned, interest owed | "How much is out on loan?" | Yes | `get_overview` |
| Dashboard | Overdue, due this week, who owes the most, borrower count | "Who is overdue?" | Yes | `get_overview` |
| Dashboard | Each pot's floating | "How much is floating in each pot?" | Yes | `list_lenders` |
| Loans | Loans by name, status, due dates, amount | "Which loans are due next week?" | Yes (by due dates) | `find_loans` |
| Loans | Who is due next | "Who is due next?" | Yes | `find_loans` |
| Loan page | One loan: rates, schedule, funders, notes, proofs | "Show Rico's loan details" | No | `get_loan` |
| Borrowers / borrower page | What one borrower owes, their loans | "How much does Angel owe?", "Rico's loans" | Yes | `find_borrower` |
| Borrower page | Track record and label (saved vs by the rule) | "Is Dan a good borrower?" | Yes | `find_borrower` |
| Lenders / lender page | One pot: floating, out on loan, all-time earned | "How much does Maria have?", "How much did Maria earn?" | Yes | `get_lender`, `list_lenders` |
| Lender page | Floating on a future date (projection) | "How much will Maria have by Nov 30?" | Yes | `floating_on` |
| Money history | Deposits, withdrawals, lent out, paid back, by lender, type and dates | "What came in last week?", "Maria's deposits this month" | Yes | `money_history` |
| Pending loans | Requests waiting | "Any pending requests?" | Yes | `list_pending` |
| Recently Deleted | What can be restored | "What's in Recently Deleted?" | Yes | `list_deleted` |
| Reports: summary | Lent out, collected, Admin earned, loans made and repaid, for dates | "How much did we lend in October?" | Yes | `period_summary` |
| Reports: Admin's cut | Agreed, collected, still to come, for dates | "How much is my cut this month?" | Yes | `admin_cut` |
| Reports: lender statement | A lender's earnings for dates | "How much did John Ross earn this month?" | Yes | `lender_earnings` |
| Reports: borrower statement | A borrower's borrowed and paid for dates | "How much did Angel pay in October?" | Yes | `borrower_statement` |
| Rules | Labels, interest, proof, how the app works | "What makes a borrower Good, Okay or Bad?" | Yes (labels) | `read_rules` |
| Notes | Search notes | "Which loan has a note about Friday?" | No | `search_notes` |

Periods the server understands: today, yesterday, this / last / next week, this / last / next month, a month by name
("October", "Oct 2025"), this / last year, "from Oct 1 to Oct 15", and Taglish ("ngayong buwan", "nakaraang buwan").
Names come from the account's own borrower and lender lists, never from a fixed list.

## Changing (always a card the Admin confirms)

All 37 actions in `src/server/assistant/actions.ts`. The server makes the card for the common ones; the AI covers the rest.

| Area | Actions | Server |
|---|---|---|
| Loans | new loan (one or several lenders), fund a request, edit amount / rate / dates, extend, switch to weekly interest, advance, add proof, delete, restore | Yes |
| Loans | undo an extension, remove a loan proof file | No (AI) |
| Payments | a week paid, fully paid, undo a payment, undo a paid week | Yes |
| Payments | add proof to a past payment, remove a payment proof file | No (AI) |
| Money | deposit, withdrawal, fix an entry, delete or restore an entry, starting capital | Yes |
| People | add borrower or lender, rename, label, remove photo, delete, restore | Yes |
| Notes and requests | add or delete a note, add or remove a request | Yes |

## Not in Dex-E on purpose

Signing in or out, changing the password, uploading a new borrower photo, downloading report files, and theme
settings: done on their own screens.
