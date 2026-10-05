import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { type ProjectedRow, projectFloating } from '../../src/lib/money/projection.ts'

const day = (m: number, d: number) => new Date(2026, m - 1, d, 12)
const today = day(10, 5)

const atEnd = (due: Date, extra: Partial<ProjectedRow> = {}): ProjectedRow => ({
  loanId: 'end',
  borrowerName: 'Ana',
  interestCollection: 'AT_END',
  startOn: day(9, 21),
  dueOn: due,
  termDays: 14,
  principal: centavos(2_000_000),
  earnings: centavos(200_000),
  adminCut: centavos(0),
  paidWeeks: new Set(),
  ...extra,
})

test('a loan due by the chosen day adds its capital and interest; one due after does not', () => {
  const rows = [atEnd(day(10, 10)), atEnd(day(10, 20), { loanId: 'later' })]
  const p = projectFloating(centavos(500_000), rows, today, day(10, 15))
  assert.equal(p.projected, 500_000 + 2_000_000 + 200_000)
  assert.equal(p.arrivals.length, 1)
  assert.equal(p.late, 0)
})

test('the chosen day itself and today both count', () => {
  assert.equal(projectFloating(centavos(0), [atEnd(day(10, 15))], today, day(10, 15)).capital, 2_000_000)
  assert.equal(projectFloating(centavos(0), [atEnd(today)], today, today).capital, 2_000_000)
})

test('money already late is reported apart, not assumed to arrive', () => {
  const p = projectFloating(centavos(100), [atEnd(day(10, 1))], today, day(12, 31))
  assert.equal(p.projected, 100)
  assert.equal(p.late, 2_200_000)
})

test('the Admin cut on another lender\'s row counts for the Admin pot', () => {
  const cutOnly = atEnd(day(10, 10), { principal: centavos(0), earnings: centavos(0), adminCut: centavos(80_000) })
  const p = projectFloating(centavos(0), [cutOnly], today, day(10, 31))
  assert.equal(p.adminCuts, 80_000)
  assert.equal(p.projected, 80_000)
})

test('two rows of one loan on one day are one line', () => {
  const own = atEnd(day(10, 10))
  const cut = atEnd(day(10, 10), { principal: centavos(0), earnings: centavos(0), adminCut: centavos(40_000) })
  const p = projectFloating(centavos(0), [own, cut], today, day(10, 31))
  assert.equal(p.arrivals.length, 1)
  assert.equal(p.arrivals[0].adminCut, 40_000)
})

// Four weeks from Sep 21: Sep 28, Oct 5, Oct 12, Oct 19. Earnings 400,001 → 100,000 x3 + 100,001.
const weekly = (paid: number[]): ProjectedRow => ({
  ...atEnd(day(10, 19)),
  loanId: 'wk',
  interestCollection: 'WEEKLY',
  termDays: 28,
  earnings: centavos(400_001),
  paidWeeks: new Set(paid),
})

test('weekly: each unpaid week by the chosen day, capital only with the last', () => {
  const p = projectFloating(centavos(0), [weekly([1])], today, day(10, 12))
  assert.equal(p.interest, 200_000) // Oct 5 and Oct 12
  assert.equal(p.capital, 0)
  const all = projectFloating(centavos(0), [weekly([1])], today, day(10, 19))
  assert.equal(all.interest, 300_001)
  assert.equal(all.capital, 2_000_000)
})

test('weekly: a missed week is late, not projected', () => {
  const p = projectFloating(centavos(0), [weekly([])], today, day(10, 19))
  assert.equal(p.late, 100_000)
  assert.equal(p.interest, 300_001)
})
