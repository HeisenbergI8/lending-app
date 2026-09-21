import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { computeInterest, borrowerTotal } from '../../src/lib/money/interest.ts'

const PESO = 100
const peso = (n: number) => centavos(n * PESO)

describe("Angel's loan — the worked example from the spec", () => {
  const terms = { capital: peso(30_000), rateBps: 700, weeks: 4 }

  test('interest is ₱8,400', () => {
    assert.equal(computeInterest(terms), peso(8_400))
  })

  test('she repays ₱38,400', () => {
    assert.equal(borrowerTotal(terms), peso(38_400))
  })
})

describe('interest is simple, on the original capital', () => {
  test('doubling the weeks doubles the interest', () => {
    const base = { capital: peso(30_000), rateBps: 700, weeks: 4 }
    const doubled = { ...base, weeks: 8 }
    assert.equal(computeInterest(doubled), centavos(computeInterest(base) * 2))
  })

  test('doubling the capital doubles the interest', () => {
    const base = { capital: peso(30_000), rateBps: 700, weeks: 4 }
    const doubled = { ...base, capital: peso(60_000) }
    assert.equal(computeInterest(doubled), centavos(computeInterest(base) * 2))
  })

  test('four one-week loans equal one four-week loan — no compounding', () => {
    const weekly = computeInterest({ capital: peso(30_000), rateBps: 700, weeks: 1 })
    const fourWeeks = computeInterest({ capital: peso(30_000), rateBps: 700, weeks: 4 })
    assert.equal(fourWeeks, centavos(weekly * 4))
  })
})

describe('rates the admin might actually set', () => {
  const cases: [number, number, number, number][] = [
    // capital(₱), rate(bps), weeks, expected interest(₱)
    [30_000, 700, 4, 8_400],
    [30_000, 500, 4, 6_000],
    [30_000, 200, 4, 2_400],
    [20_000, 500, 4, 4_000],
    [10_000, 500, 4, 2_000],
    [10_000, 700, 4, 2_800],
    [20_000, 200, 4, 1_600],
    [5_000, 1_000, 2, 1_000],
    [1_000, 700, 1, 70],
  ]
  for (const [capital, rateBps, weeks, expected] of cases) {
    test(`₱${capital.toLocaleString()} at ${rateBps / 100}%/wk for ${weeks}wk = ₱${expected.toLocaleString()}`, () => {
      assert.equal(computeInterest({ capital: peso(capital), rateBps, weeks }), peso(expected))
    })
  }
})

describe('rounding', () => {
  test('rounds to the nearest centavo, half up', () => {
    // ₱0.33 at 7% for 1 week = 0.0231 centavos-worth -> 2 centavos
    assert.equal(computeInterest({ capital: centavos(33), rateBps: 700, weeks: 1 }), centavos(2))
  })

  test('a zero rate earns nothing', () => {
    assert.equal(computeInterest({ capital: peso(30_000), rateBps: 0, weeks: 4 }), centavos(0))
  })
})

describe('inputs that should never reach the maths', () => {
  test('rejects zero capital', () => {
    assert.throws(() => computeInterest({ capital: centavos(0), rateBps: 700, weeks: 4 }), /positive/)
  })
  test('rejects zero weeks', () => {
    assert.throws(() => computeInterest({ capital: peso(30_000), rateBps: 700, weeks: 0 }), /at least one/)
  })
  test('rejects a fractional number of weeks', () => {
    assert.throws(() => computeInterest({ capital: peso(30_000), rateBps: 700, weeks: 4.29 }), /whole number/)
  })
  test('rejects a negative rate', () => {
    assert.throws(() => computeInterest({ capital: peso(30_000), rateBps: -100, weeks: 4 }), /non-negative/)
  })
})
