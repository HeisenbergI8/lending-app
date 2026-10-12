import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { type MoneyEvent } from '../../src/lib/money/money-history.ts'
import {
  HISTORY_FILTERS,
  capitalRefusal,
  filterHistory,
  parseHistoryFilter,
  startingCapital,
} from '../../src/lib/money/starting-capital.ts'

describe('startingCapital', () => {
  test('is the opening figure when nothing has been added', () => {
    assert.equal(startingCapital(80_000_00, []), 80_000_00)
  })

  test('adds top-ups and takes off reductions', () => {
    const total = startingCapital(80_000_00, [
      { type: 'DEPOSIT', amount: 20_000_00, capital: true },
      { type: 'WITHDRAWAL', amount: 5_000_00, capital: true },
    ])
    assert.equal(total, 95_000_00)
  })

  test('ignores ordinary deposits and withdrawals', () => {
    const total = startingCapital(10_000_00, [
      { type: 'DEPOSIT', amount: 99_000_00, capital: false },
      { type: 'WITHDRAWAL', amount: 1_000_00, capital: false },
    ])
    assert.equal(total, 10_000_00)
  })

  test('works from a zero opening figure', () => {
    assert.equal(startingCapital(0, [{ type: 'DEPOSIT', amount: 500_00, capital: true }]), 500_00)
  })
})

describe('capitalRefusal', () => {
  test('allows zero and above', () => {
    assert.equal(capitalRefusal(0), null)
    assert.equal(capitalRefusal(1), null)
  })

  test('refuses below zero, with a sentence', () => {
    assert.match(capitalRefusal(-1) ?? '', /below zero/)
  })
})

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
