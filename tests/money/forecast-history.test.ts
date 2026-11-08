import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import {
  type HistoryLoan,
  autoPlan,
  capitalShares,
  dueRecords,
  historyDefaults,
  lateDelayDays,
  onTimeRate,
  relendHabits,
  returnEvents,
} from '../../src/lib/money/forecast-history.ts'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const today = day(2026, 11, 8) // window starts 1 May 2026

test('capitalShares: only the window, only current lenders, summed per lender', () => {
  const rows = [
    { lenderId: 'a', principal: centavos(100), startOn: day(2026, 5, 1) },
    { lenderId: 'a', principal: centavos(50), startOn: day(2026, 10, 1) },
    { lenderId: 'b', principal: centavos(300), startOn: day(2026, 4, 30) }, // before window
    { lenderId: 'gone', principal: centavos(999), startOn: day(2026, 9, 1) }, // deleted lender
  ]
  assert.deepEqual(capitalShares(rows, today, new Set(['a', 'b'])), [{ lenderId: 'a', weight: 150 }])
})

const loan = (extra: Partial<HistoryLoan>): HistoryLoan => ({
  interestCollection: 'AT_END',
  startOn: day(2026, 9, 1),
  dueOn: day(2026, 9, 29),
  termDays: 28,
  settledOn: null,
  weekPaidOn: new Map(),
  closedByExtension: false,
  ...extra,
})

test('on the due day is on time; the day after is not; unpaid and past due is not', () => {
  const records = [
    ...dueRecords(loan({ settledOn: day(2026, 9, 29) })),
    ...dueRecords(loan({ settledOn: day(2026, 9, 30) })),
    ...dueRecords(loan({})),
  ]
  const r = onTimeRate(records, today)
  assert.equal(r.counted, 3)
  assert.equal(r.onTime, 1)
  assert.equal(r.bps, 3_333)
})

test('an extended loan is on time when paid by its EXTENDED due date (owner, 2026-11-08)', () => {
  // 4 weeks + another 4: dueOn has moved from 29 Sep to 27 Oct; paid 27 Oct.
  const extended = loan({ dueOn: day(2026, 10, 27), termDays: 56, settledOn: day(2026, 10, 27) })
  assert.equal(onTimeRate(dueRecords(extended), today).onTime, 1)
})

test('a loan closed by an extension is not counted at all', () => {
  assert.deepEqual(dueRecords(loan({ closedByExtension: true })), [])
})

test('a weekly loan counts every week, the last on the settling payment', () => {
  const weekly = loan({
    interestCollection: 'WEEKLY',
    weekPaidOn: new Map([[1, day(2026, 9, 8)], [2, day(2026, 9, 16)], [3, day(2026, 9, 22)]]),
    settledOn: day(2026, 9, 29),
  })
  const r = onTimeRate(dueRecords(weekly), today)
  assert.equal(r.counted, 4)
  assert.equal(r.onTime, 3) // week 2 was due 15 Sep, paid 16 Sep
})

test('due today is not counted yet, and nothing due gives a null rate', () => {
  assert.equal(onTimeRate([{ dueOn: today, paidOn: null }], today).bps, null)
})

test('lateDelayDays is the median lateness of late PAID amounts', () => {
  const recs = [
    { dueOn: day(2026, 9, 1), paidOn: day(2026, 9, 3) },
    { dueOn: day(2026, 9, 1), paidOn: day(2026, 9, 11) },
    { dueOn: day(2026, 9, 1), paidOn: day(2026, 9, 6) },
    { dueOn: day(2026, 9, 1), paidOn: null },
  ]
  assert.equal(lateDelayDays(recs, today), 5)
  assert.equal(lateDelayDays([], today), null)
})

