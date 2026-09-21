---
name: label-truth
description: Mandatory before writing or editing anything that displays a figure from the database — a stat tile, a table column, a total, a badge, a chart series, a line on a PDF report. Makes the label's claim provable before it ships. Load it when the words next to a number are about to be chosen.
---

# Label Truth

A label is a **promise about a number**. This governs whether what it says is true.

The bug class this exists for is invisible to every other gate in this repo. It typechecks, it lints,
the tests pass, it renders, it matches `docs/FEATURES.md` — and the number is wrong, or right, with
words beside it that describe a different number. In a lending ledger that is not a cosmetic bug: it
is a wrong belief about somebody's money.

## The rule

> **Before you write the words next to a figure, write the query that proves them. If you cannot run
> it, say in a comment what the server actually computes.**

Two artifacts, both cheap, both permanent:

1. **The provenance comment** — what the query *actually* does, above the figure, in code.
2. **The proving query** — the SQL the label's plain reading implies, run once before shipping.

```bash
node .claude/harness/db-ro.mjs --grants        # confirm the connection first
node .claude/harness/db-ro.mjs "SELECT ..."    # one statement, read-only, enforced twice
```

The database IS reachable from this repo — `DIRECT_URL` in `.env`, through that script. Do not tell
the user a figure cannot be checked without running `--grants` first.

## Why the query and not just careful reading

Careful reading is what produced every mislabelled figure in the system this skill came from — seven
of them in a single file, each one obvious in hindsight, each one read over by several people. Only
measurement caught them. The pattern that recurs: the field name and the label agree, and *neither*
describes what the query returns.

And measurement has to sample properly. On one cached counter, **nine of the first ten rows agreed
exactly** — the cached value and the true value coincide wherever nothing has been rejected, which in
seed data is nearly everywhere. Row two was the only one that exposed it. Pull ten rows and hunt for
divergence; one agreeing row proves nothing.

In this repo the divergent rows are the interesting ones: a loan funded by two lenders, a payment
that was undone, a loan that was edited after creation, a soft-deleted borrower, anything belonging
to the demo account.

## Words that make a promise

Every one of these is a claim someone can check. If you use one, you owe it a query:

`total` · `all` · `only` · `active` · `paid` · `unpaid` · `overdue` · `outstanding` · `remaining` ·
`earned` · `due` · `available` · `floating` · `per` · `average` · `net` · `this month` · `to date`

A label with no adjective at all still promises **which noun it counts**. "Borrowers" beside a row of
loan counts gets read as loans. Naming the noun in the caption is usually the whole fix.

### Printing the bound is how you keep the promise

These words are not forbidden — they are **owed a bound or a query**. A figure that is deliberately
capped or scoped honours the promise by saying so, and `all` next to a number is bounded by that
number. "Showing all 10" under a heading reading **Largest loans** promises ten rows of a top-ten
list and delivers exactly that.

So when you cap something, put the cap in the words — `Top 10`, `Last 30 days`, `Your own money
only` — and the label is finished. What is *not* finished is a bound that lives only in the code:
"Showing all loans" over a query with a silent `take: 10` is the real version of this bug, and the
fix is to print the 10, not to delete the word.

Write the cap in the provenance comment too, so the next reader — human or `data-truth` — can tell a
deliberate limit from an accidental one.

## The traps that are specific to this codebase

**Centavos are not pesos.** Every money column is a whole number of centavos. A figure rendered
without going through `<Money>` is out by a factor of 100 and looks like a plausible number, not like
an error — ₱3,000,000.00 where ₱30,000.00 was meant. Never hand a raw `*Centavos` value to
`toLocaleString()`.

**"Deleted" is `archivedAt`, and it is not in the default filter for free.** Deleting sets the
column; every screen except Recently Deleted excludes those rows. A count written without it silently
includes things the admin deleted thirty days ago and will not see anywhere on the screen.

