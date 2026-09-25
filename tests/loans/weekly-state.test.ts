import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { loanState } from '../../src/lib/loan-state.ts'
import { trackRecord } from '../../src/lib/track-record.ts'
import { nextUnpaidWeek } from '../../src/lib/money/weekly.ts'

/**
 * A weekly loan is late on a missed WEEK, not on the day the capital is due.
 *
 * This is the rule the whole feature turns on, and it is the one place where
 * getting it wrong is invisible: every call site compiled fine while reading
 * the capital date, and a loan three weeks behind simply read as Active for
 * four months. So it is tested against both dates at once — the assertion that
 * matters is the pair, not either half.
 */

describe('a weekly loan is late on a missed week, not on the capital date', () => {
  // 20 weeks from 5 September 2026. The capital comes back on 23 January 2027.
  const start = new Date(2026, 8, 5, 12)
  const capitalDue = new Date(2027, 0, 23, 12)
  // Today is 30 September. Weeks 1, 2 and 3 fell on the 12th, 19th and 26th.
  const today = new Date(2026, 8, 30, 12)

  test('every week paid so far: the loan is running, not late', () => {
    const next = nextUnpaidWeek(start, 20, new Set([1, 2, 3]))
    assert.ok(next)
    assert.equal(next.week, 4)
    assert.equal(loanState('ACTIVE', next.dueOn, today), 'due-soon') // week 4, 3 Oct
  })

  test('week 3 missed: the loan is OVERDUE although the capital is months away', () => {
    const next = nextUnpaidWeek(start, 20, new Set([1, 2]))
    assert.ok(next)
    assert.equal(loanState('ACTIVE', next.dueOn, today), 'overdue')
    // The point of the test: read against the capital date it looks fine.
    assert.equal(loanState('ACTIVE', capitalDue, today), 'active')
  })

  test('the EARLIEST missed week is the one chased, not the most recent', () => {
    // Week 2 missed, week 3 paid. Two weeks behind is chased from week 2.
    const next = nextUnpaidWeek(start, 20, new Set([1, 3]))
    assert.ok(next)
    assert.equal(next.week, 2)
    assert.equal(loanState('ACTIVE', next.dueOn, today), 'overdue')
  })

  test('the loan returns to Active once every due week is paid', () => {
    const next = nextUnpaidWeek(start, 20, new Set([1, 2, 3, 4]))
    assert.ok(next)
    assert.equal(loanState('ACTIVE', next.dueOn, today), 'active') // week 5, 10 Oct
  })

  test('the borrower is counted overdue on the missed week', () => {
    const missed = nextUnpaidWeek(start, 20, new Set([1, 2]))
    assert.ok(missed)
    const record = trackRecord([{ status: 'ACTIVE', dueOn: missed.dueOn, paidOn: null }], today)
    assert.equal(record.overdue, 1)
    assert.equal(record.active, 1)
  })

  test('read against the capital date the same borrower looks perfectly current', () => {
    // Left in deliberately. This is the answer the app gave before the feature,
    // and the reason every loanState call site had to be moved rather than left
    // to compile quietly against the wrong column.
    const record = trackRecord([{ status: 'ACTIVE', dueOn: capitalDue, paidOn: null }], today)
    assert.equal(record.overdue, 0)
  })

  test('a settled weekly loan is judged on time against its CAPITAL date', () => {
    // markPaid puts nextDueOn back to the loan's own due date when it settles,
    // so "paid late" still compares the repayment against the day the capital
    // was actually due rather than against some week in September.
    const onTime = trackRecord(
      [{ status: 'PAID', dueOn: capitalDue, paidOn: new Date(2027, 0, 23, 12) }],
      today,
    )
    assert.equal(onTime.paidOnTime, 1)
    assert.equal(onTime.paidLate, 0)

    const late = trackRecord(
      [{ status: 'PAID', dueOn: capitalDue, paidOn: new Date(2027, 0, 30, 12) }],
      today,
    )
    assert.equal(late.paidLate, 1)
  })
})
