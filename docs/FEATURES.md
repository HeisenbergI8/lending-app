# Lending App — MVP Feature Specification

**Status:** features agreed 2026-09-21. Technologies and architecture NOT yet decided.
**Source:** confirmed answer-by-answer with the owner (Immanuel). Every rule below was explicitly
confirmed — none of it is inferred. As of 2026-09-21 there are no open feature questions.

---

## 1. Who uses it

One admin. That's it.

- The admin (Immanuel) is the **only person who logs in**.
- **Lenders do not log in.** They exist as records the admin manages.
- **Borrowers do not log in.** They never see the app; the admin contacts them outside it.
- No roles, no permissions, no second account type in MVP.

---

## 2. The money model

This is the core of the app. Get this wrong and nothing else matters.

### The three rates

Every loan carries a spread between what the borrower pays and what the lender receives:

| Who | Rate | Notes |
| --- | --- | --- |
| Borrower is charged | **7% per week** | lender's share + admin's cut, combined |
| Lender receives | **5% per week** | on their own contributed capital |
| Admin cut | **2% per week** | set **per loan**, not global — 2% is just the usual |

Interest is **simple, not compounding**, and is charged on the **original capital** — never on a
running balance.

### The formula

```
interest = capital × rate × weeks
total    = capital + interest
```

`weeks` comes from the dates (section 5). The rate is per week, always.

### When a weekly rate does not fit — a fixed amount

**Added 2026-09-22.** Some loans do not run in weeks. Angel borrows ₱3,000 on Monday and repays on
Thursday; the ₱500 agreed is not 7% of anything, and no rate describes it honestly.

So the interest is set one of two ways, **chosen per loan**:

| Basis | What the admin types | Term |
| --- | --- | --- |
| **Weekly rate** (the default) | the rates, as above | must be whole weeks |
| **Fixed amount** | the interest in pesos, and the lenders' share of it | any number of days |

On a fixed amount:

- **Both figures are typed.** The admin says what the borrower pays on top (₱500) and how much of
  that the lenders keep (₱300). **The Admin keeps the rest** (₱200) — it is never a third typed
  number, because a third number can disagree with the first two.
- The lenders' share **splits between them by what each put in**, to the centavo.
- The Admin pot is not in that draw. If the Admin also funded the loan, their own money takes its
  share of the remainder instead.
- **No rate is stored**, because none was used. The loan screen shows the amounts and no percentage.
- The whole-weeks refusal does not apply. One day is the minimum; same-day is still refused.

Everything downstream is unchanged: floating funds, earnings, the lender and borrower profiles and
all four reports read peso amounts, not rates.

### Computed ONCE, at creation

When the admin creates the loan, the app does the math immediately and the total is **fixed from
that moment**. There is **no weekly background job**. Nothing recalculates. The "automated interest
computation" in the original feature list means *the app does the arithmetic so you don't*, not
*a scheduled task runs every week*.

### Worked example — single lender

Angel borrows ₱30,000 for 4 weeks. John Ross funds all of it.

| | Calculation | Amount |
| --- | --- | --- |
| Interest charged to Angel | 30,000 × 7% × 4 | ₱8,400 |
| **Angel repays** | 30,000 + 8,400 | **₱38,400** |
| John Ross earns | 30,000 × 5% × 4 | ₱6,000 |
| Admin earns | 30,000 × 2% × 4 | ₱2,400 |

### Worked example — split between lenders

Same loan, funded Maria ₱20,000 + Jun ₱10,000. Each lender earns 5% **on their own share**:

| | Calculation | Amount |
| --- | --- | --- |
| Maria earns | 20,000 × 5% × 4 | ₱4,000 |
| Jun earns | 10,000 × 5% × 4 | ₱2,000 |
| Admin earns | 30,000 × 2% × 4 | ₱2,400 |
| | | **₱8,400** ✓ |

### Worked example — mixed (admin's own money + a lender's)

**A single loan may be funded partly by the admin's own money and partly by lenders'.**
The admin's own capital earns the **full 7%** (there is no lender to pay). The admin still takes the
2% cut on the lenders' portions.

