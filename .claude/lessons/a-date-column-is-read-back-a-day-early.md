# A `@db.Date` column is read back a day early, and the shared helper is not where you fix it

**When this applies:** reading any of the six date-only columns and comparing it,
bucketing it by month, counting days from it, or putting it in a date input.
They are `LoanRequest.startOn`, `LenderTransaction.occurredOn`, `Loan.startOn`,
`Loan.dueOn`, `Loan.nextDueOn` and `Payment.paidOn`.

`CONVENTIONS.md` has a rule about calendar days carried at local midday, and
`calendarDate()` implements it. That rule is about **writing**. Nothing covered
**reading**, and the half-stated rule reads as a solved problem — which is why on
2026-09-25 a new lender figure shipped with the bug in it and six older sites were
found to have had it all along.

A `date` column comes back from the driver at **midnight UTC**. Reading its
calendar day with `getFullYear/getMonth/getDate` asks what day that instant is
*locally*, and west of London midnight UTC is still the day before:

```
2026-08-31T00:00:00.000Z   ->  Asia/Manila   31 August   (right, by luck)
                           ->  UTC           31 August   (right, by luck)
                           ->  New York      30 August   (wrong)
```

Manila and Vercel are both at or east of UTC, so **every screen was right on
every machine anyone had run it on**. It is invisible until you set `TZ`.

What it cost: a lender's monthly interest moved by ₱1,026.57 on the real account
under `TZ=America/New_York`; a payment dated 1 March counted in February; and the
loan **edit form** pre-filled the day before the real start date, so saving it
untouched would have written that day back — a silent data change, not a display
bug.

## The fix

`storedCalendarDate()` in `src/lib/money/weeks.ts` is the read-side mirror of
`calendarDate()`. It reads the UTC parts and returns local midday, which is exact
in **every** zone because the instant is midnight UTC by construction.

The two are **not interchangeable and neither is idempotent over the other's
input**. Give `storedCalendarDate` a local-midday date and it is wrong past ±12
hours. Only ever hand it a value that came out of a `date` column.

## Do NOT fix the shared helper in place

This is the part that cost an extra cycle. The obvious move is to put the
conversion inside `inRange` and `loanState`, since in production every caller
passes a `date` column. It breaks them, because **their own tests pass
locally-built dates on purpose**:

```ts
inRange(new Date(2026, 2, 31, 23, 59), march)   // proves time of day cannot decide it
loanState('ACTIVE', new Date(2026, 8, 21, 0, 1), lateTonight)
```

Those tests are not in the way — they are the specification. A dual-use helper
gets a **twin**, and each call site answers one question: did this date come out
of a `date` column?

| Shared helper, unchanged | Twin for a `date` column |
| --- | --- |
| `inRange` | `storedDayInRange` |
| `loanState` | `storedLoanState` |

Fix it in place only where the argument has a single known source — the way
`backup.ts` keeps `day()` for real `createdAt` timestamps, where local parts are
genuinely right, and adds `storedDay()` beside it for the date columns.

## How to check it, cheaply

Never conclude from one zone. Run the suite across a spread that crosses UTC:

```bash
for tz in Asia/Manila UTC Europe/London America/New_York Pacific/Midway \
          Pacific/Kiritimati America/Anchorage America/Sao_Paulo; do
  printf "%-22s " $tz; TZ=$tz node --test "tests/**/*.test.ts" | grep -E "^# (pass|fail)"
done
```

Then compare the actual figures, not just the pass count — a report whose fields
you spelled wrong returns `undefined` in every zone and prints a confident
IDENTICAL. That false pass happened here.

**One real difference is expected and is not a bug.** Where the server's local
calendar day genuinely differs — `Pacific/Midway` is a day behind Manila — a
"days late" count *should* differ by one. Money figures should not. If a peso
figure moves with `TZ`, something still reads a stored date locally.
