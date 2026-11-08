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

// ₱100,000 in the pot today (John ₱90,000, Admin ₱10,000): ₱8,000 a month on it is an 8% monthly return.
const input = (extra: Partial<SimpleInput> = {}): SimpleInput => ({
  today,
  months: 4,
  adminId: 'admin',
  capitalNow: new Map([['john', centavos(9_000_000)], ['admin', centavos(1_000_000)]]),
  running: [running],
  history,
  ...extra,
})

test('this month is what running loans pay; then the usual return compounds on the growing pot', () => {
  const f = simpleForecast(input(), { kind: 'pot' }, 6)
  assert.equal(f.monthlyReturnBps, 800)
  assert.deepEqual(f.months.map((m) => [m.key, m.interest, m.pot]), [
    ['2026-11', 840_000, 10_840_000],
    ['2026-12', 867_200, 11_707_200], // 8% of ₱108,400
    ['2027-01', 936_576, 12_643_776], // 8% of ₱117,072: interest on interest
    ['2027-02', 1_011_502, 13_655_278],
  ])
  assert.equal(f.total, 840_000 + 867_200 + 936_576 + 1_011_502)
})

test('a lender earns their own return on their own money; the Admin’s includes the cut', () => {
  const john = simpleForecast(input(), { kind: 'lender', lenderId: 'john' }, 6)
  const admin = simpleForecast(input(), { kind: 'lender', lenderId: 'admin' }, 6)
  assert.equal(john.months[0].interest, 600_000)
  assert.equal(john.months[1].interest, 640_000) // ₱6,000 on ₱90,000, applied to ₱96,000
  assert.equal(admin.months[0].interest, 240_000)
  assert.equal(admin.months[1].interest, 248_000) // ₱2,000 on ₱10,000, applied to ₱12,400
})

test('money added each month grows the pot and the interest after it', () => {
  const f = simpleForecast(input({ monthlyIn: centavos(1_000_000) }), { kind: 'pot' }, 6)
  assert.equal(f.months[0].pot, 10_840_000) // nothing added this month
  assert.equal(f.months[1].pot, 10_840_000 + 867_200 + 1_000_000)
  assert.equal(f.months[2].interest, Math.round(12_707_200 * 0.08))
})

test('taking out the interest every month keeps the pot flat; taking out more empties it, never below zero', () => {
  const flat = simpleForecast(input({ monthlyOut: centavos(867_200) }), { kind: 'pot' }, 6)
  assert.equal(flat.months[1].pot, 10_840_000)
  const drain = simpleForecast(input({ monthlyOut: centavos(20_000_000) }), { kind: 'pot' }, 6)
  assert.equal(drain.months[1].pot, 0)
  assert.equal(drain.months[1].takenOut, 10_840_000 + 867_200)
  assert.equal(drain.months[2].interest, 0)
})

test('a month where running loans pay more than the return keeps the larger, known figure', () => {
  const big = { ...running, dueOn: day(2026, 12, 20), earnings: centavos(2_000_000) }
  const f = simpleForecast(input({ running: [big] }), { kind: 'pot' }, 6)
  assert.equal(f.months[1].interest, 2_240_000)
  assert.equal(f.months[1].basis, 'known')
})

test('overdue money is counted in neither figure, and reported apart', () => {
  const late = { ...running, dueOn: day(2026, 11, 1) }
  const f = simpleForecast(input({ running: [late], history: [] }), { kind: 'pot' }, 6)
  assert.equal(f.months[0].interest, 0)
  assert.equal(f.overdue, 3_000_000 + 600_000 + 240_000)
})