test('historyDefaults takes the most common rate, ignores FIXED_AMOUNT, and falls back', () => {
  const l = (startOn: Date, rate: number | null, basis: 'WEEKLY_RATE' | 'FIXED_AMOUNT' = 'WEEKLY_RATE') => ({
    startOn, interestBasis: basis, interestCollection: 'WEEKLY' as const, borrowerRateBps: rate, cutBps: rate ? [200] : [],
  })
  const d = historyDefaults(
    [l(day(2026, 6, 1), 700), l(day(2026, 7, 1), 700), l(day(2026, 8, 1), 600), l(day(2026, 9, 1), null, 'FIXED_AMOUNT')],
    today,
    { borrowerRateBps: 700, adminCutBps: 200 },
  )
  assert.equal(d.borrowerRateBps, 700)
  assert.equal(d.collection, 'WEEKLY')
  assert.equal(d.basedOn, 3)
  assert.equal(historyDefaults([], today, { borrowerRateBps: 700, adminCutBps: 200 }).basedOn, 0)
})

test('returnEvents: a settled loan hands back capital + earnings to the funder and the cut to the Admin', () => {
  const row = {
    lenderId: 'john', interestCollection: 'AT_END' as const, startOn: day(2026, 9, 1), dueOn: day(2026, 9, 29),
    termDays: 28, principal: centavos(3_000_000), earnings: centavos(600_000), adminCut: centavos(240_000), paidWeeks: new Set<number>(),
  }
  const events = returnEvents({ rows: [row], payments: [{ weekNumber: null, paidOn: day(2026, 9, 29) }], closedByExtension: false }, 'admin')
  assert.deepEqual(events.map((e) => [e.lenderId, e.amount]), [['john', 3_600_000], ['admin', 240_000]])
  const closed = returnEvents({ rows: [row], payments: [{ weekNumber: null, paidOn: day(2026, 9, 29) }], closedByExtension: true }, 'admin')
  assert.equal(closed[0].amount, 600_000) // interest only: the capital carried on
})

test('relendHabits: share and lag from a lender\'s own history', () => {
  const r = (m: number, amount: number) => ({ lenderId: 'a', on: day(2026, m, 10), amount: centavos(amount) })
  const l = (m: number, principal: number) => ({ lenderId: 'a', on: day(2026, m, 1), principal: centavos(principal) })
  const h = relendHabits([r(6, 100_000), r(8, 100_000)], [l(7, 50_000), l(9, 50_000)], today, ['a']).get('a')
  assert.deepEqual(h, { shareBps: 5_000, lagMonths: 1, basis: 'history', returnMonths: 2 })
})

test('relendHabits: thin history falls back to the labelled default; never re-lending is share 0', () => {
  const r = (m: number) => ({ lenderId: 'a', on: day(2026, m, 10), amount: centavos(100_000) })
  assert.equal(relendHabits([r(6)], [], today, ['a']).get('a')?.basis, 'default')
  assert.equal(relendHabits([r(6), r(8)], [], today, ['a']).get('a')?.shareBps, 0)
})

test('autoPlan: carries on the last 6 months of new lending, ignoring continuations and older loans', () => {
  const l = (m: number, pesos: number, weeks = 4, continuation = false) => ({
    startOn: day(2026, m, 5), capital: centavos(pesos * 100), termDays: weeks * 7, continuation,
  })
  const plan = autoPlan(
    [l(5, 10_000), l(6, 12_000), l(7, 9_000, 8), l(8, 11_000), l(9, 10_400), l(10, 10_000), l(10, 15_000, 4, true), l(3, 99_000)],
    today,
  )
  // 6 new loans in the window: 1 a month, average ₱10,400 -> ₱10,000, mostly 4 weeks
  assert.deepEqual(plan, { newLoansPerMonth: 1, loanAmount: 1_000_000, termWeeks: 4, basedOn: 6 })
  assert.equal(autoPlan([l(9, 5_000)], today).newLoansPerMonth, 1) // a light lender is not "none"
  assert.equal(autoPlan([], today).newLoansPerMonth, 0)
})
