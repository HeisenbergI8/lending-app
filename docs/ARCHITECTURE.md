# Lending App — Architecture

**Status:** designed 2026-09-21; scaffolded 2026-09-21 (step 1 of the build order).
**What exists:** steps 1-9 of the build order. `src/lib/money/`, `src/server/db.ts`,
`src/server/auth/`, `src/server/lenders/`, `src/server/borrowers/`, `src/server/loans/`,
`src/server/payments/`, `src/server/storage/`, a live Supabase database with a seeded demo
account, a working login, the dashboard, the lender, borrower and loan screens — including creating,
correcting and undoing a loan, marking one paid with proof attached, and searching the loans by
name, amount, due-date range and status — and the four PDF reports.
282 tests pass (measured 2026-09-21).
**Storage is live.** The private `proof-of-payment` bucket exists and `SUPABASE_SERVICE_ROLE_KEY`
is set. Verified end to end on 2026-09-21: a file uploaded through the form came back byte-for-byte
through its signed link, and the same path without a signature was refused. The bucket caps files
at 4 MB and accepts only images and PDFs, matching `src/lib/proof.ts`.
**Still to come:** PWA and deploy.
**The PWA manifest and the deploy are the only parts below that are still planned** — everything
else described here exists.

Features: [FEATURES.md](FEATURES.md) · Stack: [STACK.md](STACK.md)

---

## The one idea

**The money math is a pure module that knows nothing about the database, the screens, or Next.js.**

Everything else is plumbing around it. That module is the only part that is fully unit-tested, and it
is where every peso is decided. If a rule from FEATURES.md involves a number, it lives there and
nowhere else — not in a component, not in a route handler, not in a Prisma query.

This is the answer to "why is this app structured the way it is" in an interview.

---

## Three layers

| Layer | Folder | Knows about | Never touches |
| --- | --- | --- | --- |
| **Domain** | `src/lib/money/` | nothing but numbers and dates | database, React, Next.js |
| **Server** | `src/server/` | database, auth, storage | React components |
| **UI** | `src/app/`, `src/components/` | the server layer | Prisma, raw SQL |

Dependencies point **one way only**: UI → Server → Domain. The domain layer imports nothing from the
other two. That is what makes it testable without a database running.

---

## Folder structure

```
lending-app/
├── prisma/
│   ├── schema.prisma              # the data model, single source of truth
│   ├── migrations/
│   └── seed/
│       └── demo.ts                # fake borrowers for the recruiter-facing account
│
├── src/
│   ├── lib/
│   │   ├── money/                 # ← THE CORE. Pure functions. Fully tested. BUILT.
│   │   │   ├── result.ts          # Ok/Err — validation failures are answers, not exceptions
│   │   │   ├── centavos.ts        # branded integer money, parse, format
│   │   │   ├── weeks.ts           # (due − start) ÷ 7, whole-number rule
│   │   │   ├── interest.ts        # capital × rate × weeks
│   │   │   ├── split.ts           # per-lender earnings + remainder handling
│   │   │   └── index.ts
│   │   └── utils.ts               # shadcn's cn() helper, nothing else
│   │
│   ├── server/                    # server-only. Never imported by a client component.
│   │   ├── db.ts                  # the Prisma client singleton
│   │   ├── auth/                  # BUILT
│   │   │   ├── password.ts        # scrypt hashing, timing-safe verify
│   │   │   ├── session.ts         # tokens; the DB stores only their hash
│   │   │   ├── cookie.ts          # httpOnly / sameSite / secure
│   │   │   ├── guard.ts           # requireUser() — the isolation gate
│   │   │   ├── actions.ts         # login / logout server actions
│   │   │   ├── rate-limit.ts      # failed-login counters, in Postgres not memory
│   │   │   └── request-ip.ts      # x-forwarded-for, first entry
│   │   ├── lenders/               # BUILT — queries.ts (derived floating), actions.ts
│   │   ├── borrowers/             # BUILT — queries.ts (counted record), actions.ts
│   │   ├── loans/                # BUILT — terms.ts (pure), actions.ts, queries.ts
│   │   ├── payments/              # BUILT — actions.ts, queries.ts (signed links)
│   │   ├── storage/               # BUILT — proof-bucket.ts, Supabase Storage over fetch
│   │   └── reports/               # BUILT — queries.ts, document.tsx, bundled fonts
│   │
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── manifest.ts            # PWA — installable to home screen
│   │   ├── (auth)/
│   │   │   └── login/page.tsx
│   │   ├── (app)/                 # everything behind the login
│   │   │   ├── layout.tsx         # nav; calls requireUser()
│   │   │   ├── page.tsx           # dashboard
│   │   │   ├── lenders/[id]/page.tsx
│   │   │   ├── borrowers/[id]/page.tsx
│   │   │   ├── loans/page.tsx
│   │   │   ├── loans/new/page.tsx
│   │   │   ├── loans/[id]/page.tsx
│   │   │   ├── loans/[id]/edit/page.tsx
│   │   │   ├── reports/page.tsx
│   │   │   └── archive/page.tsx
│   │   └── api/
│   │       ├── uploads/route.ts
│   │       └── reports/route.ts   # returns a PDF; the kind is a query parameter
│   │
│   ├── components/
│   │   ├── ui/                    # shadcn/ui — generated, don't hand-edit
│   │   ├── money-input.tsx        # types pesos, stores centavos
│   │   ├── forms.tsx              # DisclosureForm / ActionForm / SubmitButton
│   │   └── ...
│   │
│   └── types/
│
├── tests/
│   └── money/                     # mirrors src/lib/money/ one-to-one
│
├── docs/                          # FEATURES.md, STACK.md, ARCHITECTURE.md
└── public/
```

