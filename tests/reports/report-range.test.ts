import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  defaultRange,
  describeRange,
  inRange,
  isReportKind,
  parseReportRange,
  rangeDays,
  rangeFilter,
  rangeParams,
  rangePresets,
  sameRange,
  storedDayInRange,
} from '../../src/lib/report-range.ts'
import { calendarDate } from '../../src/lib/money/weeks.ts'

const date = (y: number, m: number, d: number) => calendarDate(new Date(y, m - 1, d))

describe('defaultRange — this month so far', () => {
  test('runs from the first of the month to today', () => {
    const range = defaultRange(new Date(2026, 8, 21))
    assert.deepEqual(range.from, date(2026, 9, 1))
    assert.deepEqual(range.to, date(2026, 9, 21))
  })

  test('on the first of the month it is a single day, not an empty range', () => {
    const range = defaultRange(new Date(2026, 8, 1))
    assert.deepEqual(range.from, range.to)
  })

  test('both ends are carried at midday, like every other date in the app', () => {
    const range = defaultRange(new Date(2026, 8, 21, 23, 45))
    assert.equal(range.from.getHours(), 12)
    assert.equal(range.to.getHours(), 12)
  })
})

describe('parseReportRange — what arrives in the query string', () => {
  const today = new Date(2026, 8, 21)

  test('reads both dates', () => {
    const range = parseReportRange({ from: '2026-01-01', to: '2026-03-31' }, today)
    assert.deepEqual(range.from, date(2026, 1, 1))
    assert.deepEqual(range.to, date(2026, 3, 31))
  })

  test('falls back to this month when a date is missing or unreadable', () => {
    assert.deepEqual(parseReportRange({}, today), defaultRange(today))
    assert.deepEqual(parseReportRange({ from: 'last tuesday', to: null }, today), defaultRange(today))
    // 31 February is not a day; the constructor would roll it to 3 March.
    assert.deepEqual(parseReportRange({ from: '2026-02-31' }, today).from, date(2026, 9, 1))
  })

  test('a range typed backwards is turned the right way round', () => {
    const range = parseReportRange({ from: '2026-03-31', to: '2026-01-01' }, today)
    assert.deepEqual(range.from, date(2026, 1, 1))
    assert.deepEqual(range.to, date(2026, 3, 31))
  })

  test('round-trips through the parameters it produces', () => {
    const range = parseReportRange({ from: '2026-01-01', to: '2026-03-31' }, today)
    assert.deepEqual(parseReportRange(rangeParams(range), today), range)
  })
})

describe('rangeFilter — the clause the queries use', () => {
  // The admin picking 31 March means the whole of 31 March. The bound is the day
  // AFTER at midday rather than `lte` on the 31st, because a date column read
  // back through the driver lands at the start of its own day. Postgres compares
  // these as calendar days: checked against the live database on 2026-09-21, a
  // single-day range returned exactly the rows on that day and a range ending
  // the day before returned none of them.
  test('runs from the first day to the day after the last', () => {
    const filter = rangeFilter({ from: date(2026, 3, 1), to: date(2026, 3, 31) })
    assert.deepEqual(filter.gte, date(2026, 3, 1))
    assert.deepEqual(filter.lt, date(2026, 4, 1))
  })

  test('a single-day range is still a day wide', () => {
    const filter = rangeFilter({ from: date(2026, 3, 15), to: date(2026, 3, 15) })
    assert.deepEqual(filter.gte, date(2026, 3, 15))
    assert.deepEqual(filter.lt, date(2026, 3, 16))
  })
})

describe('inRange — a LOCAL day or instant already in hand', () => {
  const march = { from: date(2026, 3, 1), to: date(2026, 3, 31) }

  test('the time of day never decides it', () => {
    assert.equal(inRange(new Date(2026, 2, 31, 23, 59), march), true)
    assert.equal(inRange(new Date(2026, 2, 1, 0, 1), march), true)
  })

  test('the days either side are outside it', () => {
    assert.equal(inRange(new Date(2026, 3, 1, 9, 0), march), false)
    assert.equal(inRange(new Date(2026, 1, 28, 9, 0), march), false)
  })

  // An unpaid loan has no payment date, and a missing date is not in any range.
  test('nothing is not in the range', () => {
    assert.equal(inRange(null, march), false)
    assert.equal(inRange(undefined, march), false)
  })
})

/**
 * THE THREE CASES BELOW USED TO TEST `inRange`, and they passed because this
 * machine and the deploy both sit at or east of UTC.
 *
 * They were always about a `date` COLUMN — the comment they carried said so:
 * "a date column arrives at midnight UTC". That is a different question from the
 * one inRange answers, and giving both to one function is what made the answer
 * depend on the server's clock. Moved here on 2026-09-25, unchanged in what they
 * assert, and now true in every time zone rather than in half of them.
 */
