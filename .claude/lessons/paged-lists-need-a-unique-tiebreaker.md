# A paged list whose sort is not unique silently loses rows

**When this applies:** adding `skip`/`take` to any Prisma query, or changing the
`orderBy` of one that already has them.

On 2026-09-22 the loans list was paged for the first time. It looked right. The
totals matched the database, every filter agreed, and the first walk of all five
pages on a small account came back clean.

Then bulk rows were seeded — 86 loans instead of 6 — and walking every page
returned **86 rows of which only 85 were distinct**. One loan was on two pages
and another was on none. Nothing errored. No test failed. The only way to see it
was to walk all the pages and count.

## Why

`skip`/`take` is a window into a sorted result, and Postgres only guarantees the
order you actually asked for. The sort was:

```ts
orderBy: [{ status: 'asc' }, { dueOn: 'asc' }]
```

Loans sharing a status *and* a due date are tied, and a tied pair may come back
in one order while serving page 1 and the other order while serving page 2. A
row that moves from position 20 to position 21 between those two queries is
skipped; one moving the other way is shown twice.

It stayed invisible on the real account because six loans had six distinct due
dates. Ties are what expose it, and seeded or bulk-imported data is full of them.

## The fix

End every paged `orderBy` with a column that is unique. `id` always is:

```ts
orderBy: [{ status: 'asc' }, { dueOn: 'asc' }, { id: 'asc' }]
```

Applied in `src/server/loans/queries.ts`, `src/server/borrowers/queries.ts`
(names are not unique — two people can share one) and
`src/server/deleted/queries.ts` (anything deleted in one go shares a timestamp,
which is precisely the tied case).

## How to check it, cheaply

Do not eyeball page 1. Walk every page and compare the count of rows seen with
the count of DISTINCT rows seen, against the total the screen claims:

```
total=86 pages=5 walked=86 unique=86   OK
total=86 pages=5 walked=86 unique=85   a row is being shown twice and one lost
```

And do it on data with ties in it. A handful of hand-made rows will pass while
broken.
