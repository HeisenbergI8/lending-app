import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { centavos } from '../../src/lib/money/centavos.ts'
import { adminStakeInLoan } from '../../src/lib/money/split.ts'

const peso = (n: number) => centavos(n * 100)
const NONE = centavos(0)

/**
 * The ceiling on an advance is everything the loan gives back to the Admin pot.
 * Worked from the same ₱30,000 / 4 weeks / 7% loan as split.test.ts, so the
 * figures here can be checked against the ones there.
 */
describe('a loan funded entirely by somebody else', () => {
  // John Ross puts up all ₱30,000. He earns 5% x 4 = ₱6,000; the Admin's cut is
  // 2% x 4 = ₱2,400. The Admin put in nothing, so nothing but the cut comes back.
  const fundings = [
    { principal: peso(30_000), earnings: peso(6_000), adminCut: peso(2_400), isSelf: false },
  ]

  test('the Admin can draw the cut and not a centavo more', () => {
    const stake = adminStakeInLoan(fundings, NONE, NONE)
    assert.equal(stake.stake, peso(2_400))
    assert.equal(stake.headroom, peso(2_400))
  })

  test('an advance already taken comes off the ceiling', () => {
    const stake = adminStakeInLoan(fundings, peso(1_000), NONE)
    assert.equal(stake.stake, peso(2_400))
    assert.equal(stake.advanced, peso(1_000))
    assert.equal(stake.headroom, peso(1_400))
  })

  test('drawn to the ceiling leaves nothing', () => {
    assert.equal(adminStakeInLoan(fundings, peso(2_400), NONE).headroom, NONE)
  })
})

describe("a loan funded entirely by the Admin's own money", () => {
  // The Admin is a lender row whose money earns the whole 7%, so the cut on it
  // is zero. What comes back is the capital plus that full interest.
  const fundings = [
    { principal: peso(30_000), earnings: peso(8_400), adminCut: NONE, isSelf: true },
  ]

  test('the capital comes back as well as the interest', () => {
    assert.equal(adminStakeInLoan(fundings, NONE, NONE).stake, peso(38_400))
  })
})

describe('a loan funded by both', () => {
  // Maria ₱20,000 at 5% for 4 weeks earns ₱4,000, and the Admin's cut on her
  // money is ₱1,600. The Admin's own ₱10,000 earns the full 7% x 4 = ₱2,800.
  const fundings = [
    { principal: peso(20_000), earnings: peso(4_000), adminCut: peso(1_600), isSelf: false },
    { principal: peso(10_000), earnings: peso(2_800), adminCut: NONE, isSelf: true },
  ]

  test("only the Admin's own capital counts, plus both kinds of interest", () => {
    // 10,000 back + 2,800 earned on it + 1,600 cut on Maria's share.
    assert.equal(adminStakeInLoan(fundings, NONE, NONE).stake, peso(14_400))
  })

  test("Maria's capital is not the Admin's to draw", () => {
    const stake = adminStakeInLoan(fundings, NONE, NONE)
    assert.ok(stake.stake < peso(30_000), 'the ceiling must not reach the whole loan')
  })
})

describe('the ceiling cannot go negative', () => {
  // A loan edited smaller after an advance was taken. The pot is overdrawn
  // against it, which floating funds already shows; the headroom is simply nil.
  const fundings = [{ principal: peso(10_000), earnings: peso(1_000), adminCut: NONE, isSelf: true }]

  test('more drawn than the loan will return leaves zero to draw, not a minus', () => {
    assert.equal(adminStakeInLoan(fundings, peso(50_000), NONE).headroom, NONE)
  })
})

describe('a loan with no funding rows at all', () => {
  test('returns nothing and offers nothing', () => {
    const stake = adminStakeInLoan([], NONE, NONE)
    assert.equal(stake.stake, NONE)
    assert.equal(stake.headroom, NONE)
  })
})

describe('a weekly loan has already paid part of the stake into the pot', () => {
  // The Admin funds all ₱60,000 themselves at 7% for 20 weeks. Their own capital
  // earns ₱84,000 and there is no cut, so the stake is ₱144,000 — the capital
  // plus every week. Each week hands over ₱4,200.
  const fundings = [
    { principal: peso(60_000), earnings: peso(84_000), adminCut: NONE, isSelf: true },
  ]

  test('nothing collected yet: the whole stake is drawable', () => {
    const stake = adminStakeInLoan(fundings, NONE, NONE)
    assert.equal(stake.stake, peso(144_000))
    assert.equal(stake.headroom, peso(144_000))
  })

  test('TEN WEEKS COLLECTED COMES OFF THE CEILING', () => {
    // The ₱42,000 those ten weeks paid is already in floating, where it can be
    // spent directly. Offering it again as an advance against this loan would be
    // the same money twice.
    const stake = adminStakeInLoan(fundings, NONE, peso(42_000))
    assert.equal(stake.stake, peso(144_000))
    assert.equal(stake.released, peso(42_000))
    assert.equal(stake.headroom, peso(102_000))
  })

  test('collected weeks and an advance both come off, together', () => {
    const stake = adminStakeInLoan(fundings, peso(20_000), peso(42_000))
    assert.equal(stake.headroom, peso(82_000))
  })

  test('the ceiling never goes below zero', () => {
    const stake = adminStakeInLoan(fundings, peso(120_000), peso(42_000))
    assert.equal(stake.headroom, NONE)
  })

  test('a loan collected at the end releases nothing, so nothing changes', () => {
    const atEnd = adminStakeInLoan(fundings, NONE, NONE)
    assert.equal(atEnd.released, NONE)
    assert.equal(atEnd.headroom, atEnd.stake)
  })
})
