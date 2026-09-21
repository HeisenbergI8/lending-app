import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  defaultRange,
  describeRange,
  inRange,
  isReportKind,
  parseReportRange,
  rangeFilter,
  rangeParams,
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

describe('inRange — filtering rows already in hand', () => {
  const march = { from: date(2026, 3, 1), to: date(2026, 3, 31) }

  // A date column arrives at midnight UTC, which is morning in Manila, while the
  // range's ends are carried at local midday. Compared as instants, 1 April
  // would fall inside a range ending 31 March by twelve hours.
  test('the day after the range is outside it', () => {
    assert.equal(inRange(new Date(Date.UTC(2026, 3, 1)), march), false)
  })

  test('both ends of the range are inside it', () => {
    assert.equal(inRange(new Date(Date.UTC(2026, 2, 1)), march), true)
    assert.equal(inRange(new Date(Date.UTC(2026, 2, 31)), march), true)
  })

  test('the day before the range is outside it', () => {
    assert.equal(inRange(new Date(Date.UTC(2026, 1, 28)), march), false)
  })

  test('the time of day never decides it', () => {
    assert.equal(inRange(new Date(2026, 2, 31, 23, 59), march), true)
    assert.equal(inRange(new Date(2026, 2, 1, 0, 1), march), true)
  })

  // An unpaid loan has no payment date, and a missing date is not in any range.
  test('nothing is not in the range', () => {
    assert.equal(inRange(null, march), false)
    assert.equal(inRange(undefined, march), false)
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
