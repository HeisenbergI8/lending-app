import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { nextUnpaidWeek } from '../../src/lib/money/weekly.ts'
import { paidWeekNumbers } from '../../src/server/payments/settled.ts'

/**
 * Undoing a week, and what Recently Deleted does about it.
 *
 * AN UNDONE WEEK IS INVISIBLE THERE, deliberately. Recently Deleted has four
 * sections — lenders, borrowers, loans, transactions — and payments have never
 * been one of them: an undone repayment simply vanishes and the loan reads Active
 * again, which is the whole story. A weekly payment is a Payment, so it behaves
 * the same way, and giving weekly payments a fifth section while ordinary ones
 * had none would make the two kinds differ in the one place the Admin goes when
 * something has gone wrong. If that section is ever wanted it is wanted for both.
 *
 * What DOES have to happen is the loan's next due date moving back with the
 * undone week. Without it the schedule shows week 7 owed again while the loans
 * list still chases week 8, and the two disagree on the same screen refresh.
 * That is the rule proved here, on the same functions undoWeekPaid calls.
 */

const start = new Date(2026, 8, 5, 12) // 5 September 2026
const WEEKS = 20

/** The Payment rows a loan carries, in the shape the server selects them. */
type Row = { weekNumber: number | null; deletedAt: Date | null }

describe('undoing a week puts it back on the schedule', () => {
  test('the next due date moves BACK to the undone week', () => {
    const rows: Row[] = [
      { weekNumber: 1, deletedAt: null },
      { weekNumber: 2, deletedAt: null },
      { weekNumber: 3, deletedAt: null },
    ]
    assert.equal(nextUnpaidWeek(start, WEEKS, paidWeekNumbers(rows))?.week, 4)

    // Week 3 undone: soft-deleted, not destroyed.
    const undone: Row[] = [...rows.slice(0, 2), { weekNumber: 3, deletedAt: new Date() }]
    assert.equal(nextUnpaidWeek(start, WEEKS, paidWeekNumbers(undone))?.week, 3)
  })

  test('an archived row still occupies its week, so re-recording reuses it', () => {
    // This is why markWeekPaid and convertToWeekly are find-then-write rather
    // than create: the @@unique on (loanId, weekNumber) is still satisfied by the
    // archived row, so a `create` for week 3 would throw.
    const rows: Row[] = [{ weekNumber: 3, deletedAt: new Date() }]
    assert.equal(paidWeekNumbers(rows).has(3), false, 'an undone week must not read as paid')
    assert.equal(rows.some((row) => row.weekNumber === 3), true, 'the row is still there')
  })

  test('undoing a MIDDLE week is chased from that week, not from the end', () => {
    const rows: Row[] = [
      { weekNumber: 1, deletedAt: null },
      { weekNumber: 2, deletedAt: new Date() },
      { weekNumber: 3, deletedAt: null },
      { weekNumber: 4, deletedAt: null },
    ]
    assert.equal(nextUnpaidWeek(start, WEEKS, paidWeekNumbers(rows))?.week, 2)
  })

  test('the settling payment is not a week and undoing it touches no week', () => {
    // undoPayment archives the weekNumber: null row only. The collected weeks
    // are money that really was received and are undone one at a time.
    const rows: Row[] = [
      { weekNumber: 1, deletedAt: null },
      { weekNumber: 2, deletedAt: null },
      { weekNumber: null, deletedAt: new Date() },
    ]
    const paid = paidWeekNumbers(rows)
    assert.deepEqual([...paid].sort(), [1, 2])
    assert.equal(nextUnpaidWeek(start, WEEKS, paid)?.week, 3)
  })

  test('undoing every week puts the loan back to owing week one', () => {
    const rows: Row[] = [1, 2, 3].map((week) => ({ weekNumber: week, deletedAt: new Date() }))
    assert.equal(nextUnpaidWeek(start, WEEKS, paidWeekNumbers(rows))?.week, 1)
  })
})
