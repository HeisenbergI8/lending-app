import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { type SimpleInput, simpleForecast } from '../../src/lib/money/simple-forecast.ts'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const today = day(2026, 11, 8) // window starts 1 May 2026

// John funds a running loan due 29 Nov: ₱6,000 his, ₱2,400 cut to the Admin.
const running = {
  lenderId: 'john', interestCollection: 'AT_END' as const, startOn: day(2026, 11, 1), dueOn: day(2026, 11, 29),
  termDays: 28, principal: centavos(3_000_000), earnings: centavos(600_000), adminCut: centavos(240_000), paidWeeks: new Set<number>(),
}
// Six months of history: John earned ₱36,000 and the Admin cut ₱12,000 on new loans → ₱6,000 + ₱2,000 a month.
const history = [5, 6, 7, 8, 9, 10].map((m) => ({ lenderId: 'john', startOn: day(2026, m, 3), earnings: centavos(600_000), adminCut: centavos(200_000) }))

const input = (extra: Partial<SimpleInput> = {}): SimpleInput => ({
  today,
  months: 4,
  adminId: 'admin',
  capitalNow: new Map([['john', centavos(10_000_000)], ['admin', centavos(1_000_000)]]),
  running: [running],
  history,
  ...extra,
})

test('this month uses what running loans pay; later months use the usual pace, with no empty month', () => {
  const f = simpleForecast(input(), { kind: 'pot' }, 6)
  assert.deepEqual(f.months.map((m) => [m.key, m.interest, m.basis]), [
    ['2026-11', 840_000, 'known'],
    ['2026-12', 800_000, 'usual'],
    ['2027-01', 800_000, 'usual'],
    ['2027-02', 800_000, 'usual'],
  ])
  assert.equal(f.total, 840_000 + 3 * 800_000)
})

test('a lender sees only their own earnings; the Admin sees its own plus the cut', () => {
  const john = simpleForecast(input(), { kind: 'lender', lenderId: 'john' }, 6)
  const admin = simpleForecast(input(), { kind: 'lender', lenderId: 'admin' }, 6)
  assert.equal(john.months[0].interest, 600_000)
  assert.equal(john.usual, 600_000)
  assert.equal(admin.months[0].interest, 240_000)
  assert.equal(admin.usual, 200_000)
  // the views add back up to the whole pot
  const pot = simpleForecast(input(), { kind: 'pot' }, 6)
  assert.equal(john.total + admin.total, pot.total)
})

test('a month where running loans pay more than usual keeps the larger, known figure', () => {
  const big = { ...running, dueOn: day(2026, 12, 20), earnings: centavos(2_000_000) }
  const f = simpleForecast(input({ running: [big] }), { kind: 'pot' }, 6)
  assert.equal(f.months[1].interest, 2_240_000)
  assert.equal(f.months[1].basis, 'known')
})

test('the pot is today’s capital plus interest counted so far', () => {
  const f = simpleForecast(input(), { kind: 'lender', lenderId: 'john' }, 6)
  assert.equal(f.months[0].pot, 10_000_000 + 600_000)
  assert.equal(f.months[3].pot, 10_000_000 + 600_000 * 4)
})

test('overdue money is counted in neither figure, and reported apart', () => {
  const late = { ...running, dueOn: day(2026, 11, 1) }
  const f = simpleForecast(input({ running: [late], history: [] }), { kind: 'pot' }, 6)
  assert.equal(f.months[0].interest, 0)
  assert.equal(f.overdue, 3_000_000 + 600_000 + 240_000)
})