---

## Data model

Nine tables. Every money column is an **integer of centavos**; every rate is an **integer of basis
points** (7% = `700`). No decimals anywhere.

| Table | Holds | Notes |
| --- | --- | --- |
| `User` | the two admin accounts | `isDemo` separates the recruiter account from the real one |
| `Lender` | name only | `isSelf` marks the admin's own money pot |
| `Borrower` | name only | `manualLabel` = the Good/Okay/Bad the admin sets by hand |
| `LenderTransaction` | deposits and withdrawals | `type`, `amountCentavos`, `date` — floating funds is derived from these |
| `Loan` | one loan | capital, start/due dates, derived weeks, rates, totals, status |
| `LoanFunding` | who put money into this loan | one row per funder |
| `Payment` | the single full repayment | one row; partial payments don't exist |
| `ProofFile` | screenshots for a payment | several rows per payment |
| `Session` | login sessions | the row id is the SHA-256 of the cookie's token |
| `LoginAttempt` | failed logins | the only table with no `userId` — written before anyone is authenticated |

### Why `LoanFunding` is the clever bit

Mixed funding (§2 of FEATURES.md) looks like a special case, but it isn't — **the admin is just a
lender with `isSelf = true`**. One uniform table handles all three scenarios:

| Scenario | Rows | `lenderRateBps` | `adminCutBps` |
| --- | --- | --- | --- |
| John Ross funds all ₱30,000 | 1 | 500 | 200 |
| Maria ₱20,000 + Jun ₱10,000 | 2 | 500 each | 200 each |
| Admin ₱10,000 + John Ross ₱20,000 | 2 | **700** / 500 | **0** / 200 |

No `if (isAdminMoney)` branches anywhere. The rate columns carry the difference.

### Two invariants the code must enforce

1. `sum(LoanFunding.principal) == Loan.capital` — the loan is exactly funded, never over or under.
2. For every funding row, `lenderRateBps + adminCutBps == Loan.borrowerRateBps`.

Invariant 2 is what guarantees the split always sums back to the borrower's interest. Both are
checked in `split.ts` and covered by tests.

### Derived, never stored

These are computed on read, so they can never drift out of date:

- **Floating funds** = deposits − withdrawals − principal still out on loan + earnings realised.
  Principal that came back is simply no longer out, so it is not added back separately — see
  [src/lib/money/floating.ts](../src/lib/money/floating.ts). Earnings on a loan still running are
  reported as *pending* and deliberately kept OUT of floating: the money has not arrived yet.
