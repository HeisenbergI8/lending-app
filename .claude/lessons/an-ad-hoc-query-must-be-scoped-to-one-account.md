# An ad-hoc query must be scoped to one account

**When this applies:** answering a question about the user's real figures by
querying the database directly, outside `src/server/`.

On 2026-09-23 a borrower's interest (₱3,750) did not match what the lender page
said the funder earned (₱2,250). Diagnosing it meant finding out whether the
funder was the account's own Admin pot. The query was

```ts
p.lender.findMany({ select: { firstName: true, lastName: true, isSelf: true } })
```

and it returned every lender in the database — three accounts' worth, plus the
demo one. The row flagged `isSelf` in that list belonged to **another user**, so
the answer was that the Admin pot was someone the user had never heard of, and
the next offer was to move that flag in the database. On their money.

Every table in this schema carries `userId`, and every query under `src/server/`
scopes by it — which is exactly why a query written by hand does not inherit it.
There is one database, and `isSelf`, `Lender`, `Loan` and the rest are unique
*per account*, not globally. `isDemo` accounts sit in the same tables.

**So:** start an ad-hoc query by resolving the account — `p.user.findMany({ select: { username: true, ... } })`
— and put `where: { userId }` on everything after it, or group the output by
user so a cross-account row is visible on sight. A result that names a person
the user has not mentioned is the tell that the scope is missing.
