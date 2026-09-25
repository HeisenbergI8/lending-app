import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { NO_FILTER, parseLoanFilter } from '../../src/lib/loan-filter.ts'
import { loanWhere } from '../../src/server/loans/queries.ts'
import { addDays, calendarDate } from '../../src/lib/money/weeks.ts'

/**
 * What a search turns into before it reaches the database.
 *
 * The clause is checked rather than the rows, because the rules worth protecting
 * are in the translation: overdue is not a column, an account filter must never
 * be droppable, and two date bounds have to agree rather than overwrite each
 * other. A test that needed Postgres could not run in the same breath as the
 * rest of these.
 */

const today = calendarDate(new Date())
const where = (params: Record<string, string> = {}) => loanWhere('user-1', parseLoanFilter(params))

describe('loanWhere — a search as a query', () => {
  test('always scopes to the account and hides deleted loans', () => {
    const cases: Record<string, string>[] = [{}, { q: 'angel' }, { status: 'paid' }, { from: '2026-01-01' }]
    for (const params of cases) {
      const clause = where(params)
      assert.equal(clause.userId, 'user-1')
      assert.equal(clause.deletedAt, null)
    }
  })

  test('an empty search asks for nothing else', () => {
    assert.deepEqual(loanWhere('user-1', NO_FILTER), { userId: 'user-1', deletedAt: null })
  })

  test('paid is the stored status', () => {
    assert.equal(where({ status: 'paid' }).status, 'PAID')
  })

  // Overdue is not a column and never will be: it is a fact about today.
  //
  // It reads nextDueOn rather than dueOn, and the two are the same column's
  // worth of meaning on every loan that collects its interest at the end. On a
  // weekly loan nextDueOn is the earliest unpaid WEEK, which is what makes a
  // loan three weeks behind read as overdue although its capital is due in
  // February.
  test('overdue is active with money owed before today', () => {
    const clause = where({ status: 'overdue' })
    assert.equal(clause.status, 'ACTIVE')
    assert.deepEqual(clause.nextDueOn, { lt: today })
    // The capital date is NOT constrained by a status filter.
    assert.equal(clause.dueOn, undefined)
  })

  test('active is running with nothing owed yet', () => {
    const clause = where({ status: 'active' })
    assert.equal(clause.status, 'ACTIVE')
    assert.deepEqual(clause.nextDueOn, { gte: today })
    assert.equal(clause.dueOn, undefined)
  })

  test('a due-date range becomes both bounds', () => {
    assert.deepEqual(where({ from: '2026-01-01', to: '2026-03-31' }).dueOn, {
      gte: calendarDate(new Date(2026, 0, 1)),
      lte: calendarDate(new Date(2026, 2, 31)),
    })
  })

  // Both bounds still have to hold at once. They are now separate keys on the
  // same `where` rather than one column tightened against itself, and on every
  // loan collected at the end — where nextDueOn IS dueOn — that selects exactly
  // the same loans:
  //
  //   from in the past    dueOn >= past  AND dueOn >= today  ==  dueOn >= today
  //   from in the future  dueOn >= future AND dueOn >= today ==  dueOn >= future
  //
  // which is what the single tightened bound used to say. What it no longer
  // does is answer "due in October" with a weekly loan whose capital is due in
  // January, and that is the point of the split.
  test('active plus a range keeps both bounds, on their own columns', () => {
    const future = addDays(today, 30)
    const past = addDays(today, -30)
    const iso = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

    const fromFuture = where({ status: 'active', from: iso(future) })
    assert.deepEqual(fromFuture.dueOn, { gte: future })
    assert.deepEqual(fromFuture.nextDueOn, { gte: today })

    const fromPast = where({ status: 'active', from: iso(past) })
    assert.deepEqual(fromPast.dueOn, { gte: past })
    assert.deepEqual(fromPast.nextDueOn, { gte: today })
  })

  // A date range means the CAPITAL date, always. It is the date the Admin typed
  // and the one the borrower agreed to, and it does not move when a week is
  // collected.
  test('a date range on its own never touches the next owed date', () => {
    const clause = where({ from: '2026-01-01', to: '2026-03-31' })
    assert.equal(clause.nextDueOn, undefined)
  })

  test('an amount matches either the capital or the total', () => {
    assert.deepEqual(where({ q: '30,000' }).OR, [
      { capitalCentavos: 3_000_000 },
      { totalCentavos: 3_000_000 },
    ])
  })

  test('a name searches borrowers and funders, case-insensitively', () => {
    const clause = where({ q: 'angel' })
    assert.equal(clause.OR, undefined)
    assert.equal(clause.AND?.length, 1)
    assert.deepEqual(clause.AND?.[0].OR, [
      { borrower: { firstName: { contains: 'angel', mode: 'insensitive' } } },
      { borrower: { lastName: { contains: 'angel', mode: 'insensitive' } } },
      { fundings: { some: { lender: { firstName: { contains: 'angel', mode: 'insensitive' } } } } },
      { fundings: { some: { lender: { lastName: { contains: 'angel', mode: 'insensitive' } } } } },
    ])
  })

  // AND of ORs, so "Angel Cruz" is one person rather than everyone called either.
  test('every word in a name has to match something', () => {
    assert.equal(where({ q: 'Angel Cruz' }).AND?.length, 2)
  })
})