describe('storedDayInRange — a day out of a `date` column', () => {
  const march = { from: date(2026, 3, 1), to: date(2026, 3, 31) }
  /** What the Postgres driver hands back for a `date`: midnight UTC. */
  const fromDb = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

  test('the day after the range is outside it', () => {
    assert.equal(storedDayInRange(fromDb(2026, 4, 1), march), false)
  })

  test('both ends of the range are inside it', () => {
    assert.equal(storedDayInRange(fromDb(2026, 3, 1), march), true)
    assert.equal(storedDayInRange(fromDb(2026, 3, 31), march), true)
  })

  test('the day before the range is outside it', () => {
    assert.equal(storedDayInRange(fromDb(2026, 2, 28), march), false)
  })

  test('nothing is not in the range', () => {
    assert.equal(storedDayInRange(null, march), false)
    assert.equal(storedDayInRange(undefined, march), false)
  })

  // THE REGRESSION. Every day of March is in March and no day of April is,
  // whatever clock the process keeps. Read locally, the 1st fell out of the
  // range under any negative offset and 1 April fell into it.
  test('every day of the month is in that month, and no day either side is', () => {
    for (let d = 1; d <= 31; d += 1) {
      assert.equal(storedDayInRange(fromDb(2026, 3, d), march), true, `March ${d}`)
    }
    for (let d = 1; d <= 30; d += 1) {
      assert.equal(storedDayInRange(fromDb(2026, 4, d), march), false, `April ${d}`)
    }
    for (let d = 1; d <= 28; d += 1) {
      assert.equal(storedDayInRange(fromDb(2026, 2, d), march), false, `February ${d}`)
    }
  })
})

describe('report kinds and labels', () => {
  test('accepts the four real kinds and nothing else', () => {
    for (const kind of ['summary', 'lender', 'borrower', 'borrower-file']) {
      assert.equal(isReportKind(kind), true, kind)
    }
    for (const kind of ['', 'Summary', 'everything', 'borrower-file-2']) {
      assert.equal(isReportKind(kind), false, kind)
    }
  })

  test('describes a range the way a person reads it', () => {
    const described = describeRange({ from: date(2026, 9, 1), to: date(2026, 9, 21) })
    assert.match(described, /Sep 1, 2026.+Sep 21, 2026/)
  })
})

describe('the quick period presets', () => {
  // A month with 31 days, sitting after a 28-day February, so "last month" and
  // "last 90 days" both have a length that would come out wrong if the code
  // assumed every month were the same size.
  const today = date(2026, 3, 15)
  const preset = (key: string) => {
    const found = rangePresets(today).find((one) => one.key === key)
    assert.ok(found, key)
    return found
  }

  test('this month runs from the 1st to today, never past it', () => {
    const { range } = preset('this-month')
    assert.deepEqual(rangeParams(range), { from: '2026-03-01', to: '2026-03-15' })
  })

  test('last month ends on its own last day, whatever that day is', () => {
    const { range } = preset('last-month')
    assert.deepEqual(rangeParams(range), { from: '2026-02-01', to: '2026-02-28' })
  })

  test('last 90 days is 90 days, counting today as one of them', () => {
    const { range } = preset('last-90')
    assert.equal(rangeDays(range), 90)
    assert.deepEqual(rangeParams(range), { from: '2025-12-16', to: '2026-03-15' })
  })

  test('this year starts on 1 January and stops at today', () => {
    const { range } = preset('this-year')
    assert.deepEqual(rangeParams(range), { from: '2026-01-01', to: '2026-03-15' })
  })

  // The chip is only filled in when it matches, and a hand-typed range matches
  // none of them — which is what keeps the filled chip from lying.
  test('a range matches the preset it equals and no other', () => {
    const presets = rangePresets(today)
    const thisMonth = preset('this-month').range
    assert.equal(presets.filter((one) => sameRange(one.range, thisMonth)).length, 1)
    assert.equal(
      presets.some((one) => sameRange(one.range, { from: date(2026, 3, 2), to: date(2026, 3, 9) })),
      false,
    )
  })
})

describe('how long a range is', () => {
  test('counts both ends', () => {
    assert.equal(rangeDays({ from: date(2026, 8, 1), to: date(2026, 8, 31) }), 31)
    assert.equal(rangeDays({ from: date(2026, 8, 4), to: date(2026, 8, 4) }), 1)
  })
})