Angel's ₱30,000 = admin ₱10,000 + John Ross ₱20,000:

| | Calculation | Amount |
| --- | --- | --- |
| Admin, on own capital | 10,000 × 7% × 4 | ₱2,800 |
| Admin, cut on John Ross's share | 20,000 × 2% × 4 | ₱1,600 |
| **Admin total** | | **₱4,400** |
| John Ross earns | 20,000 × 5% × 4 | ₱4,000 |
| | | **₱8,400** ✓ |

---

## 3. Lenders and floating funds

- Each lender has a **profile**, tracked separately.
- A lender record stores **first name and last name only** — same as a borrower. No phone, no address.
- **The lender's profile lists the borrowers their money is currently funding**, with how much went
  to each: *John Ross → Angel ₱30,000 · Maria ₱15,000*. This is how the admin answers "where is
  John Ross's money right now?" without opening every loan.
- The admin records **money in and money out**: "John Ross added ₱100,000 on Jan 5",
  "John Ross withdrew ₱20,000 on Mar 2."
- **Floating funds = that lender's idle cash** — deposits, minus withdrawals, minus what is
  currently out on active loans, plus what has been repaid.
- **The admin has a floating pot too.** The admin appears in the lenders list alongside everyone
  else. The only difference is the rate: admin capital earns 7%, lender capital earns 5%.

### On repayment, everything returns to floating

When Angel repays ₱38,400:

- John Ross's floating increases by **₱36,000** — his ₱30,000 capital **plus** his ₱6,000 earnings,
  immediately available to lend again.
- The admin's ₱2,400 cut goes to the admin's earnings.

Earnings are **not** held in a separate "earned but not withdrawn" bucket. Capital and profit both
flow straight back into floating.

---

## 4. Borrowers

- A borrower profile stores **first name and last name. Nothing else.** No phone, no address,
  no photo, no referrer.
- **One borrower can have several active loans at the same time.**
- A borrower **can be created inline while creating a loan** — no need to add the person first and
  then come back. Same for a lender.
- The profile's purpose is the **track record** — how often this person borrows, and whether they pay.
- Paid loans stay on the profile **forever**. That history is the point.

---

## 5. Loans

### Fields

| Field | Meaning |
| --- | --- |
| Borrower | who owes |
| Capital | the money handed over. **"Amount" and "Capital" are the same thing — one field, not two.** |
| Start date | typed by the admin — when the borrower actually received the money |
| Due date | typed by the admin |
| Term | **derived** from the two dates, not typed. Shown as weeks when it divides evenly, days when it does not |
| Interest basis | weekly rate (default) or fixed amount, per loan |
| Borrower rate | default 7%/week. Not used, and not stored, on a fixed-amount loan |
| Admin cut | default 2%/week, set per loan. Same |
| Funding | which lender(s) and/or the admin, and how much each put in |
| Total | derived: capital + interest |

### The date rule — this needs care

The admin types **both** the start date and the due date. Two dates, not one, so a loan can be
entered a few days after the money actually changed hands without the week count going wrong.

```
weeks = (due date − start date) ÷ 7
```

**On a weekly-rate loan the result must be a whole number.** A fixed-amount loan skips this rule
entirely — see section 2 — because it has no week count to multiply by.

- As the admin types, the app shows the derived figure **highlighted next to the field**: `= 4 weeks`.
- If the dates don't divide into whole weeks, the app shows an **error and refuses to save**.
- Why it matters: a 30-day gap is 4.29 weeks. Silently rounding it would change what the borrower
  owes — ₱8,400 at 4 weeks versus ₱9,000 at 5. The error is deliberate, not a nicety.

Example: start Feb 1, due Mar 1 → 28 days → `= 4 weeks` ✓ → ₱30,000 × 7% × 4 = ₱8,400.

### States

