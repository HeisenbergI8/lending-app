import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos, parsePesos, formatPesos, checkedProduct } from '../../src/lib/money/centavos.ts'

describe('parsePesos — what a person types', () => {
  const accepted: [string, number][] = [
    ['30000', 3_000_000],
    ['30,000', 3_000_000],
    ['₱30,000', 3_000_000],
    [' 30000 ', 3_000_000],
    ['30000.50', 3_000_050],
    ['30000.5', 3_000_050],
    ['0.01', 1],
    ['0', 0],
    ['1,234,567.89', 123_456_789],
  ]
  for (const [input, expected] of accepted) {
    test(`accepts ${JSON.stringify(input)}`, () => {
      const result = parsePesos(input)
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.value, expected)
    })
  }

  test('rejects three decimal places rather than rounding them away', () => {
    const result = parsePesos('30000.005')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'too-many-decimals')
  })

  const rejected: [string, string][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not-a-number'],
    ['30000.', 'not-a-number'],
    ['-500', 'negative'],
    ['1e5', 'not-a-number'],
  ]
  for (const [input, kind] of rejected) {
    test(`rejects ${JSON.stringify(input)} as ${kind}`, () => {
      const result = parsePesos(input)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.kind, kind)
    })
  }
})

describe('formatPesos', () => {
  test('formats with grouping and two decimals', () => {
    assert.equal(formatPesos(centavos(3_000_000)), '₱30,000.00')
    assert.equal(formatPesos(centavos(3_840_000)), '₱38,400.00')
    assert.equal(formatPesos(centavos(1)), '₱0.01')
    assert.equal(formatPesos(centavos(0)), '₱0.00')
    assert.equal(formatPesos(centavos(123_456_789)), '₱1,234,567.89')
  })

  test('round-trips through parsePesos', () => {
    for (const amount of [0, 1, 99, 100, 3_000_050, 123_456_789]) {
      const formatted = formatPesos(centavos(amount))
      const parsed = parsePesos(formatted)
      assert.equal(parsed.ok, true)
      if (parsed.ok) assert.equal(parsed.value, amount)
    }
  })
})

describe('the integer guarantee', () => {
  test('centavos refuses a fractional amount', () => {
    assert.throws(() => centavos(100.5), /whole number/)
  })

  test('checkedProduct refuses to silently lose precision', () => {
    assert.throws(() => checkedProduct(Number.MAX_SAFE_INTEGER, 2), /safe integer range/)
  })

  test('checkedProduct allows a realistically large loan', () => {
    // ₱10,000,000 at 7%/week for 52 weeks
    assert.equal(checkedProduct(1_000_000_000, 700, 52), 36_400_000_000_000)
  })
})