- **Weeks** = (due − start) ÷ 7
- **Track record** = counted from the borrower's loan history (the manual Good/Okay/Bad label *is*
  stored — it's a human opinion, not a fact)

---

## Rounding: where the centavos go

Integer division leaves remainders. ₱8,400 split between three lenders does not divide evenly.

**One function owns rounding, and the remainder is never dropped.** `distribute()` in
[src/lib/money/split.ts](../src/lib/money/split.ts) floors every share, then hands out the leftover
centavos one at a time, largest fractional part first. Ties break by position, so the same loan always
splits the same way — a split that shuffles its remainder between runs is an untestable
reconciliation bug.

[tests/money/split.test.ts](../tests/money/split.test.ts) asserts this on deliberately awkward
numbers, plus an exhaustive sweep over every capital from 1 to 2,000 centavos. That is the single most
valuable test in the project.

---

## Account isolation

The demo account must never see real borrowers' names and debts.

- Every domain table carries a `userId`.
- **Every** server query goes through `requireUser()` and filters on it. There is no code path that
  reads a table without it.
- This is enforced in the server layer, not by hiding buttons — a hidden button is not security.

---

## Archive

Nothing is ever hard-deleted. Every table has `archivedAt`. Default queries exclude non-null rows;
the Archive screen shows only those. There is no purge job and no permanent delete.

---

## Where each FEATURES.md rule is enforced

| Rule | Lives in |
| --- | --- |
| Whole-weeks-only date rule | `lib/money/weeks.ts` + the form |
| Floating funds, derived never stored | `lib/money/floating.ts` + `server/lenders/queries.ts` |
| Counted track record, the label stored | `lib/track-record.ts` + `Borrower.manualLabel` |
| A calendar date survives being stored | `calendarDate()` in `lib/money/weeks.ts` |
| Interest computed once, at creation | `server/loans/terms.ts` + `actions.ts` — write the totals, never recompute |
| 7% = 5% + 2% spread | `lib/money/split.ts` (invariant 2) |
| Admin's own money earns 7% | the rate columns on `LoanFunding` — no special-casing |
| Repayment returns capital + earnings to floating | the floating-funds derivation |
| No partial payments | one `Payment` row per loan, enforced at the DB level |
| Proof optional but flagged | `Payment` with zero `ProofFile` rows renders a warning |
| Full payment only, amount never typed | `server/payments/actions.ts` reads the total off the loan |
| Proof files are private | a private bucket + links signed per render in `payments/queries.ts` |
| Nothing truly deleted | `archivedAt` on every table |

---

## Build order

Each step leaves something that runs:

1. ~~Scaffold Next.js + Tailwind + shadcn; fill in `harness.config.json` verify commands.~~ **Done.**
2. ~~`src/lib/money/` and its tests.~~ **Done** — 92 tests, wired into `npm run verify`.

3. ~~Prisma schema + migration + demo seed.~~ **Done** — applied to Supabase, demo account seeded.
4. ~~Auth and `requireUser()`.~~ **Done** — server-side sessions, scrypt passwords.
5. ~~Lenders, borrowers, and their floating funds.~~ **Done** — list and profile screens for both, money in/out, derived floating funds, counted track record.
6. ~~Loan creation — the form with the live "= 4 weeks" badge.~~ **Done** — create, correct and undo; inline borrower and lender creation; the whole-weeks rule enforced in the badge and again in the action.
7. ~~Payments and proof upload.~~ **Done** — mark as paid with proof in one step, add proof later, undo a payment, remove a file. Uploads verified against the live bucket.
8. ~~Dashboard and search.~~ **Done** — the dashboard's four figures, the lender pots across the
   top and the borrowers with their ratings; search on the loans list by name, amount or due-date
   range, plus the Active / Overdue / Paid chips. The search lives in the query string, so a
   filtered list is a link.
9. ~~PDF reports.~~ **Done** — overall summary, per lender, per borrower and the borrower's full
   file, over any date range, rendered server-side with `@react-pdf/renderer` and returned as a
   download. The app's own typeface is bundled with them: the PDF standard fonts have no ₱ glyph
   and print `±30,000.00` without complaining.
10. PWA manifest, then deploy.
