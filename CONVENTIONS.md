<!-- harness:scaffold — delete this line when you have filled the file in. The selftest warns while it
     is here, because a half-filled scaffold is worse than no file: the agents follow whatever it says.
     Features (docs/FEATURES.md) and stack (docs/STACK.md) ARE decided. Commands and "Where things
     live" are not, because nothing has been scaffolded yet — those placeholders are deliberate and
     the marker stays until the project actually exists. -->

# Conventions — Lending App

**What this file is for:** the agents in `.claude/agents/` know how to plan, verify and audit, but
nothing about *this* project. This is where you tell them. Delete any section you cannot fill honestly.

---

## What this project is

A private lending ledger for a single admin. The admin records loans made to borrowers using money
supplied by several lenders, and tracks what each lender has idle ("floating funds") versus out on
loan. Nobody else logs in — lenders and borrowers exist only as records the admin manages.

The borrower is charged 7% per week on the capital; the funding lender earns 5% and the admin keeps
2%. Interest is simple, charged on the original capital, and computed **once when the loan is
created** — there is no recurring job and the total never changes afterwards.

**Features are fully specified in [docs/FEATURES.md](docs/FEATURES.md) — read it before planning any
feature work.** Every rule there was confirmed with the owner and there are no open feature
questions. Its section 12 lists what was deliberately EXCLUDED from MVP — partial payments, early
payoff, penalties, extensions, reminders, SMS. Do not treat anything in section 12 as a missing
feature or raise it as a finding.

**Stack:** Next.js (App Router) + TypeScript, PostgreSQL via Prisma, hosted on Supabase (database
*and* payment-screenshot storage), Tailwind + shadcn/ui, password auth, deployed to Vercel. Installable
as a PWA. Full reasoning and the free-tier traps are in [docs/STACK.md](docs/STACK.md).

> **Money is stored as whole centavos (integers), never decimals or floats.** ₱30,000.00 is `3000000`.
> Conversion to pesos happens only at display time, rounding goes through one shared function, and the
> remainder from a lender split is assigned deliberately — never dropped. This is the single easiest
> way to silently shortchange a lender; see docs/STACK.md.

---

## Commands

<!-- The first two MUST match harness.config.json. If they drift, the gates check something different
     from what you run by hand, and the disagreement will not be obvious. -->

| Purpose | Command |
| --- | --- |
| Full check (the closing gate) | `npm run verify` — typecheck + lint + tests |
| Fast check (runs every turn) | `npm run typecheck` |
| Tests only | `npm test` |
| Tests, one file | `node --test tests/money/split.test.ts` |
| Create your admin login | `npm run db:create-admin` |
| Apply migrations | `npm run db:migrate` |
| Reseed the demo account | `npm run db:seed` |
| Run the app locally | `npm run dev` |
| Production build | `npm run build` |

**`npm run typecheck` is `next typegen && tsc --noEmit`, and the `typegen` half is not optional.**
Next 16 generates `LayoutProps` and the route types into `.next/types/`. A bare `tsc --noEmit` on a
clean checkout fails with `Cannot find name 'LayoutProps'` — a failure about missing generated files,
not about the code. `next build` runs typegen itself, which is why the build passes while plain `tsc`
does not.

**Tests are plain TypeScript run by Node itself** — `node --test`, no Vitest, no Jest, no loader.
Node 22 strips types natively, so there is no test framework to install or configure. Two consequences:
every import inside `src/lib/money/` and `tests/` must carry an explicit `.ts` extension (Node's ESM
resolver will not guess it), and `allowImportingTsExtensions` is on in `tsconfig.json` to match. Next's
bundler resolves those extensions fine — this was checked against a real build, not assumed.

---

## Where things live

> **PARTLY REAL.** `src/app/`, `src/lib/money/` and `tests/money/` exist. `src/server/`,
> `prisma/` and the domain components do not yet — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
> Check before assuming a file is there.

| Layer | Path | Owns |
| --- | --- | --- |
| Domain | `src/lib/money/` | every peso decision — interest, splits, the whole-weeks rule. Pure functions, no database, no React. Fully tested. |
| Server | `src/server/` | database access, auth, Supabase storage, PDF reports. Server-only. |
| UI | `src/app/`, `src/components/` | routes and screens. Never imports Prisma. |
| Data model | `prisma/schema.prisma` | the nine tables, single source of truth |
| Tests | `tests/money/` | mirrors `src/lib/money/` one-to-one |

