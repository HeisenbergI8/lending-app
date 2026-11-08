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
// September was slow (half) and October busy (one and a half): his busiest month is ₱9,000 own + ₱3,000 cut.
const share = [1, 1, 1, 1, 0.5, 1.5]
// Each loan runs 28 days inside its month, so spreading it over its days keeps it in that month.
const history = [5, 6, 7, 8, 9, 10].map((m, i) => ({
  loanId: `L${m}`, lenderId: 'john', startOn: day(2026, m, 3), termDays: 28, earnings: centavos(600_000 * share[i]), adminCut: centavos(200_000 * share[i]),
}))

// ₱100,000 in the pot today (John ₱90,000, Admin ₱10,000): ₱8,000 a month on it is an 8% monthly return.
const input = (extra: Partial<SimpleInput> = {}): SimpleInput => ({
  today,
  months: 4,
  adminId: 'admin',
  capitalNow: new Map([['john', centavos(9_000_000)], ['admin', centavos(1_000_000)]]),
  running: [running],
  history,
  firstLoanOn: day(2026, 5, 1), // a book lending since the window began
  ...extra,
})

test('this month is what running loans pay; then each lender compounds at their own return', () => {
  const f = simpleForecast(input(), { kind: 'pot' })
  // John: ₱6,000 own + ₱2,000 cut a month on ₱90,000. Admin: no history of its own.
  assert.equal(f.months[0].interest, 840_000)
  assert.equal(f.months[0].pot, 10_840_000)
  // Dec: on John's ₱96,000 → ₱6,400 own + ₱2,133.33 cut (rounded); the Admin's own money earns nothing new
  assert.equal(f.months[1].interest, 640_000 + 213_333)
  assert.equal(f.months[1].pot, 10_840_000 + 853_333)
  // interest on interest: January earns more than December
  assert.ok(f.months[2].interest > f.months[1].interest)
})

test('the parts always add up to the whole pot', () => {
  const pot = simpleForecast(input({ months: 24 }), { kind: 'pot' })
  const john = simpleForecast(input({ months: 24 }), { kind: 'lender', lenderId: 'john' })
  const admin = simpleForecast(input({ months: 24 }), { kind: 'lender', lenderId: 'admin' })
  assert.equal(john.total + admin.total, pot.total)
  assert.equal(john.months[23].pot + admin.months[23].pot, pot.months[23].pot)
})

test('the Admin cut grows with the lender capital that earns it, never with the Admin’s own pot', () => {
  const admin = simpleForecast(input(), { kind: 'lender', lenderId: 'admin' })
  assert.equal(admin.months[0].interest, 240_000) // the running loan's cut
  assert.equal(admin.months[1].interest, 213_333) // 2.22% of John's ₱96,000 — not 20% of the Admin's ₱12,400
  assert.equal(admin.monthlyReturnBps, 0) // its own money has no history
  assert.equal(admin.usualCut, 200_000)
  // money added to the Admin's own pot does not change the cut it receives
  const more = simpleForecast(input({ monthlyIn: centavos(5_000_000) }), { kind: 'lender', lenderId: 'admin' })
  assert.equal(more.months[2].interest, admin.months[2].interest)
})

test('money added each month grows the pot and the interest after it', () => {
  const base = simpleForecast(input(), { kind: 'lender', lenderId: 'john' })
  const f = simpleForecast(input({ monthlyIn: centavos(1_000_000) }), { kind: 'lender', lenderId: 'john' })
  assert.equal(f.months[0].pot, base.months[0].pot) // nothing added this month
  assert.equal(f.months[1].pot, base.months[1].pot + 1_000_000)
  assert.ok(f.months[2].interest > base.months[2].interest)
})

test('taking out more than the pot empties it, never below zero, and it then earns nothing', () => {
  const drain = simpleForecast(input({ monthlyOut: centavos(50_000_000) }), { kind: 'lender', lenderId: 'john' })
  assert.equal(drain.months[1].pot, 0)
  assert.equal(drain.months[1].takenOut, 9_600_000 + 640_000)
  assert.equal(drain.months[2].interest, 0)
})

