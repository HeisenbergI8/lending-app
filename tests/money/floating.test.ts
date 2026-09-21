import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { EMPTY_LEDGER, lenderPosition } from '../../src/lib/money/floating.ts'

const peso = (n: number) => centavos(Math.round(n * 100))
const ledger = (over: Partial<Parameters<typeof lenderPosition>[0]>) => ({ ...EMPTY_LEDGER, ...over })

describe("John Ross's pot — the worked example from the spec", () => {
  // He puts in ₱100,000 and funds all of Angel's ₱30,000 loan for 4 weeks.
  const lent = ledger({ deposits: peso(100_000), activePrincipal: peso(30_000), pendingEarnings: peso(6_000) })

  test('while the loan runs, only the capital has left his pot', () => {
    const position = lenderPosition(lent)
    assert.equal(position.floating, peso(70_000))
    assert.equal(position.outOnLoan, peso(30_000))
  })

  test('his ₱6,000 is pending, not floating — it has not been paid yet', () => {
    const position = lenderPosition(lent)
    assert.equal(position.pending, peso(6_000))
    assert.equal(position.earned, peso(0))
  })

  test('on repayment his floating rises by ₱36,000 — capital AND profit', () => {
    const repaid = ledger({ deposits: peso(100_000), settledEarnings: peso(6_000) })
    const position = lenderPosition(repaid)
    assert.equal(position.floating, peso(106_000))
    assert.equal(position.outOnLoan, peso(0))
    assert.equal(position.earned, peso(6_000))
  })

  test('earnings are not held in a separate bucket — they ARE floating', () => {
    const before = lenderPosition(lent).floating
    const after = lenderPosition(ledger({ deposits: peso(100_000), settledEarnings: peso(6_000) })).floating
    assert.equal(after - before, peso(36_000))
  })
})

describe('withdrawals come straight off floating', () => {
  test('deposit ₱100,000, withdraw ₱20,000', () => {
    const position = lenderPosition(ledger({ deposits: peso(100_000), withdrawals: peso(20_000) }))
    assert.equal(position.floating, peso(80_000))
  })

  test('deposits and withdrawals are reported as they were recorded', () => {
    const position = lenderPosition(ledger({ deposits: peso(100_000), withdrawals: peso(20_000) }))
    assert.equal(position.deposits, peso(100_000))
    assert.equal(position.withdrawals, peso(20_000))
  })
})

describe("the admin's pot is a lender's pot plus their cut", () => {
  // The admin funds ₱10,000 of Rico's ₱20,000 loan and takes 2% on the other half.
  test('a settled cut on other people’s money is earned, and floats', () => {
    const position = lenderPosition(
      ledger({ deposits: peso(50_000), settledEarnings: peso(2_800), settledAdminCuts: peso(1_600) }),
    )
    assert.equal(position.earned, peso(4_400))
    assert.equal(position.floating, peso(54_400))
  })

  test('a cut on a loan still running is pending, like any other earning', () => {
    const position = lenderPosition(
      ledger({ deposits: peso(50_000), activePrincipal: peso(10_000), pendingAdminCuts: peso(1_600) }),
    )
    assert.equal(position.pending, peso(1_600))
    assert.equal(position.floating, peso(40_000))
  })

  test('a plain lender carries no cuts, so the same sum serves both', () => {
    const plain = lenderPosition(ledger({ deposits: peso(50_000), settledEarnings: peso(2_800) }))
    assert.equal(plain.earned, peso(2_800))
  })
})

describe('an empty pot', () => {
  test('is zero everywhere, not NaN and not a thrown error', () => {
    const position = lenderPosition(EMPTY_LEDGER)
    assert.deepEqual(
      { f: position.floating, o: position.outOnLoan, e: position.earned, p: position.pending },
      { f: 0, o: 0, e: 0, p: 0 },
    )
  })
})

describe('floating is allowed to go negative', () => {
  // More lent out than was ever put in. Clamping it at zero would hide exactly
  // the situation the admin needs to see.
  test('lending ₱30,000 out of a ₱10,000 pot shows -₱20,000', () => {
    const position = lenderPosition(ledger({ deposits: peso(10_000), activePrincipal: peso(30_000) }))
    assert.equal(position.floating, peso(-20_000))
  })
})

describe('every figure stays a whole number of centavos', () => {
  test('odd centavo amounts do not drift into fractions', () => {
    const position = lenderPosition(
      ledger({ deposits: centavos(100_001), activePrincipal: centavos(33_333), settledEarnings: centavos(7) }),
    )
    assert.ok(Number.isInteger(position.floating))
    assert.equal(position.floating, centavos(100_001 - 33_333 + 7))
  })
})
