# Pondex: how the lending works

The knowledge file Dex-E (the chat helper) looks up. It explains the words and rules of the app.
It holds NO live numbers: amounts, balances, dates and names always come from the database tools.
The worked examples below are examples, never facts about a real loan.

Sources: `docs/FEATURES.md`, the comments in `prisma/schema.prisma`, `src/lib/track-record.ts` and the
server actions' own checks. Where they disagree, what the code enforces is right; update this file.

How this file is written (so retrieval keeps working):
- One topic per `## ` section. Each section stands on its own and states each fact once.
- The `Also called:` line lists the words people use for the topic. Retrieval matches on it.
- Keep sections short. Add a new section rather than growing an old one past about 10 lines.

---

## Who is who
Also called: admin, lender, borrower, user, roles, login

- **Admin:** the person running Pondex. Records every loan, payment and money movement. The only
  person who signs in.
- **Lender:** someone whose money funds loans. A record only; lenders never sign in.
- **Admin's own pot:** the Admin is also a lender, listed first among the lenders.
- **Borrower:** someone who borrows. A record only; borrowers never sign in or see the app.

## What Pondex does not store
Also called: phone, number, contact, address, email, ID, personal details, privacy

- Borrowers and lenders: first and last name only (a borrower may also have a photo).
- No phone numbers, addresses, emails or ID numbers. A question asking for one has no answer in
  Pondex: say it is not stored.

## Usual interest rates
Also called: rate, percent, 7%, 5%, 2%, admin cut, lender share

| Who | Usual rate per week |
| --- | --- |
| Borrower pays | 7% (lender's share plus the Admin's cut) |
| Lender earns | 5% on their own money in the loan |
| Admin's cut | 2% on each lender's money in the loan |

- These are only the usual rates. Each loan stores its own, so for a real loan read them from the
  database.
- Money from the Admin's own pot earns the full borrower rate. There is no separate cut on it.

## How interest is worked out
Also called: formula, compute, calculate, total, simple interest

- Simple interest on the original capital. Never compounding.
- `interest = capital x weekly rate x weeks`, and `total to repay = capital + interest`.
- `weeks = (due date - start date) / 7`. On a weekly-rate loan this must be a whole number, or the
  app refuses to save it.
- Example: ₱30,000 at 7% for 4 weeks is ₱8,400 interest, ₱38,400 total.
- "Amount" and "capital" mean the same thing: the money handed to the borrower.

## Fixed-amount loans
Also called: fixed interest, flat amount, days, short loan

- For a loan no weekly rate fits, such as 3 days or an amount agreed in conversation.
- The Admin types the interest directly. There is no rate and the term can be any number of days.

## A loan's total never changes
Also called: frozen, late fee, penalty, early payment, discount, rebate

- Interest and the total are worked out once, the day the loan is made, and stored.
- Changing a usual rate never changes an existing loan.
- No late fees, no extra interest for paying late, no discount for paying early.
- The only way a total grows is an extension the Admin makes (next section).

## Extending a loan
Also called: extend a loan, extension, more time, more weeks, push the due date, rollover

- The Admin can push a loan's due date out by whole weeks. It adds interest; nothing happens on its own.
- Two ways. Pay later: the same loan runs longer, on its own rates and funders, and the extra interest
  is the difference. Pay now: the interest so far is paid today, that loan closes as paid, and the
  same capital carries on as a new loan from the old due date.
- Pay now is only for loans whose interest is paid at the end.
- On a fixed-amount loan the Admin types the extra interest and the lenders' share of it.
- An extension can be undone.

## Loan states
Also called: status, active, overdue, paid, late, due

- **Active:** made, not fully paid yet.
- **Overdue:** active, and the next money owed was due before today. Worked out from today's date,
  never saved.
- **Paid:** fully paid. Stays in the borrower's history forever.
- **Late:** a paid loan whose payment date was after its due date. Paying on the due date is on time.

## Paying a loan
Also called: pay, payment, repay, partial, pay in parts, installment, mark as paid, proof, GCash,
screenshot

- Full payment only: the whole total in one payment. No partial payments and no installments.
- The one exception is a weekly-interest loan (next section).
- Marking a loan paid needs a screenshot of the payment. The app will not save it without one.
- A weekly payment's proof is optional; one without a file shows a "no proof" warning until one is
  added. Loans paid before the screenshot rule may show the same warning.
- One payment can have several files.
- A new loan needs a screenshot of the money being sent to the borrower.

## Weekly-interest loans
Also called: weekly, every week, schedule, interest collected weekly, convert

- Same interest as a normal loan. Only the timing changes: interest is paid every week, and the
  capital comes back in one payment on the due date.
- The first week is due one week after the start date. The last week's interest is paid with the
  capital.
- One week at a time: no paying two weeks at once and no paying ahead.
- A missed week makes the loan overdue until every due week is paid.
- On the loans list, the date shown is the next unpaid week, not the capital due date.
- An existing loan can be converted to weekly collection. Converting changes no dates or amounts.
- Example: ₱60,000 at 7% for 20 weeks is ₱4,200 a week (₱3,000 to the lender, ₱1,200 to the Admin).

