# Review of docs/FEATURES.md — §5 "Weekly-interest loans", and the money model it sits inside

The section was added 2026-09-24 and is uncommitted at the time of planning (`git status` shows
`M docs/FEATURES.md`). It is the specification, not a draft to be improved.

## §5 — every settled rule, and where the plan honours it

| # | Rule, as written | Where |
| --- | --- | --- |
| 1 | "Built at creation from the same two dates. One instalment per whole week, the first falling one week after the start date, the last falling **on** the due date." | `weeklyDueDates`, Step 1.2, with a test asserting both ends |
| 2 | "Only a weekly-rate loan can be weekly-collected." | `fixedAmountTerms` refusal, Step 3.1 |
| 3 | "**The weeks must sum to the stored interest to the centavo** — the split is computed once and the final week absorbs any remainder, exactly as the lender split already does." | plan §1.2; `weeklySlices`; the invariant tests |
| 4 | "**One week at a time.** No paying two weeks in one go, no paying ahead." | week is read from the loan, never a field, Step 3.4 |
| 5 | "Marked paid with proof attached in the same step, optional but flagged." | `markWeekPaid` reuses the proof path |
| 6 | "**February is one payment: the capital plus that final week's interest.** The last week is not collected separately." | `settlingAmount` in Step 3.3; `markWeekPaid` refuses the final week |
| 7 | "That week's money is released **immediately**: the lender's share into their floating, the Admin's cut into Admin earnings." | Phase 5, `ledgers()` third bucket |
| 8 | "The **capital stays out on loan** until February." | `activePrincipal` untouched |
| 9 | "'Out on loan' holds steady at ₱60,000 while 'Earned' climbs each week it is actually collected — never before." | falls out of `lenderPosition` unchanged — see `floating-review.ts` |
| 10 | "The loan shows **Overdue**, and the missed week **stays owed**. The next week piles on top." | `nextUnpaidWeek` returns the EARLIEST unpaid, not the latest |
| 11 | "No penalty, no extra interest. The total stays frozen." | nothing recomputes; `totalCentavos` never written after creation |
| 12 | "The loan returns to Active once every due week is paid." | falls out of 10 |
| 13 | "The due date shown is the **next unpaid weekly date**, not February." | Step 6.3 |
| 14 | "The loan page shows both." | Step 6.1/6.2, `capitalDueOn` beside the schedule |
| 15 | "The schedule is generated from the dates it already has, and the Admin ticks off the weeks already paid, each with its own paid date." | Step 7.4 |
| 16 | "The per-lender and per-borrower reports list the weekly payments." | Step 7.2 |
| 17 | "The Excel backup's Payments sheet carries **one row per weekly payment**." | Step 7.1 |

**IMPORTANT — the worked example, and the arithmetic to check an implementation against:**

> "Angel's loan, 60,000 at 7% for 20 weeks: ₱4,200 a week, of which the lender keeps ₱3,000 and
> the Admin takes ₱1,200. Total interest ₱84,000, unchanged from what the same loan would charge
> today."

60,000 × 7% = 4,200/week × 20 = 84,000 ✓. Lender 5% = 3,000, Admin 2% = 1,200 ✓. Divides exactly, so
this example exercises **no** remainder. `tests/money/weekly.test.ts` opens with it and then runs the
awkward cases, because the spec's own example cannot catch a rounding bug.

**NOTE, and it matters for testing:** the real loan in the database is funded **100% by the Admin's
own pot**, so its funding row is `lenderRateBps 700, adminCutBps 0`. Its weeks pay the Admin ₱4,200
as *earnings on their own capital*, not ₱3,000 + ₱1,200. Both are correct; they are different loans.
Anyone testing against the spec's 3,000/1,200 figures on the real row will think something is broken.

## §12 — what is explicitly out, and must not be re-raised

> "Partial payments · installments · early payoff (**weekly interest collection is not an
> installment plan — see section 5**)"
> "A weekly background job recalculating interest"

Both parenthetical clarifications were added with §5. **A weekly payment is not a partial payment**:
no single amount is ever paid in parts. **Nothing in the plan schedules a job.**

## §6, amended

> "Full payment only ... **The one exception is a weekly-interest loan** (section 5), where the
> interest is collected week by week and the capital in one go at the end. Even there, no single
> amount is ever paid in parts."

## §2 — the money model the feature sits inside

- Rates per week; admin cut set **per loan**, 2% is only the usual.
- Simple interest on the **original capital**, never a running balance.
- Computed **once** at creation.
- Mixed funding: the Admin's own capital earns the full 7% and pays no cut. **No branch asks whose
  money it is** — the rates on `LoanFunding` carry it.
- `FIXED_AMOUNT` exists for loans no rate describes. It cannot be weekly-collected.

## §13 — open questions

> "**None.** ... Weekly-interest loans were specified on 2026-09-24, answer by answer."

**IMPORTANT:** the Follow Ups in the plan are therefore *not* re-opened feature questions. They are
(a) one factual mismatch between the spec's narrative and the database, (b) engineering decisions the
spec does not reach — a stored column, a tile's wording, what "still to collect" counts — and (c)
defects found while planning. None of them re-litigates a settled rule.

## The one thing the spec describes that the database does not have

§5 opens: "Angel borrows ₱60,000 in September and returns the capital in February ... twenty-odd
weeks." The live row (measured 2026-09-24) runs **2026-09-22 to 2026-10-20** — four weeks, ₱16,800
interest, ₱76,800 total. Conversion builds the schedule from the dates the loan already has, so it
cannot produce the spec's twenty weeks. **The due date has to be edited first.** Follow Up 1.
