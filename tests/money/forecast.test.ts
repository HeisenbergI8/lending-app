import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { type ForecastInput, type Plan, forecastView, reachTarget, simulate } from '../../src/lib/money/forecast.ts'
import { splitLoan } from '../../src/lib/money/split.ts'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const today = day(2026, 11, 8)

const plan = (extra: Partial<Plan> = {}): Plan => ({
  horizonMonths: 12,
  newLoansPerMonth: 0,
  loanAmount: centavos(1_000_000),
  termWeeks: 4,
  borrowerRateBps: 700,
  adminCutBps: 200,
  collection: 'AT_END',
  relend: false,
  moves: [],
  ...extra,
})

const input = (extra: Partial<ForecastInput> = {}): ForecastInput => ({
  today,
  plan: plan(),
  lenders: [
    { id: 'admin', isSelf: true, floatingNow: centavos(0) },
    { id: 'john', isSelf: false, floatingNow: centavos(10_000_000) },
  ],
  realRows: [],
  shares: [{ lenderId: 'john', weight: centavos(3) }, { lenderId: 'admin', weight: centavos(1) }],
  habits: new Map(), // every lender on DEFAULT_RELEND unless a test says otherwise
  ...extra,
})

const real = {
  lenderId: 'john',
  interestCollection: 'AT_END' as const,
  startOn: day(2026, 11, 1),
  dueOn: day(2026, 11, 29),
  termDays: 28,
  principal: centavos(3_000_000),
  earnings: centavos(600_000),
  adminCut: centavos(240_000),
  paidWeeks: new Set<number>(),
}

test('real loans only: the pot view adds up to the stored earnings plus the cut, in the due month', () => {
  const sim = simulate(input({ realRows: [real] }), { kind: 'best' })
  const pot = forecastView(sim, { kind: 'pot' })
  assert.equal(pot[0].interest, 840_000)
  assert.equal(pot.at(-1)?.interestToDate, 840_000)
  assert.equal(forecastView(sim, { kind: 'admin-cut' })[0].interest, 240_000)
  assert.equal(forecastView(sim, { kind: 'lender', lenderId: 'john' })[0].interest, 600_000)
})

test('money already late is left out of the lines and reported apart', () => {
  const late = { ...real, dueOn: day(2026, 11, 1) }
  const sim = simulate(input({ realRows: [late] }), { kind: 'best' })
  assert.equal(sim.lateNow, 3_840_000)
  assert.equal(forecastView(sim, { kind: 'pot' }).at(-1)?.interestToDate, 0)
})

test('a pretend loan earns exactly what splitLoan says, split by the 6-month shares', () => {
  const sim = simulate(input({ plan: plan({ newLoansPerMonth: 1, horizonMonths: 3 }) }), { kind: 'best' })
  // made 1 Dec, due 29 Dec: ₱7,500 John at 5%, ₱2,500 Admin at 7%, 4 weeks
  const expected = splitLoan({
    capital: centavos(1_000_000), borrowerRateBps: 700, weeks: 4,
    fundings: [
      { lenderId: 'john', principal: centavos(750_000), lenderRateBps: 500, adminCutBps: 200 },
      { lenderId: 'admin', principal: centavos(250_000), lenderRateBps: 700, adminCutBps: 0 },
    ],
  })
  assert.ok(expected.ok)
  assert.equal(forecastView(sim, { kind: 'pot' })[1].interest, expected.value.totalInterest)
})

test('reconciliation: realistic moves money later but never loses a centavo', () => {
  const i = input({ realRows: [real] })
  const best = forecastView(simulate(i, { kind: 'best' }), { kind: 'pot' })
  const late = forecastView(simulate(i, { kind: 'realistic', onTimeBps: 7_333, lateDelayDays: 10 }), { kind: 'pot' })
  assert.ok(late[0].interest < best[0].interest) // part of 29 Nov slips to 9 Dec
  assert.equal(late.at(-1)?.interestToDate, best.at(-1)?.interestToDate) // but all of it lands
})

test('reconciliation: with no delay the realistic line IS the best case, pretend loans included', () => {
  const i = input({ realRows: [real], plan: plan({ newLoansPerMonth: 3, relend: true, horizonMonths: 24 }) })
  const best = forecastView(simulate(i, { kind: 'best' }), { kind: 'pot' })
  const same = forecastView(simulate(i, { kind: 'realistic', onTimeBps: 6_123, lateDelayDays: 0 }), { kind: 'pot' })
  assert.deepEqual(same.map((m) => m.interest), best.map((m) => m.interest))
})