Dependencies point **one way only**: UI → Server → Domain. The domain layer imports nothing from the
other two — that is what lets the money math be tested without a database.

**Read this first:** [src/lib/money/split.ts](src/lib/money/split.ts). It carries the
7% = 5% + 2% invariant and the largest-remainder rule that stops a split losing centavos. Model any
new money code on it, and read [tests/money/split.test.ts](tests/money/split.test.ts) alongside it —
the reconciliation test there is the one that matters.

---

## Traps

<!-- Things that are true, non-obvious, and have already cost someone time. Add the next one the day
     it costs you. -->

- **`db` is a Proxy that builds the Prisma client on first use, not on import.** Constructing it at
  module scope would demand `DATABASE_URL` from anything that imported the file — a unit test of a
  pure function three imports away, or Next's build collecting page data with no database in reach.
  Both would then fail for a reason unrelated to what they were doing.
- **A session's token is never stored.** The cookie holds a random token; the `Session` row's id is
  its SHA-256. Reading the table therefore yields nothing presentable as a login. Do not "simplify"
  this by storing the token.
- **The admin is a lender row with `isSelf = true`.** Mixed funding (part the admin's money, part a
  lender's) looks like a special case and is not one — the difference is carried by the rate columns
  on `LoanFunding`, not by branching. If you find yourself writing `if (isAdminMoney)`, stop.
- **Supabase pauses free projects after about a week idle.** The app's whole purpose is a clickable
  CV link, so a paused project defeats it. See docs/STACK.md.
- **Two database URLs, and they are not interchangeable.** `DIRECT_URL` (5432, session mode) is for
  the Prisma CLI, because migrations take advisory locks and run DDL a transaction pooler cannot carry.
  `DATABASE_URL` (6543, pooled) is for the running app, because serverless opens a connection per
  invocation and the session connection runs out of slots. The names deliberately match Supabase's own
  dashboard, so a copied string drops straight in. Swapping them produces failures that look nothing
  like their cause.
- **A database password with `#`, `&`, `@`, `/`, `:`, `?`, `%` or `+` must be percent-encoded inside
  the URL** (`#` to `%23`, `&` to `%26`). Unencoded, `#` truncates the URL at that point and the error
  mentions authentication rather than the real cause.
- **Prisma 7 does not read `.env` and has no `url` in `schema.prisma`.** The CLI's URL lives in
  `prisma.config.ts` (which calls `process.loadEnvFile()` itself), and the app builds its connection
  through a driver adapter in `src/server/db.ts`. Guides written for Prisma 6 and earlier will not
  match this repo.

---

## Reporting rules

<!-- These four hold in every project. They are about YOUR backlog, and an agent cannot infer any of
     them from the code. -->

- **A deferral is not a gap.** Work that was consciously postponed must not be reported as a defect, a
  finding, or a hand-off item — by a person or by an agent. From inside any single module a deliberate
  absence looks exactly like an oversight, so it will be re-raised on every audit until it is written
  down. List the deferrals here: <!-- none recorded yet -->
- **A claim that ages carries the date it was measured.** Any count, or any "every / all / none"
  statement, written into something durable — a doc, a status field, a user-visible string — says when it
  was measured: `measured NULL on 25 of 25 rows on 2026-08-06`. Not to prove the measurement happened,
  but because writing a date for a measurement you did not take is a deliberate act rather than an
  accident of momentum. It also makes the claim checkable later; `NULL on all rows` reads as eternally
  true.
- **Red is not automatically yours.** A failing typecheck, lint or test in code this turn did not touch
  is evidence about the tree, not a defect to fix. Where more than one session or person has uncommitted
  work in the same checkout, it is usually theirs — and "fixing" it overwrites work in progress that
  looks, from inside a single session, exactly like a mistake. Establish provenance first, and never by
  stashing: `git show HEAD:<path> | diff - <path>` compares against the committed version and changes
  nothing. `git stash && <check> && git stash pop` is refused by `guard-destructive` for that reason —
  a `pop` that conflicts buries whatever was uncommitted.
- **A priority label is not permission to start.** "Critical" or "P1" in a spec or a ticket says what
  matters, not what is next, and not what has already been decided against. Check whatever records
  decisions in this project before planning from a label.

---

<!-- Keep this file tracked in git and keep it SHORT. Everything here is read on most planning tasks,
     so it competes with the code for the same attention. -->
