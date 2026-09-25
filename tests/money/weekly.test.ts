import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { splitLoan, type LoanTerms } from '../../src/lib/money/split.ts'
import {
  consecutivePaidWeeks,
  nextUnpaidWeek,
  realisedThrough,
  weeklyDueDates,
  weeklySchedule,
  weeklySlices,
} from '../../src/lib/money/weekly.ts'

const peso = (n: number) => centavos(n * 100)

describe('the loan the spec was written from', () => {
  // 60,000 at 7% for 20 weeks. The lender keeps 5%, the Admin takes 2%.
  const split = splitLoan({
    capital: peso(60_000),
    borrowerRateBps: 700,
    weeks: 20,
    fundings: [{ lenderId: 'lender', principal: peso(60_000), lenderRateBps: 500, adminCutBps: 200 }],
  })
  assert.equal(split.ok, true)
  if (!split.ok) throw new Error('unreachable')

  const schedule = weeklySchedule(
    split.value.lenders.map((share) => ({
      lenderId: share.lenderId,
      earnings: share.earnings,
      adminCut: share.adminCut,
    })),
    20,
  )

  test('the whole interest is ₱84,000, unchanged from collecting it at the end', () => {
    assert.equal(split.value.totalInterest, peso(84_000))
  })
  test('every week is ₱4,200', () => {
    for (const week of schedule) assert.equal(week.interest, peso(4_200))
  })
  test('the lender keeps ₱3,000 a week', () => {
    for (const week of schedule) assert.equal(week.lenders[0].earnings, peso(3_000))
  })
  test('the Admin takes ₱1,200 a week', () => {
    for (const week of schedule) assert.equal(week.adminCut, peso(1_200))
  })
})

describe('THE INVARIANTS — both of them, on figures that do not divide', () => {
  // The same awkward principals tests/money/split.test.ts reconciles against.
  // Fed through splitLoan first, so what is sliced is a real stored split.
  const cases: [string, LoanTerms, number][] = [
    [
      'awkward capital, three lenders, 3 weeks',
      {
        capital: centavos(1_000_001),
        borrowerRateBps: 700,
        weeks: 3,
        fundings: [
          { lenderId: 'a', principal: centavos(333_333), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'b', principal: centavos(333_334), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'c', principal: centavos(333_334), lenderRateBps: 500, adminCutBps: 200 },
        ],
      },
      3,
    ],
    [
      'five lenders, prime principals, 13 weeks',
      {
        capital: centavos(1_111_111),
        borrowerRateBps: 700,
        weeks: 13,
        fundings: [
          { lenderId: 'a', principal: centavos(222_221), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'b', principal: centavos(222_222), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'c', principal: centavos(222_223), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'd', principal: centavos(222_222), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'e', principal: centavos(222_223), lenderRateBps: 500, adminCutBps: 200 },
        ],
      },
      13,
    ],
    [
      "mixed funding — the Admin's own money beside a lender's, 23 weeks",
      {
        capital: centavos(999_983),
        borrowerRateBps: 700,
        weeks: 23,
        fundings: [
          { lenderId: 'admin', principal: centavos(333_331), lenderRateBps: 700, adminCutBps: 0 },
          { lenderId: 'jun', principal: centavos(666_652), lenderRateBps: 500, adminCutBps: 200 },
        ],
      },
      23,
    ],
    [
      'a single centavo of capital over 5 weeks',
      {
        capital: centavos(1),
        borrowerRateBps: 700,
        weeks: 5,
        fundings: [{ lenderId: 'a', principal: centavos(1), lenderRateBps: 500, adminCutBps: 200 }],
      },
      5,
    ],
  ]

  for (const [name, terms, weeks] of cases) {
    const result = splitLoan(terms)
    assert.equal(result.ok, true, name)
    if (!result.ok) throw new Error('unreachable')
    const stored = result.value
    const funders = stored.lenders.map((share) => ({
      lenderId: share.lenderId,
      earnings: share.earnings,
      adminCut: share.adminCut,
    }))
    const schedule = weeklySchedule(funders, weeks)

    test(`${name}: the weeks sum to the interest charged, to the centavo`, () => {
      const total = schedule.reduce((sum, week) => sum + week.interest, 0)
      assert.equal(total, stored.totalInterest, 'centavos went missing or were invented')
    })

    test(`${name}: every week's funder shares sum to that week`, () => {
      for (const week of schedule) {
        const parts = week.lenders.reduce((sum, share) => sum + share.earnings, 0) + week.adminCut
        assert.equal(parts, week.interest, `week ${week.week} does not add up`)
      }
    })

    test(`${name}: each funder's weeks sum to what they are owed`, () => {
      for (const funder of funders) {
        const paid = schedule.reduce(
          (sum, week) =>
            sum + (week.lenders.find((share) => share.lenderId === funder.lenderId)?.earnings ?? 0),
          0,
        )
        assert.equal(paid, funder.earnings, `${funder.lenderId} is owed a different total`)
      }
    })

    test(`${name}: the Admin's weeks sum to the Admin's cut`, () => {
      const cut = schedule.reduce((sum, week) => sum + week.adminCut, 0)
      assert.equal(cut, stored.adminEarnings)
    })

    test(`${name}: no week is negative, and only the last may differ`, () => {
      for (const week of schedule) assert.ok(week.interest >= 0, `week ${week.week} is negative`)
      const early = schedule.slice(0, -1).map((week) => week.interest)
      assert.equal(new Set(early).size <= 1, true, 'the weeks before the last are not all equal')
    })

    test(`${name}: realisedThrough never exceeds what is owed`, () => {
      for (const funder of funders) {
        for (let paid = 0; paid <= weeks; paid += 1) {
          const got = realisedThrough(funder.earnings, weeks, paid)
          assert.ok(got >= 0 && got <= funder.earnings, `${funder.lenderId} at ${paid} weeks: ${got}`)
        }
      }
    })
  }
})

