import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatCountdown } from '../src/lib/countdown.ts'

const minutes = (n: number) => n * 60_000

describe('the lockout countdown', () => {
  test('counts minutes and seconds', () => {
    assert.equal(formatCountdown(minutes(14) + 59_000), '14:59')
    assert.equal(formatCountdown(minutes(1)), '1:00')
  })

  test('pads the seconds so the width never jumps', () => {
    assert.equal(formatCountdown(minutes(2) + 5_000), '2:05')
    assert.equal(formatCountdown(9_000), '0:09')
  })

  // Rounding up is what describeRetryAfter does, and it is wrong here: it would
  // hold at "1:00" for a full second before the end and never show zero.
  test('truncates rather than rounding up, so every tick moves', () => {
    assert.equal(formatCountdown(59_999), '0:59')
    assert.equal(formatCountdown(1_500), '0:01')
  })

  test('never goes negative when the clock overshoots', () => {
    assert.equal(formatCountdown(0), '0:00')
    assert.equal(formatCountdown(-5_000), '0:00')
  })
})