test('a lender short of cash for their share is warned in that month, and the loan is still projected', () => {
  const poor = input({
    lenders: [{ id: 'admin', isSelf: true, floatingNow: centavos(0) }, { id: 'john', isSelf: false, floatingNow: centavos(0) }],
    // 8 weeks, so the loan made on 1 Dec is still out at the end of December.
    plan: plan({ newLoansPerMonth: 1, horizonMonths: 3, termWeeks: 8 }),
  })
  const sim = simulate(poor, { kind: 'best' })
  assert.deepEqual(sim.months[1].warnings.map((w) => [w.lenderId, w.cause]).sort(), [['admin', 'loans'], ['john', 'loans']])
  assert.ok(forecastView(sim, { kind: 'pot' })[2].interest > 0)
  assert.ok((sim.months[1].byLender.get('john')?.cash as number) < 0)
})

// John re-lends half of what comes back, a month later; the Admin has no history (default 100%, 1 month).
const habits = new Map([['john', { shareBps: 5_000, lagMonths: 1, basis: 'history' as const, returnMonths: 3 }]])

test('re-lending follows each lender\'s own habit', () => {
  const sim = simulate(input({ realRows: [real], habits, plan: plan({ relend: true }) }), { kind: 'best' })
  // 29 Nov: John gets ₱36,000 back, the Admin its ₱2,400 cut. Re-lent on 1 Dec:
  assert.equal(sim.months[1].byLender.get('john')?.lent, 1_800_000) // half
  assert.equal(sim.months[1].byLender.get('admin')?.lent, 240_000) // all of it, by default
  assert.equal(sim.months[1].relent, 2_040_000)
})

test('one lender short of cash does not stop another re-lending', () => {
  const moves = [{ lenderId: 'admin', type: 'WITHDRAWAL' as const, amount: centavos(240_000), fromMonth: day(2026, 12, 1), everyMonth: false, untilMonth: null }]
  const sim = simulate(input({ realRows: [real], habits, plan: plan({ relend: true, moves }) }), { kind: 'best' })
  assert.equal(sim.months[1].byLender.get('admin')?.lent, 0) // took it out instead
  assert.equal(sim.months[1].byLender.get('john')?.lent, 1_800_000) // unaffected
})

test('re-lending never creates a warning by itself, and never goes below a lender\'s cash', () => {
  const sim = simulate(input({ realRows: [real], habits, plan: plan({ relend: true, horizonMonths: 24 }) }), { kind: 'best' })
  assert.ok(sim.months.every((m) => m.warnings.length === 0))
  assert.ok(sim.months.every((m) => [...m.byLender.values()].every((r) => r.cash >= 0)))
  assert.ok(sim.months.some((m) => m.relent > 0))
})

test('re-lend off: returned money sits as cash', () => {
  const sim = simulate(input({ realRows: [real] }), { kind: 'best' })
  assert.equal(sim.months[1].byLender.get('john')?.cash, 10_000_000 + 3_600_000)
  assert.equal(sim.months[1].byLender.get('admin')?.cash, 240_000)
})

test('planned moves: monthly deposits add up; an over-withdrawal warns', () => {
  const moves = [
    { lenderId: 'john', type: 'DEPOSIT' as const, amount: centavos(1_000_000), fromMonth: day(2026, 12, 1), everyMonth: true, untilMonth: day(2027, 2, 1) },
    { lenderId: 'admin', type: 'WITHDRAWAL' as const, amount: centavos(500), fromMonth: day(2027, 3, 1), everyMonth: false, untilMonth: null },
  ]
  const sim = simulate(input({ plan: plan({ moves }) }), { kind: 'best' })
  assert.equal(sim.months[4].byLender.get('john')?.cash, 10_000_000 + 3 * 1_000_000)
  assert.equal(sim.months[4].warnings[0]?.cause, 'withdrawal')
})

test('no history to split by: pretend loans are refused, real loans still projected', () => {
  const sim = simulate(input({ shares: [], realRows: [real], plan: plan({ newLoansPerMonth: 1 }) }), { kind: 'best' })
  assert.match(sim.refused ?? '', /nothing to split/)
  assert.equal(forecastView(sim, { kind: 'pot' })[0].interest, 840_000)
})

test('reachTarget on interest: the first month the running total gets there, or null', () => {
  const pot = forecastView(simulate(input({ realRows: [real] }), { kind: 'best' }), { kind: 'pot' })
  assert.equal(reachTarget(pot, centavos(840_000), 'interest')?.key, '2026-11')
  assert.equal(reachTarget(pot, centavos(840_001), 'interest'), null)
})

test('reachTarget on pot size: cash + capital out, never on the Admin-cut view', () => {
  const sim = simulate(input({ realRows: [real] }), { kind: 'best' })
  const pot = forecastView(sim, { kind: 'pot' })
  // John ₱100,000 + ₱36,000 back, Admin ₱2,400: ₱138,400 at the end of November
  assert.equal(pot[0].potSize, 13_840_000)
  assert.equal(reachTarget(pot, centavos(13_840_000), 'pot')?.key, '2026-11')
  assert.equal(reachTarget(forecastView(sim, { kind: 'admin-cut' }), centavos(1), 'pot'), null)
})
