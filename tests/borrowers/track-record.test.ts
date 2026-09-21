import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { describeTrackRecord, trackRecord } from '../../src/lib/track-record.ts'

const TODAY = new Date(2026, 8, 21) // 21 September 2026
const day = (n: number) => new Date(2026, 8, 21 + n)

describe('counting a borrower’s history', () => {
  test('no loans reads as no loans, not as a perfect record', () => {
    const record = trackRecord([], TODAY)
    assert.equal(record.total, 0)
    assert.equal(describeTrackRecord(record), 'No loans yet')
  })

  test('the spec’s example line', () => {
    const loans = Array.from({ length: 5 }, () => ({
      status: 'PAID' as const,
      dueOn: day(-30),
      paidOn: day(-30),
    }))
    assert.equal(describeTrackRecord(trackRecord(loans, TODAY)), '5 loans · 5 paid on time · 0 late')
  })

  test('one loan is not pluralised', () => {
    const record = trackRecord([{ status: 'PAID', dueOn: day(-10), paidOn: day(-10) }], TODAY)
    assert.equal(describeTrackRecord(record), '1 loan · 1 paid on time · 0 late')
  })
})

describe('on time and late', () => {
  test('paying ON the due date is on time — late starts the day after', () => {
    const record = trackRecord([{ status: 'PAID', dueOn: day(-10), paidOn: day(-10) }], TODAY)
    assert.equal(record.paidOnTime, 1)
    assert.equal(record.paidLate, 0)
  })

  test('a day past due is late', () => {
    const record = trackRecord([{ status: 'PAID', dueOn: day(-10), paidOn: day(-9) }], TODAY)
    assert.equal(record.paidLate, 1)
    assert.equal(record.paidOnTime, 0)
  })

  test('paying early is on time', () => {
    const record = trackRecord([{ status: 'PAID', dueOn: day(-10), paidOn: day(-20) }], TODAY)
    assert.equal(record.paidOnTime, 1)
  })

  test('the time of day never tips a payment into lateness', () => {
    const record = trackRecord(
      [{ status: 'PAID', dueOn: new Date(2026, 8, 11, 0, 1), paidOn: new Date(2026, 8, 11, 23, 59) }],
      TODAY,
    )
    assert.equal(record.paidOnTime, 1)
  })

  test('a paid loan with no recorded date counts as on time, never as late', () => {
    // The admin marked it paid and there is no evidence of lateness. Inventing
    // one would put a black mark on someone’s record out of nothing.
    const record = trackRecord([{ status: 'PAID', dueOn: day(-10), paidOn: null }], TODAY)
    assert.equal(record.paidOnTime, 1)
    assert.equal(record.paidLate, 0)
  })

  test('paid always equals on time plus late', () => {
    const record = trackRecord(
      [
        { status: 'PAID', dueOn: day(-30), paidOn: day(-30) },
        { status: 'PAID', dueOn: day(-20), paidOn: day(-10) },
        { status: 'PAID', dueOn: day(-15), paidOn: null },
        { status: 'ACTIVE', dueOn: day(5), paidOn: null },
      ],
      TODAY,
    )
    assert.equal(record.paid, record.paidOnTime + record.paidLate)
    assert.equal(record.paid, 3)
  })
})

describe('overdue is a fact about today', () => {
  test('an active loan past its due date is overdue', () => {
    const record = trackRecord([{ status: 'ACTIVE', dueOn: day(-1), paidOn: null }], TODAY)
    assert.equal(record.active, 1)
    assert.equal(record.overdue, 1)
  })

  test('a loan due today is not yet overdue', () => {
    const record = trackRecord([{ status: 'ACTIVE', dueOn: day(0), paidOn: null }], TODAY)
    assert.equal(record.overdue, 0)
  })

  test('the same loans read differently a week later — nothing was rewritten', () => {
    const loans = [{ status: 'ACTIVE' as const, dueOn: day(3), paidOn: null }]
    assert.equal(trackRecord(loans, TODAY).overdue, 0)
    assert.equal(trackRecord(loans, day(10)).overdue, 1)
  })

  test('a paid loan is never overdue, however late it was', () => {
    const record = trackRecord([{ status: 'PAID', dueOn: day(-100), paidOn: day(-1) }], TODAY)
    assert.equal(record.overdue, 0)
    assert.equal(record.active, 0)
  })
})

describe('several loans at once', () => {
  test('a borrower can hold more than one active loan', () => {
    const record = trackRecord(
      [
        { status: 'ACTIVE', dueOn: day(7), paidOn: null },
        { status: 'ACTIVE', dueOn: day(-2), paidOn: null },
        { status: 'PAID', dueOn: day(-40), paidOn: day(-38) },
      ],
      TODAY,
    )
    assert.deepEqual(record, { total: 3, paid: 1, paidOnTime: 0, paidLate: 1, active: 2, overdue: 1 })
  })
})
