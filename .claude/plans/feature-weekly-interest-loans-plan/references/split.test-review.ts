// Review of tests/money/split.test.ts — CONVENTIONS.md: "read it alongside
// split.ts; the reconciliation test there is the one that matters."
//
// tests/money/weekly.test.ts copies its shape deliberately.

// The discipline, in the file's own words:
//   "THE INVARIANT — the shares always sum to the interest charged"
//   "The single most valuable test here. Every case below must reconcile to the
//    centavo, including the ones that do not divide evenly."

// A table of named cases, each run through two or three assertions. The cases are
// chosen to break naive rounding, and weekly.test.ts REUSES THESE EXACT
// PRINCIPALS rather than inventing new awkward numbers — same inputs, one more
// dimension.
const cases: [string, LoanTerms][] = [
  ['awkward capital, three lenders',      /* 1_000_001 over a/b/c, 3 weeks  */],
  ['a single centavo of capital',         /* centavos(1), 1 week            */],
  ['rate that never divides cleanly',     /* 333 bps, 7 weeks, 3+4 centavos */],
  ['five lenders, prime principals',      /* 1_111_111, 13 weeks            */],
  ['admin takes no cut at all',           /* 999_983 at 500/0 bps, 11 weeks */],
]

for (const [name, terms] of cases) {
  test(`${name}: shares sum to the interest, to the centavo`, () => {
    const split = mustSplit(terms)
    const lenderTotal = split.lenders.reduce((sum, l) => sum + l.earnings, 0)
    assert.equal(
      lenderTotal + split.adminEarnings,
      split.totalInterest,
      'centavos went missing or were invented',  // NOTE: the message names the
    )                                            // failure, not the values. Copied.
  })

  test(`${name}: no share is negative`, () => { /* ... */ })
}

// IMPORTANT — the pattern the weekly tests must follow and it is not obvious:
// the awkward cases are fed through splitLoan FIRST, and what gets sliced is the
// Split that comes back. Hand-typing "earnings: 1234" into weeklySchedule would
// test the slicer against numbers no loan can produce, and would not prove the
// thing that matters — that a real stored split can be cut into weeks that still
// reconcile.

// NOTE: the worked examples from FEATURES.md §2 are each their own describe block
// with the spec's own figures as the test names ("Angel is charged ₱8,400
// interest", "the admin takes home ₱4,400 in total"). weekly.test.ts opens the
// same way with Angel's ₱4,200 / ₱3,000 / ₱1,200, so the owner can read the
// test names and check them against what was agreed.

// NOTE: mustSplit() asserts result.ok and then throws 'unreachable' to narrow the
// type — node:test with no framework, so there is no expect().resolves helper.
// weekly.test.ts needs the same shape wherever it calls splitLoan.
