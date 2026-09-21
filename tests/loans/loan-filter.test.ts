import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isFiltered, loanFilterHref, parseLoanFilter } from '../../src/lib/loan-filter.ts'
import { calendarDate } from '../../src/lib/money/weeks.ts'

const date = (y: number, m: number, d: number) => calendarDate(new Date(y, m - 1, d))

describe('parseLoanFilter — reading a search out of the URL', () => {
  test('an empty query string is not a search', () => {
    const filter = parseLoanFilter({})
    assert.equal(isFiltered(filter), false)
    assert.deepEqual(filter.terms, [])
    assert.equal(filter.amount, null)
    assert.equal(filter.status, null)
  })

  test('a name splits into words, so every word has to match', () => {
    assert.deepEqual(parseLoanFilter({ q: 'Angel  Cruz' }).terms, ['Angel', 'Cruz'])
  })

  // "30000" means the ₱30,000 loan. Nobody is called 30000, and searching names
  // for it would return an empty list while the loan sits right there.
  test('a query that is money searches the amount instead of names', () => {
    const filter = parseLoanFilter({ q: '30,000' })
    assert.equal(filter.amount, 3_000_000)
    assert.deepEqual(filter.terms, [])
  })

  test('a name containing digits is still a name', () => {
    const filter = parseLoanFilter({ q: 'John 2' })
    assert.equal(filter.amount, null)
    assert.deepEqual(filter.terms, ['John', '2'])
  })

  test('reads a due-date range', () => {
    const filter = parseLoanFilter({ from: '2026-01-01', to: '2026-03-31' })
    assert.deepEqual(filter.from, date(2026, 1, 1))
    assert.deepEqual(filter.to, date(2026, 3, 31))
    assert.equal(isFiltered(filter), true)
  })

  // Someone who fills the boxes in the order they read them means the same range.
  test('a range typed backwards is turned the right way round', () => {
    const filter = parseLoanFilter({ from: '2026-03-31', to: '2026-01-01' })
    assert.deepEqual(filter.from, date(2026, 1, 1))
    assert.deepEqual(filter.to, date(2026, 3, 31))
  })

  test('keeps the three real statuses and drops anything else', () => {
    assert.equal(parseLoanFilter({ status: 'overdue' }).status, 'overdue')
    assert.equal(parseLoanFilter({ status: 'active' }).status, 'active')
    assert.equal(parseLoanFilter({ status: 'paid' }).status, 'paid')
    assert.equal(parseLoanFilter({ status: 'ACTIVE' }).status, null)
    assert.equal(parseLoanFilter({ status: 'deleted' }).status, null)
  })

  // A hand-edited or stale link should show the list, not an error page.
  test('unreadable values are ignored rather than refused', () => {
    const filter = parseLoanFilter({ from: '2026-02-31', to: 'soon' })
    assert.equal(filter.from, null)
    assert.equal(filter.to, null)
  })

  test('takes the first value when a key is repeated', () => {
    assert.deepEqual(parseLoanFilter({ q: ['Angel', 'Cruz'] }).terms, ['Angel'])
  })

  test('caps the query so a huge URL cannot become a huge LIKE', () => {
    assert.equal(parseLoanFilter({ q: 'a'.repeat(500) }).query.length, 80)
  })
})

describe('loanFilterHref — changing one part and keeping the rest', () => {
  test('carries the other fields along', () => {
    const filter = parseLoanFilter({ q: 'Angel', from: '2026-01-01' })
    assert.equal(loanFilterHref(filter, { status: 'paid' }), '/loans?q=Angel&from=2026-01-01&status=paid')
  })

  test('clearing the last field gives the bare route', () => {
    const filter = parseLoanFilter({ status: 'overdue' })
    assert.equal(loanFilterHref(filter, { status: null }), '/loans')
  })

  test('the href it builds parses back to the same filter', () => {
    const filter = parseLoanFilter({ q: 'Angel Cruz', from: '2026-01-01', to: '2026-03-31', status: 'active' })
    const query = loanFilterHref(filter).split('?')[1]
    const params = Object.fromEntries(new URLSearchParams(query))
    assert.deepEqual(parseLoanFilter(params), filter)
  })
})
