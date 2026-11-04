# Every kind of question the Admin can ask Dex-E (2026-11-04)

Dex-E does not keep a list of sentences. It reads each question as three parts and answers any combination:

**What** (the figure) × **Who** (the people) × **When** (the time), plus an optional **ranking** or **count**.

Code: `src/lib/command/question.ts` reads the parts; `anyFigureCheck` in `src/server/assistant/server-cards.ts`
answers them from the same functions as the screens (Lenders and Borrowers lists, Reports statements).

## What: the figures

| Figure | Whose | Also said as | Changes over time? |
|---|---|---|---|
| Earned | lender | earnings, kita, kinita, income, profit, tubo | Yes (a period, or all time) |
| Floating | lender | available, free, ready to lend, idle, cash on hand, natitira, "how much does X have", pot | No, as of today |
| Out on loan | lender | lent out, deployed, nasa labas | No, as of today |
| Interest still to come | lender | pending interest, interest owed / unpaid | No, as of today |
| Starting capital | lender | initial capital, puhunan, started with | No |
| Deposited | lender | deposits, money in, put in, topped up, nilagay | Yes |
| Withdrawn | lender | withdrawals, took out, cashed out, kinuha | Yes |
| Still owed | borrower | owe, utang, balance, remaining, unpaid | No, as of today |
| Overdue | borrower | late, delayed, behind, atrasado | No, as of today |
| Paid | borrower | payments, bayad, binayaran, repaid, hulog | Yes |
| Borrowed | borrower | hiram, hiniram, loaned | Yes |
| How many | loans, borrowers, lenders | ilan, number of | Some (loans made or repaid in a period) |

Report figures with their own answers: lender earnings statement, borrower statement, summary (lent out, collected,
loans made and repaid), Admin's cut, money history, floating on a future date, loans due by dates, track record,
Recently Deleted. See `dex-e-coverage.md`.

## Who

| Said | Means |
|---|---|
| A name ("Maria", "john ross", "Angel Dela Cruz") | That person, from the account's own lists; a typo is fine; two matches are asked about |
| each / every / per / all / lahat / bawat / plural ("lenders", "borrowers") | One row per person, with the total on top |
| lender, pot, investor, funder | A lender (each lender has their own pot) |
| borrower, client, customer | A borrower |
| nothing said | Whoever the figure belongs to: earnings and floating are lenders', owing and paying are borrowers' |
| I, me, my pot, the admin | The Admin's own pot |
| who … most / least, highest, biggest, pinakamalaki | Everyone, ranked, the top one first |

## When

today, yesterday, this / last / next week, this / last / next month, a month by name ("October", "Oct 2025"),
this / last year, "from Oct 1 to Oct 15", Taglish ("ngayong buwan", "nakaraang buwan", "nung October").
No period on a figure that changes over time means all time. A "now" figure (floating, still owed) is always today's,
and says so when a period was asked.

## Examples of combinations (all answered by the server, no AI)

- "How much did each lender earn this month?" · "Who earned the most in October?" · "Total profit last month?"
- "How much does each lender have?" · "Which lender has the most floating?" · "How much is in my pot?"
- "How much does each borrower owe?" · "Who owes the least?" · "Utang ng lahat ng borrowers?"
- "How much did each borrower pay in October?" · "Who paid the most last month?" · "Who borrowed the most?"
- "How much did each lender deposit this year?" · "Withdrawals per lender?"
- "How many borrowers are overdue?" · "How many loans were made in October?" · "How many lenders do I have?"

## What still goes to the AI

Questions mixing two figures or two conditions ("who is overdue and owes the most?"), "why" questions, comparisons
between two named people, and anything the server cannot read with confidence.