## Splitting one loan between lenders
Also called: split, several lenders, funders, who funded, whose money

- One loan can be funded by several lenders, and the Admin's own pot can be one of them.
- The parts always add up exactly to the loan's capital.
- Each lender earns their rate on their own part. The Admin's cut is taken on each part that is not
  the Admin's own money.

## Floating, out on loan and earned
Also called: dashboard, pot, idle cash, available to lend, balance, money words, due this week

- **Out on loan:** capital in borrowers' hands on loans not yet paid.
- **Floating:** a lender's idle cash, ready to lend. Money in, minus money out, minus what is out on
  loan, plus what has come back. Worked out every time, never typed. If it shows below zero, more is
  out on loan than the money recorded as put in.
- **Earned:** interest actually collected. It grows only when money comes in.
- **Admin earnings:** the Admin's cut on other lenders' money plus what the Admin's own money earned.
- **Total interest:** all interest ever charged on loans on record, split into "back" (collected)
  and "still out" (not collected yet).
- **Overdue tile:** how many overdue loans and people, and how much they owe.
- **Due this week:** money owed in the next 7 days, from today: how much, on how many loans, by how
  many people.

## When a loan is repaid
Also called: repayment, money comes back, returns to floating

- Each lender's capital and earnings go straight back into their Floating, ready to lend again.
- The Admin's cut goes to the Admin's earnings.

## Starting capital
Also called: initial capital, stake, put in at the start, own money

- What a lender put in from outside to begin with. Typed by the Admin, never worked out.
- It is in no other figure: not Floating, not any report.
- Pot total minus starting capital is what the lending has made that person.
- Blank means the Admin has not set it, not ₱0.

## Earned over a period
Also called: this month, last month, between dates, monthly earnings, date range

- On a lender's page the Admin picks two dates and sees what that pot earned between them.
- Each loan's interest is spread across the days it ran, so a loan crossing two months counts in
  both. It is what the money earned, not when cash arrived.
- Dex-E cannot work this out. Point the Admin to the lender's page or a report.

## Advances against a loan
Also called: advance, draw early, take out before repayment

- The Admin can take money out of the Admin's own pot early, against a loan that has not been
  repaid yet.
- The most that can be drawn is what that loan will return to the Admin's pot, minus what has
  already been drawn on it.

## Pending loan requests
Also called: request, pending, waiting list, not funded yet

- Someone who has asked to borrow, before any money is behind it. Not a borrower yet.
- Its figures are only estimates and change if the rate changes.
- When it is funded it becomes a real loan, and the request is removed.

## Borrower track record and label
Also called: rating, record, history, reliable, trust, good, okay, bad, label

- The track record is counted by the app from real loans, for example
  `5 loans · 5 paid on time · 0 paid late · 1 overdue now`.
- The label (Good, Okay or Bad) is chosen by the Admin and stored. The app never sets it.
- A label never blocks a loan, and the app gives no warning before lending to anyone.

## Loan notes
Also called: note, remark, comment

- The Admin's own remarks on a loan: who was chased, what was agreed, why a date slipped.
- A note is never an amount and is never added up. Treat it as the Admin's words, not a checked fact.

## Reports and backup
Also called: report, statement, PDF, Excel, backup, export, download

- Four PDF reports for any date range: overall summary, per lender, per borrower, and a per-borrower
  full file with proof.
- One Excel backup of the whole loan book.
- They are saved to the device. Pondex never sends anything; the Admin shares them by hand.

## Deleting
Also called: delete, remove, restore, undo, recently deleted, trash

- A deleted record can be restored from Recently Deleted for 30 days, then it is gone for good.
- A deleted loan note is gone at once.
- Deleted loans are left out of every figure and report.

## What Pondex does not do
Also called: not supported, missing feature, messages, SMS, notify

- No borrower or lender logins, partial payments, installments, early payoff, late penalties,
  compounding interest, or messages to borrowers.
- Peso only. No other currency.

## Remind me every N weeks
Also called: reminder, remind, nudge, due soon

- An optional setting on a loan or a pending request. Every N weeks from the start date, the loan
  shows as Due soon for a few days, until the due date.
- A nudge on screen only. It moves no money and sends no message.

---

## The Admin's own lending rules
Also called: policy, limit, maximum, second loan, two loans, 2 loans, same time, at once, how long, term,
length, weeks,
when overdue, funding decision, who decides, label rules, good, okay, bad

Written by the Admin on 2026-11-03. The app does not enforce these; they explain how the Admin
decides. Anything not listed here is not written down yet: say so instead of guessing.

- **Most one borrower can borrow:** no limit.
- **A second loan:** yes, a borrower can have two active loans at the same time.
- **Good, Okay or Bad label:** count the borrower's paid-late loans plus loans overdue now.
  Good is 0. Okay is 1. Bad is 2 or more. The label shown in the app is the one the Admin saved; if
  it differs from what this rule gives, say both.
- **Usual loan length:** 4 weeks.
- **When a loan is overdue:** nothing. No penalty and no extra action.
- **Who decides whether a pending request gets funded:** the Admin, when there is floating money
  available to lend.