test('a month where running loans pay more than the return keeps the larger, known figure', () => {
  const big = { ...running, dueOn: day(2026, 12, 20), earnings: centavos(2_000_000) }
  const f = simpleForecast(input({ running: [big] }), { kind: 'pot' })
  assert.equal(f.months[1].interest, 2_000_000 + 240_000)
  assert.equal(f.months[1].basis, 'known')
})

test('overdue money is counted in neither figure, and reported apart', () => {
  const late = { ...running, dueOn: day(2026, 11, 1) }
  const f = simpleForecast(input({ running: [late], history: [] }), { kind: 'pot' })
  assert.equal(f.months[0].interest, 0)
  assert.equal(f.overdue, 3_000_000 + 600_000 + 240_000)
})

test('a lender with almost no money left cannot compound a huge return: it is capped, and nothing throws', () => {
  const f = simpleForecast(
    input({ months: 24, capitalNow: new Map([['john', centavos(10_000)], ['admin', centavos(1_000_000)]]) }),
    { kind: 'lender', lenderId: 'john' },
  )
  assert.equal(f.capped, true)
  assert.ok(Number.isSafeInteger(f.total))
  assert.equal(simpleForecast(input(), { kind: 'pot' }).capped, false)
})

test('borrowers are limited: a lender never earns more in a month than their busiest month, and the rest sits idle', () => {
  const f = simpleForecast(input({ months: 24 }), { kind: 'lender', lenderId: 'john' })
  assert.ok(f.months.every((m, i) => i === 0 || m.interest <= 900_000))
  assert.equal(f.months[23].interest, 900_000)
  assert.ok(f.months[23].idle > 0)
  assert.equal(f.months[1].idle, 0) // ₱6,400 on ₱96,000 is still under the busiest month
  // the cut is held the same way
  const admin = simpleForecast(input({ months: 24 }), { kind: 'lender', lenderId: 'admin' })
  assert.equal(admin.months[23].interest, 300_000)
})

test('slow and busy months scale the return by the slowest and busiest month of the whole pot', () => {
  const slow = simpleForecast(input({ pace: 'slow' }), { kind: 'lender', lenderId: 'john' })
  const busy = simpleForecast(input({ pace: 'busy' }), { kind: 'lender', lenderId: 'john' })
  assert.equal(slow.paceFactor, 0.5)
  assert.equal(busy.paceFactor, 1.5)
  assert.equal(slow.months[0].interest, 600_000) // this month is still what running loans pay
  assert.equal(slow.months[1].interest, 320_000) // half of ₱6,400
  assert.equal(busy.months[1].interest, 900_000) // ₱9,600 held to his busiest month, ₱9,000
  const usual = simpleForecast(input(), { kind: 'lender', lenderId: 'john' })
  assert.ok(slow.total < usual.total && usual.total < busy.total)
})

test('at every pace the parts still add up to the whole pot', () => {
  for (const pace of ['slow', 'busy'] as const) {
    const pot = simpleForecast(input({ months: 24, pace }), { kind: 'pot' })
    const john = simpleForecast(input({ months: 24, pace }), { kind: 'lender', lenderId: 'john' })
    const admin = simpleForecast(input({ months: 24, pace }), { kind: 'lender', lenderId: 'admin' })
    assert.equal(john.total + admin.total, pot.total)
  }
})

test('all lenders together never earn more in a month than the whole pot’s busiest month', () => {
  // The Admin lent its own money in September only; John was busiest in October.
  const both = [...history, { loanId: 'A9', lenderId: 'admin', startOn: day(2026, 9, 10), termDays: 14, earnings: centavos(500_000), adminCut: centavos(0) }]
  const pot = simpleForecast(input({ months: 24, history: both, capitalNow: new Map([['john', centavos(9_000_000)], ['admin', centavos(5_000_000)]]) }), { kind: 'pot' })
  // busiest whole-pot month: October, ₱9,000 + ₱3,000 (September is ₱3,000 + ₱1,000 + ₱5,000)
  assert.ok(pot.months.every((m, i) => i === 0 || m.interest <= 1_200_000 + 1))
  assert.ok(pot.months[23].interest >= 1_200_000 - 1)
})

