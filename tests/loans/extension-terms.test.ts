import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { type ExtendableLoan, planExtension } from '../../src/server/loans/extension-terms.ts'
import { loanTerms } from '../../src/server/loans/terms.ts'

const day = (m: number, d: number) => new Date(2026, m - 1, d, 12)

// ₱30,000 for 4 weeks at 7%, ₱20,000 from a lender (5% + 2% cut), ₱10,000 Admin's own.
function loan(extra: Partial<ExtendableLoan> = {}): ExtendableLoan {
  const startOn = day(9, 13)
  const dueOn = day(10, 11)
  const funders = [
    { lenderId: 'maria', isSelf: false, principal: centavos(2_000_000) },
    { lenderId: 'admin', isSelf: true, principal: centavos(1_000_000) },
  ]
  const t = loanTerms({
    capital: centavos(3_000_000),
    startOn,
    dueOn,
    interest: { basis: 'WEEKLY_RATE', borrowerRateBps: 700, adminCutBps: 200 },
    collection: 'AT_END',
    funders,
  })
  if (!t.ok) throw new Error(t.error)
  return {
    capital: centavos(3_000_000),
    startOn,
    dueOn,
    interestBasis: 'WEEKLY_RATE',
    interestCollection: 'AT_END',
    borrowerRateBps: 700,
    interest: t.value.interest,
    fundings: t.value.fundings.map((f) => ({
      lenderId: f.lenderId,
      isSelf: f.lenderId === 'admin',
      principal: f.principal,
      adminCutBps: f.adminCutBps,
      earnings: f.earnings,
    })),
    paidWeeks: new Set(),
    ...extra,
  }
}

test('nothing paid now: the same loan runs longer and charges the extra weeks', () => {
  const plan = planExtension(loan(), { weeks: 2, mode: 'later' })
  assert.ok(plan.ok)
  assert.equal(plan.value.mode, 'later')
  assert.deepEqual(plan.value.toDueOn, day(10, 25))
  assert.equal(plan.value.addedDays, 14)
  // 30,000 x 7% x 2 = 4,200 extra; 6 weeks in all = 12,600
  assert.equal(plan.value.addedInterest, 420_000)
  assert.equal(plan.value.mode === 'later' && plan.value.terms.interest, 1_260_000)
  // Maria keeps 5% x 20,000 x 2 = 2,000 of the extra
  assert.equal(plan.value.addedLenderInterest, 200_000)
})

test('interest paid now: closes at its interest, the capital continues from the old due date', () => {
  const l = loan()
  const plan = planExtension(l, { weeks: 2, mode: 'now' })
  assert.ok(plan.ok)
  assert.ok(plan.value.mode === 'now')
  assert.equal(plan.value.interestPaid, l.interest) // 8,400
  assert.equal(plan.value.interestPaid, 840_000)
  assert.deepEqual(plan.value.continuation.startOn, day(10, 11))
  assert.deepEqual(plan.value.continuation.dueOn, day(10, 25))
  assert.equal(plan.value.continuation.terms.interest, 420_000)
  assert.equal(plan.value.continuation.terms.total, 3_420_000)
})

test('a weekly loan cannot pay now, but extends its schedule; the next unpaid week stays put', () => {
  const weekly = loan({ interestCollection: 'WEEKLY', paidWeeks: new Set([1, 2]) })
  assert.equal(planExtension(weekly, { weeks: 1, mode: 'now' }).ok, false)
  const plan = planExtension(weekly, { weeks: 2, mode: 'later' })
  assert.ok(plan.ok && plan.value.mode === 'later')
  assert.deepEqual(plan.value.nextDueOn, day(10, 4)) // week 3
  assert.equal(plan.value.terms.termDays, 42)
})

test('a fixed-amount loan needs the extra interest typed, and adds exactly that', () => {
  const fixedLoan = loan({ interestBasis: 'FIXED_AMOUNT', borrowerRateBps: null })
  assert.equal(planExtension(fixedLoan, { weeks: 1, mode: 'later' }).ok, false)
  const plan = planExtension(fixedLoan, {
    weeks: 1,
    mode: 'later',
    fixed: { interest: centavos(150_000), lenderInterest: centavos(100_000) },
  })
  assert.ok(plan.ok)
  assert.equal(plan.value.addedInterest, 150_000)
  assert.equal(plan.value.addedLenderInterest, 100_000)
})

test('silly week counts are refused', () => {
  assert.equal(planExtension(loan(), { weeks: 0, mode: 'later' }).ok, false)
  assert.equal(planExtension(loan(), { weeks: 53, mode: 'later' }).ok, false)
  assert.equal(planExtension(loan(), { weeks: 1.5, mode: 'later' }).ok, false)
})
