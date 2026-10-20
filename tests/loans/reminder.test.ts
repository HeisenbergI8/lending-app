import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { nextReminderOn, storedLoanStateWithReminder } from '../../src/lib/loan-state.ts'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
/** A `date` column as the driver returns it: midnight UTC. */
const stored = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

describe('nextReminderOn', () => {
  // Starts 1 Oct, due 26 Nov (8 weeks), reminder every 2 weeks: 15 Oct, 29 Oct, 12 Nov.
  const start = day(2026, 10, 1)
  const due = day(2026, 11, 26)

  test('is the first reminder day on or after today', () => {
    assert.deepEqual(nextReminderOn(start, due, 2, day(2026, 10, 1)), day(2026, 10, 15))
    assert.deepEqual(nextReminderOn(start, due, 2, day(2026, 10, 15)), day(2026, 10, 15))
    assert.deepEqual(nextReminderOn(start, due, 2, day(2026, 10, 16)), day(2026, 10, 29))
  })

  test('stops before the due date, where the real date takes over', () => {
    assert.equal(nextReminderOn(start, due, 2, day(2026, 11, 13)), null)
    assert.equal(nextReminderOn(start, due, 8, day(2026, 10, 2)), null)
  })

  test('is null when the reminder is off', () => {
    assert.equal(nextReminderOn(start, due, null, day(2026, 10, 2)), null)
    assert.equal(nextReminderOn(start, due, 0, day(2026, 10, 2)), null)
  })
})

describe('storedLoanStateWithReminder', () => {
  const loan = {
    status: 'ACTIVE' as const,
    startOn: stored(2026, 10, 1),
    dueOn: stored(2026, 11, 26),
    nextDueOn: stored(2026, 11, 26),
    remindEveryWeeks: 2,
  }

  test('reads due soon in the 3 days before a reminder, and on the day', () => {
    for (const d of [12, 13, 14, 15]) {
      const result = storedLoanStateWithReminder(loan, new Date(2026, 9, d, 9))
      assert.equal(result.state, 'due-soon', `Oct ${d}`)
      assert.deepEqual(result.reminderOn, day(2026, 10, 15))
    }
  })

  test('is back to active between reminders', () => {
    assert.deepEqual(storedLoanStateWithReminder(loan, new Date(2026, 9, 11, 9)), { state: 'active', reminderOn: null })
    assert.deepEqual(storedLoanStateWithReminder(loan, new Date(2026, 9, 16, 9)), { state: 'active', reminderOn: null })
  })

  test('never hides a real due date or an overdue loan', () => {
    assert.equal(storedLoanStateWithReminder(loan, new Date(2026, 10, 27, 9)).state, 'overdue')
    assert.deepEqual(storedLoanStateWithReminder(loan, new Date(2026, 10, 24, 9)), { state: 'due-soon', reminderOn: null })
  })

  test('does nothing on a paid loan or with the reminder off', () => {
    assert.equal(storedLoanStateWithReminder({ ...loan, status: 'PAID' }, new Date(2026, 9, 14, 9)).state, 'paid')
    assert.deepEqual(storedLoanStateWithReminder({ ...loan, remindEveryWeeks: null }, new Date(2026, 9, 14, 9)), {
      state: 'active',
      reminderOn: null,
    })
  })
})
