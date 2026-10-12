import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { type MoneyEvent } from '../../src/lib/money/money-history.ts'
import {
  HISTORY_FILTERS,
  filterHistory,
  parseHistoryFilter,
} from '../../src/lib/money/history-filter.ts'

describe('money history filter', () => {
  const kinds: MoneyEvent['kind'][] = ['deposit', 'withdrawal', 'lent', 'interest', 'repaid', 'cut']
  const events = kinds.map((kind) => ({ kind }))

  test('every kind of line belongs to exactly one filter, so nothing is hidden from all of them', () => {
    for (const kind of kinds) {
      const homes = HISTORY_FILTERS.filter((filter) => (filter.kinds as readonly string[]).includes(kind))
      assert.equal(homes.length, 1, kind)
    }
  })

  test('All shows everything', () => {
    assert.equal(filterHistory(events, null).length, kinds.length)
  })

  test('each filter shows only its own lines', () => {
    assert.deepEqual(filterHistory(events, 'in').map((e) => e.kind), ['deposit'])
    assert.deepEqual(filterHistory(events, 'withdrawals').map((e) => e.kind), ['withdrawal'])
    assert.deepEqual(filterHistory(events, 'lent').map((e) => e.kind), ['lent'])
    assert.deepEqual(filterHistory(events, 'back').map((e) => e.kind), ['interest', 'repaid', 'cut'])
  })

  test('an unknown filter in the URL reads as All', () => {
    assert.equal(parseHistoryFilter('nonsense'), null)
    assert.equal(parseHistoryFilter(undefined), null)
    assert.equal(parseHistoryFilter('lent'), 'lent')
  })
})