- **Active** — created, not yet paid.
- **Overdue** — past the due date. Late is 1–2 days past due.
  - **No penalty.** No extra interest. The total stays frozen at whatever was computed at creation.
  - It simply shows as overdue so the admin can chase it outside the app.
  - Loans are **never extended** and never rolled into a new loan.
- **Paid** — moves to the borrower's history, kept forever.

### Editing

The admin can **edit or undo** a loan if something was entered wrong.

---

## 6. Payments and proof of payment

- **Full payment only.** No partial payments, no installments. The borrower pays the whole total
  once, on the due date.
- **No early payoff.** In practice it doesn't happen, and it is not being built. The total is fixed
  at creation regardless of when payment arrives.
- Recording a payment is **"Mark as Paid" with the proof attached in the same step**.
- **Proof is optional but flagged.** A loan can be marked paid with no file attached, but it shows a
  "no proof" warning until one is added — so nothing slips through quietly.
- **Several files per payment** (e.g. a GCash screenshot plus the chat confirming it).
- The admin uploads the files. Borrowers have no way to submit anything themselves.

---

## 7. Borrower ratings

Two parts, shown together:

1. **Counted track record**, computed by the app from real history:
   `5 loans · 5 paid on time · 0 late`
2. **The admin's own label** on top — Good / Okay / Bad — because the admin knows things the app
   can't see (she's family; she always warns me first; don't lend her over 20k).

- Displayed **next to the name in the main list**, not buried on the profile page.
- **It does not block anything.** No warning prompt when lending to a badly-rated borrower.
- **No free-text notes box** in MVP.

---

## 8. Main screen, search and filters

### Layout

- **Lenders across the top.** Each shows **Floating · Out on loan · Earned**. The admin appears here
  too, with their own pot.
- **Borrowers listed below**, with their rating next to each name.

### Finding things

Search by:
- Borrower name
- Lender name
- Amount, or a date range

Plus one-tap **status filters**: Active / Overdue / Paid.

---

## 9. Reports

Four kinds:

| Report | For |
| --- | --- |
| Overall summary | the admin — total out, total collected, earnings, who's overdue |
| Per lender | a statement to hand John Ross — money in, which loans, what he earned, what's still out |
| Per borrower | a statement for Angel — what she borrowed, owes, when due, what she's paid |
| Per borrower, full file | the admin's own records — every loan, payment and proof |

- **Any date range the admin picks.**
- Output is a **PDF, saved to the device**. The admin sends it manually (Messenger, email).
  The app does **not** send anything.
- No printing, no spreadsheet export in MVP.

---

## 10. Home dashboard

The opening screen. Big numbers at a glance:

- Total out on loan
- Total floating
- How many borrowers are overdue
- Admin earnings

---

## 11. Delete and Recently Deleted

**Deleting is reversible for thirty days.**

- One place, called **Recently Deleted**.
- Any record can be deleted for any reason, and restored whole within thirty days.
- Every row shows how long it has left.
- After thirty days a daily job destroys it permanently. There is no undo behind that.
- There is still no manual permanent-delete button: the clock is the only way out.
- A borrower or lender that live records still point at is kept past the thirty days
  rather than destroyed, and says so.

---

## 12. Explicitly OUT of MVP

Listed so they are not re-raised as gaps on every review. Each was **consciously decided against**,
not overlooked:

- Borrower logins · lender logins · any second user role
- Partial payments · installments · early payoff
- Late penalties · loan extensions · rollovers
- A weekly background job recalculating interest
- Compounding interest
- Due-date reminders or notifications
- Automatic SMS or messages to borrowers
- Free-text notes on profiles
- Warning prompts before lending to a poorly-rated borrower
- Printing · spreadsheet/CSV export · sending reports from inside the app
- Any borrower detail beyond first and last name
- A manual "delete permanently now" button

---

## 13. Open questions

**None.** All three remaining questions were answered on 2026-09-21 and folded into the sections
above: currency (§14), lender profile fields (§3), and inline borrower creation (§4).

---

## 14. Currency

**Philippine Peso (₱ / PHP) only.** Every amount in the app is pesos. There is no currency selector,
no conversion and no second currency — now or planned.