test('months before lending began are not counted as slow months', () => {
  const late = history.slice(3) // August, September (slow), October (busy) only
  const f = simpleForecast(input({ history: late, firstLoanOn: day(2026, 8, 1), pace: 'slow' }), { kind: 'pot' })
  // (8,000 + 4,000 + 12,000) ÷ 3 = 8,000 a month; the slowest is 4,000
  assert.equal(f.paceFactor, 0.5)
})

test('a book started inside the window averages from its first loan, not over the empty months before it', () => {
  // First loan ever: August. Aug + Sep + Oct earned ₱6,000 + ₱3,000 + ₱9,000 own → ₱6,000 a month, not ₱3,000.
  const late = history.slice(3)
  const f = simpleForecast(input({ history: late, firstLoanOn: day(2026, 8, 1) }), { kind: 'lender', lenderId: 'john' })
  assert.equal(f.historyMonths, 3)
  assert.equal(f.usual, 600_000 + 0) // a lender's view: own earnings only
  // a first loan long ago keeps the full window, gaps counted as months of no lending
  const old = simpleForecast(input({ history: late, firstLoanOn: day(2025, 1, 1) }), { kind: 'lender', lenderId: 'john' })
  assert.equal(old.historyMonths, 6)
  assert.equal(old.usual, 300_000)
})

test('this month’s new loans are not in the average (they are already running); a book that began this month uses them', () => {
  const now = { loanId: 'N', lenderId: 'john', startOn: day(2026, 11, 2), termDays: 28, earnings: centavos(9_000_000), adminCut: centavos(0) }
  const f = simpleForecast(input({ history: [...history, now] }), { kind: 'lender', lenderId: 'john' })
  assert.equal(f.usual, 600_000)
  const fresh = simpleForecast(input({ history: [now], firstLoanOn: now.startOn }), { kind: 'lender', lenderId: 'john' })
  assert.equal(fresh.historyMonths, 0)
  assert.equal(fresh.usual, 9_000_000)
})

test('a first month that began after the 1st is part empty, so the average starts the month after it', () => {
  // First loan 17 August: September and October only, (₱3,000 + ₱9,000) ÷ 2 = ₱6,000.
  const late = [{ ...history[3], startOn: day(2026, 8, 17), termDays: 14, earnings: centavos(100_000) }, ...history.slice(4)]
  const f = simpleForecast(input({ history: late, firstLoanOn: day(2026, 8, 17) }), { kind: 'lender', lenderId: 'john' })
  assert.equal(f.historyMonths, 2)
  assert.equal(f.historyFrom.getMonth(), 8)
  assert.equal(f.usual, 600_000)
  // with no full month after it (first loan in the middle of last month), that month is still used
  const recent = [{ ...history[5], startOn: day(2026, 10, 15), termDays: 14 }]
  assert.equal(simpleForecast(input({ history: recent, firstLoanOn: day(2026, 10, 15) }), { kind: 'lender', lenderId: 'john' }).historyMonths, 1)
})

test('a loan running across two months counts in both, by the days it ran in each', () => {
  // 1 Sep to 30 Oct, 60 days, ₱6,000: ₱3,000 in September, ₱3,000 in October.
  const across = [{ loanId: 'X', lenderId: 'john', startOn: day(2026, 9, 1), termDays: 60, earnings: centavos(600_000), adminCut: centavos(0) }]
  const f = simpleForecast(input({ history: across, firstLoanOn: day(2026, 9, 1) }), { kind: 'lender', lenderId: 'john' })
  assert.equal(f.historyMonths, 2)
  assert.equal(f.usual, 300_000)
})

test('"based on N loans" counts only the loans that earned this view something', () => {
  const both = [...history, { loanId: 'A9', lenderId: 'admin', startOn: day(2026, 9, 10), termDays: 14, earnings: centavos(500_000), adminCut: centavos(0) }]
  const at = (whose: Parameters<typeof simpleForecast>[1]) => simpleForecast(input({ history: both }), whose).basedOnLoans
  assert.equal(at({ kind: 'pot' }), 7)
  assert.equal(at({ kind: 'lender', lenderId: 'john' }), 6)
  assert.equal(at({ kind: 'lender', lenderId: 'admin' }), 7) // its own loan, plus the cut on John's six
})
