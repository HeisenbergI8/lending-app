# A seeded row is not proof the business can create that state

**When this applies:** reconciling a displayed figure against the database — the
`data-truth` agent, the `label-truth` skill, or any time you are about to call a
number wrong because of the rows you found.

On 2026-09-21 a seven-agent sweep produced 16 findings. **Five were false, and all
five were the same row.**

Loan `cmubaygcy0001mkooqwi06g8z` carries `startOn = 2026-09-28`, a week in the
future. Every screen that sums active loans counts it as money already handed to a
borrower. Four agents independently, and correctly, measured the gap — and four
agents independently concluded the labels were lying, on the dashboard, the summary
PDF, the lender PDF, the borrower PDF, and the lender history chart.

**The admin records a loan only after the borrower has received the money.** A
forward-dated loan is something the seed script made. The business does not produce
it, so counting it as out on loan is right, and all five findings were noise.

## Why reading the code could not catch it

`createLoan` (`src/server/loans/actions.ts:98`) validates that the start date
*parses*. Nothing rejects a future one. The constraint is in how the admin works,
not in the schema, not in a check, not in a type.

Worse, the evidence was sitting in the repo and got read the wrong way round.
`docs/FEATURES.md:140` says the start date is *"typed by the admin — when the
borrower actually received the money"*. One agent quoted that exact line and used
it to argue the figure was wrong, when it says the opposite: if the date is typed on
receipt, a future date means the row is fake.

## Do this instead

Before writing up a mismatch that rests on a small number of rows, ask **can the app
actually produce this row?** Three cheap checks:

1. **Find the write path.** Does an action, a form or a migration create this state,
   or did only the seed script? A state with no writer is a seeding artifact.
2. **Read `docs/FEATURES.md` for what the field MEANS**, not just whether the figure
   is mentioned. A field defined by when a human types it carries a constraint no
   column can express.
3. **Count the distinct rows behind your findings.** Five findings from one row is
   one finding at most, and probably a question for the admin rather than a defect.

If you cannot settle it, the verdict is **Cannot tell**, and the honest form is:
"this figure diverges on row X; I could not establish whether the app can create
row X." That is a complete answer and costs nobody an afternoon.

## The asymmetry still holds

Do not over-correct into silence. A missed wrong figure reaches someone's money; a
false alarm costs a conversation. Stay willing to flag — but a sweep that spends a
third of its findings on rows the business cannot create is spending the credibility
the real findings need.
