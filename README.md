# Lending App

A private lending ledger for a one-person lending operation: track who borrowed what, whose money
funded it, and what everyone is owed.

> **Status: in progress.** The money module and the database are built; the screens are not.
> `npm run verify` runs a typecheck, lint and 92 tests. The roadmap below marks what exists.

---

## The problem

A lender's money rarely belongs to just the lender. In a small lending operation, several people put
money in, the operator lends it out, and everyone takes a different cut of the interest. Tracking
that in a notebook or a spreadsheet breaks down quickly: who is owed what, whose money is idle, and
which loans are overdue all become guesswork.

This app records it properly. One admin manages everything — lenders and borrowers never log in.

## What makes it interesting to build

### A three-way interest spread

Every loan carries a spread between what the borrower pays and what the funder receives:

| | Rate/week | On ₱30,000 over 4 weeks |
| --- | --- | --- |
| Borrower is charged | 7% | ₱8,400 interest → repays **₱38,400** |
| Funding lender earns | 5% | ₱6,000 |
| Admin keeps | 2% | ₱2,400 |

A single loan can be funded by several lenders at once, each earning on their own contribution. The
admin can also fund a loan with their own money, in which case they keep the full 7%.

That last case looks like it needs special handling, and doesn't: **the admin is modelled as a lender
with `isSelf = true`**, and the difference is carried by the rate columns rather than by branching.
One code path covers all three scenarios.

### Money that actually adds up

Every amount is stored as a **whole number of centavos**, never a decimal or a float. The app
multiplies capital by percentages and splits the result between funders — precisely the operation
where floating-point arithmetic loses fractions and a lender is quietly shortchanged.

₱8,400 split three ways does not divide evenly. One function owns rounding, and the leftover centavos
are assigned deliberately rather than dropped, so a split always sums back to the exact interest
charged. It is the most valuable test in the project.

### Dates that must be exact

The term is derived from the dates rather than typed: `weeks = (due − start) ÷ 7`, and the result
must be a whole number. A 30-day gap is 4.29 weeks, and silently rounding it would change what the
borrower owes by ₱600. The form shows the derived value live (`= 4 weeks`) and refuses to save a date
that doesn't divide evenly.

---

## Tech stack

| | |
| --- | --- |
| Framework | Next.js (App Router) + TypeScript |
| Database | PostgreSQL via Prisma, hosted on Supabase |
| Storage | Supabase — payment-proof screenshots |
| UI | Tailwind CSS + shadcn/ui, responsive for phone and desktop |
| Auth | Username and password, with isolated accounts |
| Reports | Server-rendered PDF |
| Install | PWA — installable to a phone home screen |
| Hosting | Vercel |

Free tier throughout.

## Architecture

Three layers, with dependencies pointing one way only — **UI → server → domain**:

```
src/lib/money/     every peso decision. Pure functions: no database, no React. Fully tested.
src/server/        database access, auth, file storage, PDF reports. Server-only.
src/app/           routes and screens. Never imports Prisma.
```

The domain layer imports nothing from the other two, which is what lets the money math be tested
without a database running. Nine tables; floating funds, loan terms and borrower track records are
all derived on read rather than stored, so they cannot drift.

## Documentation

Written before any code, and kept as the source of truth:

- **[docs/FEATURES.md](docs/FEATURES.md)** — the complete MVP specification. Section 12 records what
  was deliberately excluded and why.
- **[docs/STACK.md](docs/STACK.md)** — technology choices, the reasoning behind each, and the
  free-tier limits planned for up front.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — layers, the data model, the invariants, and the
  build order.
- **[CONVENTIONS.md](CONVENTIONS.md)** — the short version, for anyone working in the codebase.

## Roadmap

- [x] Feature specification
- [x] Technology decisions
- [x] Architecture and data model
- [x] Project scaffold
- [x] Money module and its tests
- [x] Database schema and migrations
- [ ] Authentication and account isolation
- [ ] Lenders, borrowers and floating funds
- [ ] Loan creation
- [ ] Payments and proof upload
- [ ] Dashboard and search
- [ ] PDF reports
- [ ] PWA and deployment
- [ ] Public demo account with sample data

A demo account with fictional borrowers will be available once the app is deployed. Real lending
records stay in a separate, private account — genuine borrower names and debts are never exposed.

---

## Development

This repository uses [provenly](https://github.com/HeisenbergI8/provenly) — a guardrail harness for
Claude Code that records an activity ledger, blocks unsupported "tests pass" claims, and escalates
repeated failures rather than retrying blindly.

```bash
node .claude/harness/selftest.mjs   # check the gates are actually firing
```

Verify commands in `harness.config.json` are intentionally unset until the project is scaffolded.

## Licence

Not yet licensed. All rights reserved.
