# A branch on NODE_ENV cannot be verified by `npm run dev`

**When this applies:** writing or reviewing any code whose behaviour differs on
`process.env.NODE_ENV`, and before claiming a deploy works.

On 2026-09-22 the app deployed green and then failed the first time anyone
marked a loan paid: `Transaction API error: Transaction not found`. The cause
was one line in `src/server/db.ts`:

```ts
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = created
```

`db` is a Proxy that builds the client on first property access. With nothing
memoised, **every** access built a new `PrismaClient` and a new pool, so
`db.$transaction()` opened a transaction on one client and the writes inside it
ran against another. Nine steps of the build order, 316 tests and months of
`npm run dev` could not reach it: development was the one environment that
cached.

**What to do instead**

- Treat `NODE_ENV === 'production'` as an untested branch until it has been
  run. Unit tests do not set it and `next dev` never takes it.
- Before believing a deploy, run `npm run build && npm start` locally and
  exercise a path that WRITES — a payment, a loan, anything inside a
  `$transaction`. Next's CLI sets `NODE_ENV=production` for both `build` and
  `start` (`node_modules/next/dist/bin/next`, `process.env.NODE_ENV || defaultEnv`),
  so this reproduces the real environment against the real database. Loading
  the login page proves nothing; a read-only page proves nothing.
- Be suspicious of a comment that explains a guard by its *symptom* rather than
  its *rule*. This one described the cache as a hot-reload workaround, so it
  read as a development convenience — while the actual requirement was one
  client, everywhere. The guard survived review because the comment justified
  it.

`tests/server/db.test.ts` now fails if the memo is ever conditional again. See
also [[paged-lists-need-a-unique-tiebreaker]] — both bugs looked correct on
every screen a person actually opened.
