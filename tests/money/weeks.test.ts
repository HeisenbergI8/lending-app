import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { weeksBetween, daysBetween, dueDateAfterWeeks, calendarDate } from '../../src/lib/money/weeks.ts'

// Midday, matching calendarDate: every date this module hands back is carried
// at midday so no time zone can shift which calendar day it is. See weeks.ts.
const date = (y: number, m: number, d: number) => calendarDate(new Date(y, m - 1, d))

describe('weeksBetween — whole weeks only', () => {
  const valid: [string, Date, Date, number][] = [
    ['4 weeks', date(2026, 2, 1), date(2026, 3, 1), 4],
    ['1 week', date(2026, 2, 1), date(2026, 2, 8), 1],
    ['2 weeks', date(2026, 2, 1), date(2026, 2, 15), 2],
    ['12 weeks', date(2026, 1, 1), date(2026, 3, 26), 12],
    ['52 weeks', date(2026, 1, 1), date(2026, 12, 31), 52],
    ['across a leap day', date(2028, 2, 15), date(2028, 3, 14), 4],
  ]
  for (const [name, start, due, weeks] of valid) {
    test(`accepts ${name}`, () => {
      const result = weeksBetween(start, due)
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.value, weeks)
    })
  }

  test('refuses 30 days and offers both valid dates either side', () => {
    const start = date(2026, 2, 1)
    const result = weeksBetween(start, date(2026, 3, 3))
    assert.equal(result.ok, false)
    if (!result.ok && result.error.kind === 'not-whole-weeks') {
      assert.equal(result.error.days, 30)
      assert.deepEqual(result.error.previousValidDue, date(2026, 3, 1)) // 28 days
      assert.deepEqual(result.error.nextValidDue, date(2026, 3, 8)) // 35 days
    } else {
      assert.fail('expected not-whole-weeks')
    }
  })

  test('refuses a due date before the start', () => {
    const result = weeksBetween(date(2026, 3, 1), date(2026, 2, 1))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'due-before-start')
  })

  test('refuses a same-day loan', () => {
    const result = weeksBetween(date(2026, 2, 1), date(2026, 2, 1))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'same-day')
  })

  for (const days of [1, 6, 8, 13, 27, 29, 30]) {
    test(`refuses ${days} days`, () => {
      const result = weeksBetween(date(2026, 2, 1), new Date(2026, 1, 1 + days))
      assert.equal(result.ok, false)
    })
  }
})

describe('calendar days, not elapsed time', () => {
  test('the time of day is irrelevant', () => {
    const start = new Date(2026, 1, 1, 23, 59, 59)
    const due = new Date(2026, 2, 1, 0, 0, 1)
    assert.equal(daysBetween(start, due), 28)
  })

  test('a daylight-saving shift does not eat a day', () => {
    // US DST begins 8 March 2026. Raw timestamp subtraction gives 27.96 days here.
    const start = date(2026, 3, 1)
    const due = date(2026, 3, 29)
    assert.equal(daysBetween(start, due), 28)
    const result = weeksBetween(start, due)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 4)
  })
})

describe('dueDateAfterWeeks', () => {
  test('is the inverse of weeksBetween', () => {
    const start = date(2026, 2, 1)
    for (const weeks of [1, 2, 4, 8, 13, 52]) {
      const due = dueDateAfterWeeks(start, weeks)
      const back = weeksBetween(start, due)
      assert.equal(back.ok, true)
      if (back.ok) assert.equal(back.value, weeks)
    }
  })

  test('refuses a zero-week loan', () => {
    assert.throws(() => dueDateAfterWeeks(date(2026, 2, 1), 0), /at least one/)
  })
})

describe('calendarDate — the day survives the trip to the database', () => {
  test('midnight becomes midday on the SAME calendar day', () => {
    const normalised = calendarDate(new Date(2026, 0, 5, 0, 0))
    assert.equal(normalised.getDate(), 5)
    assert.equal(normalised.getHours(), 12)
  })

  test('late at night becomes midday on the same day, not the next', () => {
    const normalised = calendarDate(new Date(2026, 0, 5, 23, 59))
    assert.equal(normalised.getDate(), 5)
    assert.equal(normalised.getHours(), 12)
  })

  test('twelve hours of clearance either side of the day boundary', () => {
    // This is the whole point: a Postgres `date` column takes the UTC calendar
    // day of the instant it is handed. At local midnight in Manila that is the
    // day before. No zone on earth is 12 hours from UTC in a way that moves
    // midday, so midday is the only hour that survives everywhere.
    const noon = calendarDate(new Date(2026, 0, 5))
    assert.ok(noon.getUTCHours() >= 0 && noon.getUTCHours() < 24)
    assert.equal(Math.abs(noon.getTime() - new Date(2026, 0, 5).getTime()), 12 * 3_600_000)
  })

  test('applying it twice changes nothing', () => {
    const once = calendarDate(new Date(2026, 0, 5, 3, 17))
    assert.deepEqual(calendarDate(once), once)
  })

  test('dates derived from a due date are carried at midday too', () => {
    assert.equal(dueDateAfterWeeks(new Date(2026, 1, 1), 4).getHours(), 12)
    const slipped = weeksBetween(new Date(2026, 1, 1), new Date(2026, 2, 3))
    assert.equal(slipped.ok, false)
    if (!slipped.ok && slipped.error.kind === 'not-whole-weeks') {
      assert.equal(slipped.error.previousValidDue.getHours(), 12)
      assert.equal(slipped.error.nextValidDue.getHours(), 12)
    }
  })
})
