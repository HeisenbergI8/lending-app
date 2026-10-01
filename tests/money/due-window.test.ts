import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { type DueLoan, dueInWindow } from '../../src/lib/money/due-window.ts'

const day = (d: number) => new Date(2026, 9, d, 12) // October 2026, local midday
const from = day(1)
const to = day(7)

const atEnd = (dueDay: number, borrowerId = 'a'): DueLoan => ({
  borrowerId,
  interestCollection: 'AT_END',
  startOn: day(dueDay - 14),
  dueOn: day(dueDay),
  termDays: 14,
  capital: centavos(1_000_000),
  total: centavos(1_140_000),
  fundings: [{ lenderId: 'l', earnings: centavos(100_000), adminCut: centavos(40_000) }],
  paidWeeks: new Set(),
})

test('an end-collected loan counts its whole total when due inside the window, edges included', () => {
  assert.deepEqual(dueInWindow([atEnd(1), atEnd(7, 'b')], from, to), {
    total: centavos(2_280_000),
    loans: 2,
    borrowers: 2,
  })
})

test('outside the window, before or after, it does not count', () => {
  assert.equal(dueInWindow([atEnd(8)], from, to).total, 0)
  // Already late is the Overdue tile's, not this one's.
  assert.equal(dueInWindow([{ ...atEnd(30), dueOn: new Date(2026, 8, 30, 12) }], from, to).total, 0)
})

test('one person with two loans due is one borrower', () => {
  assert.deepEqual(dueInWindow([atEnd(2), atEnd(3)], from, to), { total: centavos(2_280_000), loans: 2, borrowers: 1 })
})

// Four weeks from Sep 16: weeks fall Sep 23, Sep 30, Oct 7, Oct 14. ₱4,000 interest a week.
const weekly = (paid: number[] = []): DueLoan => ({
  borrowerId: 'w',
  interestCollection: 'WEEKLY',
  startOn: new Date(2026, 8, 16, 12),
  dueOn: day(14),
  termDays: 28,
  capital: centavos(10_000_000),
  total: centavos(11_600_000),
  fundings: [{ lenderId: 'l', earnings: centavos(1_200_000), adminCut: centavos(400_000) }],
  paidWeeks: new Set(paid),
})

test('a weekly loan counts only the unpaid week inside the window, not the missed one before it', () => {
  assert.equal(dueInWindow([weekly([1])], from, to).total, 400_000)
})

test('a week already paid is not due', () => {
  assert.equal(dueInWindow([weekly([3])], from, to).loans, 0)
})

test('the last week comes with the capital', () => {
  assert.equal(dueInWindow([weekly([1, 2, 3])], day(8), day(14)).total, 400_000 + 10_000_000)
})