describe('realisedThrough matches adding the slices up', () => {
  // The multiplication is a shortcut. It has to give the same answer as the
  // schedule it is a shortcut for, or the floating funds query and the loan
  // page disagree about the same money.
  for (const total of [peso(84_000), centavos(1), centavos(1_000_001), centavos(0)]) {
    for (const weeks of [2, 3, 7, 13, 20, 23]) {
      test(`${total} over ${weeks} weeks`, () => {
        const slices = weeklySlices(total, weeks)
        for (let paid = 0; paid <= weeks; paid += 1) {
          const summed = slices.slice(0, paid).reduce<number>((sum, slice) => sum + slice, 0)
          assert.equal(realisedThrough(total, weeks, paid), summed, `at ${paid} weeks`)
        }
      })
    }
  }
})

describe('weeklySlices refuses what it cannot split', () => {
  test('a fractional number of weeks', () => {
    assert.throws(() => weeklySlices(peso(100), 2.5), /whole number of weeks/)
  })
  test('no weeks at all', () => {
    assert.throws(() => weeklySlices(peso(100), 0), /whole number of weeks/)
  })
  test('a negative amount', () => {
    assert.throws(() => weeklySlices(centavos(-1), 4), /non-negative/)
  })
})

describe('the weekly dates', () => {
  const start = new Date(2026, 8, 5, 12) // 5 September 2026

  test('the first week falls one week after the start', () => {
    assert.equal(weeklyDueDates(start, 20)[0].getDate(), 12)
  })
  test('the last week falls ON the due date', () => {
    const dates = weeklyDueDates(start, 20)
    const last = dates[dates.length - 1]
    assert.equal(last.getFullYear(), 2027)
    assert.equal(last.getMonth(), 0) // 23 January 2027
    assert.equal(last.getDate(), 23)
  })
  test('every date is at local midday, so Postgres cannot take a day off it', () => {
    for (const date of weeklyDueDates(start, 20)) assert.equal(date.getHours(), 12)
  })
})

describe('the earliest unpaid week is the one that is chased', () => {
  const start = new Date(2026, 8, 5, 12)

  test('nothing paid: week 1', () => {
    assert.equal(nextUnpaidWeek(start, 20, new Set())?.week, 1)
  })
  test('a MISSED week stays owed while later ones are paid', () => {
    // Week 2 was missed and weeks 1, 3 and 4 were paid. The loan is chased
    // from week 2, not from week 5 — the missed week does not go away.
    assert.equal(nextUnpaidWeek(start, 20, new Set([1, 3, 4]))?.week, 2)
  })
  test('the week it returns is dated at midday, like every other calendar date', () => {
    assert.equal(nextUnpaidWeek(start, 20, new Set())?.dueOn.getHours(), 12)
  })
  test('every week paid: nothing left to chase', () => {
    const all = new Set(Array.from({ length: 4 }, (_unused, index) => index + 1))
    assert.equal(nextUnpaidWeek(start, 4, all), null)
  })
  test('the unbroken run stops at the gap', () => {
    assert.equal(consecutivePaidWeeks(20, new Set([1, 3, 4])), 1)
  })
  test('the unbroken run is the whole term when nothing was missed', () => {
    assert.equal(consecutivePaidWeeks(4, new Set([1, 2, 3, 4])), 4)
  })
})
