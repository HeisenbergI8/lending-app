import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { requestFigures } from '../../src/server/pending/queries.ts'

/**
 * What the pending list promises beside each request.
 *
 * The screen says "would owe" and prints an interest figure next to a weekly
 * rate. This is the whole of what produces both, so this file is where those
 * words are either true or not.
 *
 * The rows are the ones from the sheet the module was specified from, worked
 * out by hand: ₱25,000 at 7% a week for four weeks is ₱1,750 a week, ₱7,000 of
 * interest, ₱32,000 to hand back.
 *
 * A REQUEST IS NOT A LOAN, and the difference these tests protect is that
 * nothing here is stored. Change the rate on a request and the figures change
 * with it; change a default rate next year and no existing LOAN moves, because
 * a loan's figures were written into its row the day it was created.
 */
describe('requestFigures', () => {
  test('four weeks at 7% on ₱25,000', () => {
    const figures = requestFigures({ capitalCentavos: 2_500_000, borrowerRateBps: 700, termDays: 28 })

    assert.equal(figures.interest, 700_000)
    assert.equal(figures.total, 3_200_000)
  })

  test('three weeks at 7% on ₱26,000', () => {
    const figures = requestFigures({ capitalCentavos: 2_600_000, borrowerRateBps: 700, termDays: 21 })

    assert.equal(figures.interest, 546_000)
    assert.equal(figures.total, 3_146_000)
  })

  test('one week at 7% on ₱35,000', () => {
    const figures = requestFigures({ capitalCentavos: 3_500_000, borrowerRateBps: 700, termDays: 7 })

    assert.equal(figures.interest, 245_000)
    assert.equal(figures.total, 3_745_000)
  })

  test('the total is always the capital plus the interest, never a second sum', () => {
    const figures = requestFigures({ capitalCentavos: 2_000_000, borrowerRateBps: 750, termDays: 14 })

    assert.equal(figures.interest, 300_000)
    assert.equal(figures.total, figures.capital + figures.interest)
  })

  /**
   * Rounding lands on the whole request, not on a per-week figure multiplied
   * up. ₱1,111 for one week at 7.25% is 80.5475 centavos short of a peso;
   * rounding it weekly and then multiplying would drift, which is the same
   * mistake split.ts exists to prevent on a funded loan.
   */
  test('an amount that does not divide cleanly rounds once, half up', () => {
    const figures = requestFigures({ capitalCentavos: 111_100, borrowerRateBps: 725, termDays: 21 })

    assert.equal(figures.interest, 24_164)
    assert.equal(figures.total, 135_264)
  })
})