**A payment can be undone.** Undo archives the `Payment` row but leaves it attached to the loan, and
Prisma cannot filter a to-one relation in a `select` — so an undone payment comes back attached and
reads as paid unless you check `payment.archivedAt`. A "Paid" count that skips that check reports
money that was handed back.

**Stored once is not stale.** `weeks`, `interestCentavos`, `totalCentavos` and the `LoanFunding` rows
are computed when the loan is created and never recalculated, deliberately. The trap is a label that
implies otherwise — "at 7% per week" beside a figure computed at whatever rate applied the day the
loan was made. If the rate could have changed, the label says when it was fixed.

**Overdue is a fact about today, not a stored state.** `status = 'ACTIVE' AND dueOn < today`. A
figure labelled "Overdue" that reads a status column is reading a column that does not exist; one
computed from a date built at local midnight is off by a day in Manila — `calendarDate()` exists for
exactly that, and a due date a day early tips a loan into overdue a day early.

**Two users share the tables.** The demo account's fictional borrowers live in the same rows as the
real ones, separated only by `userId`. A figure that forgets the scope is not slightly wrong, it is
somebody else's data.

## Four traps that are not about the word

The number can be right, the word can be right, and the screen can still mislead.

**A caption implies a subset.** Anything under a headline figure reads as a breakdown of it. A
related-but-independent figure needs its own heading, not a caption — "Overdue 0" with "2 archived"
beneath parses as "2 of those 0", which is nonsense.

**Two figures side by side invite arithmetic.** Someone seeing 89 above and 21 below will subtract.
If the smaller is a subset of something other than the headline, say so — "of them" is load-bearing.

**Formatting implies a type.** `tabular-nums` belongs in a column, not on a standalone figure; a
peso sign on a figure that is actually a count reads as money. And the PDF fonts have no ₱ glyph
unless you use the bundled one — Helvetica silently renders `±30,000.00` on a document someone is
handed.

**A derived figure does not react to what you think it reacts to.** Floating funds is derived from
deposits, withdrawals and the loans currently out. If the admin's real question is "did my action
take effect", and the answer is "this number will not move until the loan is marked paid", the label
is where that has to be said.

## The comment

Write it above the figure, in code, where the next person editing the label will see it. State what
the query computes, not what you assume:

```ts
// `outCentavos` is SUM("capitalCentavos") over ACTIVE, non-archived loans for THIS user — capital
// only. It excludes interest deliberately: interest is not money that left the lender's hands, and
// showing capital + interest here would overstate what is actually at risk. A loan marked paid drops
// out of this figure the moment the payment is recorded, and reappears if that payment is undone.
subtitle: 'Capital out on active loans'
```

Two things that comment does and a variable name cannot: it records the *measurement*, and it tells
the next person **why the obvious label is wrong** — which is the only thing that stops them "fixing"
it back.

**Never put live figures in the comment.** Quoted counts drift within weeks and then the comment is
lying too. Describe the computation, date any measurement, and let the numbers live on the screen.

## When you genuinely cannot check

Say so, in the comment, in those words. "I have not verified this" is a complete and acceptable
answer and it leaves the next person a thread to pull. A caveat protects you, not the reader — so do
not dress an unverified figure in confident copy and call the hedge a mitigation.

Where the honest label is impossible because the data is not there, write that down too:

```ts
// A true composition caption would be better ("N free · N funded", summing to the total) and is NOT
// available here: this query does not carry the funding breakdown. Revisit if it is ever added.
```

That is how a missing field becomes a tracked item instead of a quiet inaccuracy.

## After the fact

This skill is the write-time half. The detect-time half is the **`data-truth` agent**, which sweeps a
whole screen — reading every label as a promise, recomputing it from the database, and recording the
result under `.claude/reconciliation/<screen>.md`.

Run it when a screen's data surface changes, or on any screen nobody has reconciled yet. If you are
about to add a figure and there is already a reconciliation record for that screen, read it first —
it may already say what that field actually contains.
