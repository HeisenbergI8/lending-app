import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { loanState } from '../../src/lib/loan-state.ts'

const TODAY = new Date(2026, 8, 21) // 21 September 2026
const dayOffset = (n: number) => new Date(2026, 8, 21 + n)

describe('loan state is derived, never stored', () => {
  test('a paid loan is paid regardless of its due date', () => {
    assert.equal(loanState('PAID', dayOffset(-100), TODAY), 'paid')
    assert.equal(loanState('PAID', dayOffset(100), TODAY), 'paid')
  })

  test('past due and unpaid is overdue', () => {
    assert.equal(loanState('ACTIVE', dayOffset(-1), TODAY), 'overdue')
    assert.equal(loanState('ACTIVE', dayOffset(-30), TODAY), 'overdue')
  })

  test('due today is its own state, not overdue', () => {
    assert.equal(loanState('ACTIVE', dayOffset(0), TODAY), 'due-today')
  })

  test('within three days is due soon', () => {
    for (const days of [1, 2, 3]) {
      assert.equal(loanState('ACTIVE', dayOffset(days), TODAY), 'due-soon')
    }
  })

  test('beyond three days is just active', () => {
    assert.equal(loanState('ACTIVE', dayOffset(4), TODAY), 'active')
    assert.equal(loanState('ACTIVE', dayOffset(60), TODAY), 'active')
  })
})

describe('the time of day never shifts the state', () => {
  // A loan due today must read "due today" whether it is checked at breakfast or
  // at midnight. Comparing timestamps rather than calendar dates would flip it.
  test('late at night, a loan due today is still due today', () => {
    const lateTonight = new Date(2026, 8, 21, 23, 59)
    assert.equal(loanState('ACTIVE', new Date(2026, 8, 21, 0, 1), lateTonight), 'due-today')
  })

  test('first thing in the morning, yesterday is still overdue', () => {
    const earlyToday = new Date(2026, 8, 21, 0, 1)
    assert.equal(loanState('ACTIVE', new Date(2026, 8, 20, 23, 59), earlyToday), 'overdue')
  })

  test('a due date across a daylight-saving boundary does not slip a day', () => {
    const now = new Date(2026, 2, 7) // the day before US DST begins
    assert.equal(loanState('ACTIVE', new Date(2026, 2, 8), now), 'due-soon')
    assert.equal(loanState('ACTIVE', new Date(2026, 2, 7), now), 'due-today')
  })
})
