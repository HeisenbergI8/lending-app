import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { accruedBetween } from '../../src/lib/money/accrual.ts'
import { calendarDate } from '../../src/lib/money/weeks.ts'

const peso = (n: number) => centavos(n * 100)
const day = (iso: string) => calendarDate(new Date(`${iso}T00:00:00`))

/** The whole of the month `iso` names, e.g. month('2026-09') is 1 to 30 September. */
function month(iso: string): { from: Date; to: Date } {
  const [year, index] = iso.split('-').map(Number)
  return {
    from: calendarDate(new Date(year, index - 1, 1)),
    to: calendarDate(new Date(year, index, 0)),
  }
}

describe('a loan that starts and ends inside one month', () => {
  // 1 to 29 September, four weeks, ₱8,400 of interest.
  const start = day('2026-09-01')

  test('the whole interest falls in that month', () => {
    const { from, to } = month('2026-09')
    assert.equal(accruedBetween(peso(8_400), start, 28, from, to), peso(8_400))
  })

  test('nothing falls in the month before or after', () => {
    for (const label of ['2026-08', '2026-10']) {
      const { from, to } = month(label)
      assert.equal(accruedBetween(peso(8_400), start, 28, from, to), 0)
    }
  })
})

describe('a loan that overlaps two months — the feature this exists for', () => {
  // 20 September to 18 October: 11 days in September, 17 in October.
  const start = day('2026-09-20')
  const total = peso(8_400)

  test('September gets the days it ran in September', () => {
    const { from, to } = month('2026-09')
    // floor(840000 * 11 / 28) = 330000
    assert.equal(accruedBetween(total, start, 28, from, to), peso(3_300))
  })

  test('October gets the rest, remainder included', () => {
    const { from, to } = month('2026-10')
    assert.equal(accruedBetween(total, start, 28, from, to), peso(5_100))
  })

  test('the two months add up to the whole interest, to the centavo', () => {
    const sep = accruedBetween(total, start, 28, month('2026-09').from, month('2026-09').to)
    const oct = accruedBetween(total, start, 28, month('2026-10').from, month('2026-10').to)
    assert.equal(sep + oct, total)
  })
})

describe('the term is worked from the start date to the day before the due date', () => {
  const start = day('2026-09-01')

  test('the start date itself earns a day', () => {
    // One of 28 days of ₱8,400: floor(840000 / 28) = 30000.
    assert.equal(accruedBetween(peso(8_400), start, 28, start, start), peso(300))
  })

  test('the due date earns nothing — the money is back', () => {
    const due = day('2026-09-29')
    assert.equal(accruedBetween(peso(8_400), start, 28, due, due), 0)
  })

  test('the day before the due date is the last that earns', () => {
    const last = day('2026-09-28')
    assert.equal(accruedBetween(peso(8_400), start, 28, last, last), peso(300))
  })
})

describe('any partition of the term sums back to the interest exactly', () => {
  // An awkward total over an awkward term, so the flooring has a remainder to
  // carry on nearly every slice. 8,401 centavos over 29 days divides into
  // nothing tidy, which is the case worth pinning down.
  const total = centavos(8_401)
  const start = day('2026-01-15')
  const termDays = 29

  test('day by day', () => {
    let sum = 0
    for (let offset = 0; offset < termDays; offset += 1) {
      const on = day('2026-01-15')
      on.setDate(on.getDate() + offset)
      sum += accruedBetween(total, start, termDays, on, on)
    }
    assert.equal(sum, total)
  })

  test('month by month, including the months either side', () => {
    const sum = ['2025-12', '2026-01', '2026-02', '2026-03'].reduce((running, label) => {
      const { from, to } = month(label)
      return running + accruedBetween(total, start, termDays, from, to)
    }, 0)
    assert.equal(sum, total)
  })

  test('split at an arbitrary day, both halves', () => {
    const before = accruedBetween(total, start, termDays, day('2025-06-01'), day('2026-01-20'))
    const after = accruedBetween(total, start, termDays, day('2026-01-21'), day('2027-06-01'))
    assert.equal(before + after, total)
  })
})

describe('a twenty-week loan, the one the spec was written from', () => {
  // ₱60,000 at 7% for 20 weeks: ₱84,000 of interest over 140 days, starting
  // 1 September 2026 and due 19 January 2027.
  const total = peso(84_000)
  const start = day('2026-09-01')
  const termDays = 140

  test('the five months it touches add up to the whole interest', () => {
    const sum = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].reduce((running, label) => {
      const { from, to } = month(label)
      return running + accruedBetween(total, start, termDays, from, to)
    }, 0)
    assert.equal(sum, total)
  })

  test('a full 30-day month is 30 of the 140 days', () => {
    const { from, to } = month('2026-09')
    assert.equal(accruedBetween(total, start, termDays, from, to), peso(18_000))
  })
})

describe('edges', () => {
  const start = day('2026-09-01')

  test('a range typed backwards earns nothing rather than a negative', () => {
    assert.equal(accruedBetween(peso(8_400), start, 28, day('2026-09-30'), day('2026-09-01')), 0)
  })

  test('zero interest accrues zero', () => {
    const { from, to } = month('2026-09')
    assert.equal(accruedBetween(centavos(0), start, 28, from, to), 0)
  })

  test('a term of no days accrues nothing rather than dividing by zero', () => {
    const { from, to } = month('2026-09')
    assert.equal(accruedBetween(peso(8_400), start, 0, from, to), 0)
  })

  test('a range far wider than the term is still just the interest', () => {
    assert.equal(
      accruedBetween(peso(8_400), start, 28, day('2020-01-01'), day('2030-01-01')),
      peso(8_400),
    )
  })
})
