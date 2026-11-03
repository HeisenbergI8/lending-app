# Pondex: how the lending works

The knowledge file Ask Pondex reads before answering. It explains the words and rules of the app.
It holds NO live numbers: amounts, balances, dates and names always come from the database tools,
never from this file.

Sources: `docs/FEATURES.md` and the comments in `prisma/schema.prisma`. If this file and those
disagree, those are right; update this file.

Each section stands on its own, so it can be searched and quoted alone.

---

## Who is who

- **Admin:** the person running Pondex. Records every loan, payment and money movement. The only
  user who signs in.
- **Lender:** someone whose money funds loans. The Admin is also a lender, with their own pot.
- **Borrower:** someone who borrows. Pondex stores first and last name only.
- **Pending loan (request):** someone who has asked to borrow, before any money is behind it. Not a
  borrower yet. It becomes a borrower and a loan the moment the loan is actually made.

## What Pondex does NOT store

- No phone numbers, addresses, photos of IDs, or any borrower or lender detail beyond first and
  last name (a borrower photo may be set by the Admin, nothing else).
- So a question asking for a phone number or address has no answer in Pondex. Say it is not stored.

## Interest: the usual rates

| Who | Usual rate | Meaning |
| --- | --- | --- |
| Borrower pays | 7% per week | the lender's share plus the Admin's cut |
| Lender earns | 5% per week | on their own money in the loan |
| Admin's cut | 2% per week | set per loan; 2% is only the usual |

- These are the usual numbers, not fixed ones. Each loan stores its own rates. For a specific
  loan, always read that loan's rates from the database.
- When the Admin funds a loan with their own money, the Admin earns the full borrower rate and
  takes no separate cut.

## How interest is worked out

- Simple interest, never compounding, always on the original capital.
- `interest = capital x weekly rate x weeks`
- `total to repay = capital + interest`
- `weeks = (due date - start date) / 7`, and on a weekly-rate loan it must be a whole number.
- Example: ₱30,000 at 7% for 4 weeks = ₱8,400 interest, ₱38,400 total.

## Fixed-amount loans

- For a loan no weekly rate fits (for example 3 days, or an amount agreed in conversation).
- The Admin types the interest amount directly. There is no rate, and the term can be any number
  of days.

## A loan's total never changes

- Interest and the total are worked out once, the day the loan is made, and stored.
- Nothing recalculates them later. Changing a usual rate never changes what an existing borrower owes.
- No late fees, no extra interest for paying late, and no discount for paying early.

## Loan states

- **Active:** made, not paid yet.
- **Overdue:** still active, and the due date has passed. It is not a separate saved state; it is
  worked out from today's date. The app treats 1 to 2 days past due as late.
- **Paid:** fully paid. Moves to the borrower's history and stays there forever.
- Loans are never extended and never rolled into a new loan.

## Paying a loan

- Full payment only: the whole total in one payment, on the due date. No partial payments.
- The one exception is a weekly-interest loan (next section).
- Proof of payment (for example a GCash screenshot) is optional but flagged: a paid loan without
  proof shows a "no proof" warning until a file is added.

## Weekly-interest loans

- Same interest as a normal loan. Only the timing changes: the interest is collected every week,
  and the capital comes back in one payment at the end.
- One payment per week, the first one week after the start date. The last week's interest is paid
  together with the capital on the due date.
- One week at a time: no paying two weeks at once, no paying ahead.
- A missed week makes the loan overdue. It stays owed, and the next week piles on top. Once every
  due week is paid, the loan is active again.
- On the loans list, the date shown is the next unpaid week, not the final due date.
- Example: ₱60,000 at 7% for 20 weeks = ₱4,200 a week (₱3,000 to the lender, ₱1,200 to the Admin),
  ₱84,000 interest in total.

## Splitting one loan between lenders

- One loan can be funded by several lenders. Each lender's part is recorded separately.
- The parts always add up exactly to the loan's capital.
- Each lender earns their rate on their own part. The Admin's cut is taken on each part not funded
  by the Admin.

## Money words on the dashboard

- **Out on loan:** capital currently in borrowers' hands on loans not yet paid.
- **Floating:** a lender's idle cash, ready to lend. Money in, minus money out, minus what is out
  on loan, plus what has come back.
- **Earned:** interest a lender has actually collected. It grows only when money is collected,
  never before.
- **Interest owed:** interest on unpaid loans that has not come in yet. "Back" is interest already
  collected; "Total" is both together.
- **Due this week:** money owed in the next 7 days, with how many loans and people.
- **Pots:** one card per lender showing Floating, Out on loan and Earned.
- **Starting capital:** what a lender put in from outside to begin with. Typed by the Admin, not
  worked out, and not part of Floating or any report.

## When a loan is repaid

- The lender's capital and their earnings go straight back into their Floating.
- The Admin's cut goes into the Admin's earnings.

## Borrower track record

- Shown as, for example, `5 loans · 5 paid on time · 0 late`, counted from real payments.
- The Admin can add their own label on top: Good, Okay or Bad.
- A rating never blocks a loan. Pondex gives no warning before lending to a badly rated borrower.

## Notes on a loan

- The Admin's own remarks on a loan: who was chased, what was agreed, why a date slipped.
- Notes are never amounts; nothing adds them up. Treat a note as the Admin's words, not as a fact
  checked by the app.

## Deleting

- A deleted record can be restored for 30 days from Recently Deleted. After that it is gone for good.
- A deleted loan note is gone at once; notes are not kept in Recently Deleted.

## What Pondex does not do

- Borrower or lender logins, partial payments, installment plans, early payoff, late penalties,
  extensions, rollovers, compounding interest, reminders, or messages to borrowers.

---

## The Admin's own lending rules

The Admin's personal rules, written by the Admin on 2026-11-03. The app does not enforce them; they
explain how the Admin decides. Anything not listed here is not written down yet: say so instead of
guessing.

- **Most one borrower can borrow:** no limit.
- **A second loan:** yes, a borrower can have two active loans at the same time.
- **Good, Okay or Bad label:**
  - Good: never late, and pays in advance.
  - Okay: late once or twice, or never late but does not pay in advance.
  - Bad: late more than 2 times.
- **Usual loan length:** 4 weeks.
- **When a loan is overdue:** nothing. No penalty and no extra action.
- **Who decides whether a pending request gets funded:** the Admin, when there is floating money
  available to lend.
