import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { centavos } from '../../src/lib/money/centavos.ts'
import { EMPTY_LEDGER, lenderPosition } from '../../src/lib/money/floating.ts'
import { type HistoryFunding, type HistoryMove, moneyHistory } from '../../src/lib/money/money-history.ts'
import { releasedOnFunding } from '../../src/lib/money/weekly.ts'

const peso = (n: number) => centavos(Math.round(n * 100))
const day = (m: number, d: number) => new Date(2026, m - 1, d, 12)

const funding = (over: Partial<HistoryFunding>): HistoryFunding => ({
  loanId: 'loan-1',
  lenderId: 'john',
  lenderName: 'John Ross',
  borrowerName: 'Angel Dela Cruz',
  principal: peso(30_000),
  earnings: peso(6_000),
  adminCut: peso(2_400),
  startOn: day(9, 1),
  paidOn: null,
  paid: false,
  termDays: 28,
  weekly: false,
  weeksPaid: [],
  ...over,
})

const deposit = (id: string, amount: number, on: Date): HistoryMove => ({
  id,
  type: 'DEPOSIT',
  amount: peso(amount),
  occurredOn: on,
  note: null,
  against: null,
})

/**
 * Floating as `ledgers` in server/lenders/queries.ts works it out — the same
 * sums, restated here so the history is checked against the rule rather than
 * against itself.
 */
function floatingByLedger(lenderId: string, isSelf: boolean, rows: HistoryFunding[], moves: HistoryMove[]) {
  const ledger = { ...EMPTY_LEDGER }
  for (const move of moves) {
    if (move.type === 'DEPOSIT') ledger.deposits = centavos(ledger.deposits + move.amount)
    else ledger.withdrawals = centavos(ledger.withdrawals + move.amount)
  }
  for (const row of rows) {
    const released = row.weekly
      ? releasedOnFunding(
          { earnings: row.earnings, adminCut: row.adminCut },
          row.termDays / 7,
          new Set(row.weeksPaid.map((w) => w.week)),
        )
      : { earnings: centavos(0), adminCut: centavos(0) }
    if (row.lenderId === lenderId) {
      if (row.paid) ledger.settledEarnings = centavos(ledger.settledEarnings + row.earnings)
      else {
        ledger.activePrincipal = centavos(ledger.activePrincipal + row.principal)
        ledger.settledEarnings = centavos(ledger.settledEarnings + released.earnings)
      }
    }
    if (isSelf) {
      ledger.settledAdminCuts = centavos(ledger.settledAdminCuts + (row.paid ? row.adminCut : released.adminCut))
    }
  }
  return lenderPosition(ledger).floating
}

describe('money history — where a pot’s money went', () => {
  test('John Ross: repaid, then lent straight out again, lands on ₱0 floating', () => {
    const rows = [
      funding({ loanId: 'a', startOn: day(8, 1), paid: true, paidOn: day(8, 29) }),
      funding({ loanId: 'b', borrowerName: 'Rovie Etang', principal: peso(36_000), earnings: peso(7_200), startOn: day(9, 2) }),
    ]
    const moves = [deposit('d1', 30_000, day(7, 30))]
    const history = moneyHistory('john', false, rows, moves)

    // Newest first.
    assert.deepEqual(
      history.map((e) => [e.title, e.amount / 100, e.balance / 100]),
      [
        ['Lent to Rovie Etang', -36_000, 0],
        ['Angel Dela Cruz paid back', 36_000, 36_000],
        ['Lent to Angel Dela Cruz', -30_000, 0],
        ['Money in', 30_000, 30_000],
      ],
    )
    assert.equal(history[0].balance, floatingByLedger('john', false, rows, moves))
    assert.equal(history[1].detail, '₱30,000.00 capital + ₱6,000.00 interest')
  })

  test('on one day, money in is counted before money out', () => {
    const rows = [
      funding({ loanId: 'a', startOn: day(8, 1), paid: true, paidOn: day(9, 5) }),
      funding({ loanId: 'b', startOn: day(9, 5), principal: peso(36_000) }),
    ]
    const moves = [deposit('d1', 30_000, day(8, 1))]
    const balances = moneyHistory('john', false, rows, moves).map((e) => e.balance)
    assert.ok(balances.every((b) => b >= 0), `never below zero: ${balances}`)
  })

  test('a weekly loan pays its interest week by week, and the repayment brings only the rest', () => {
    const weekly = funding({
      loanId: 'w',
      weekly: true,
      weeksPaid: [
        { week: 1, paidOn: day(9, 8) },
        { week: 2, paidOn: day(9, 15) },
        { week: 2, paidOn: day(9, 16) }, // recorded twice: still one week's money
      ],
      paid: true,
      paidOn: day(9, 29),
    })
    const moves = [deposit('d1', 30_000, day(9, 1))]
    const history = moneyHistory('john', false, [weekly], moves)
    const weeks = history.filter((e) => e.kind === 'interest')
    assert.equal(weeks.length, 2)
    assert.equal(weeks.reduce((sum, e) => sum + e.amount, 0), peso(3_000))
    assert.equal(history.find((e) => e.kind === 'repaid')?.amount, peso(30_000 + 3_000))
    assert.equal(history[0].balance, floatingByLedger('john', false, [weekly], moves))
  })

  test('the Admin pot shows the cut taken on other people’s money, and ends on its floating', () => {
    const rows = [
      funding({ loanId: 'a', paid: true, paidOn: day(9, 29) }),
      funding({
        loanId: 'w',
        lenderId: 'maria',
        lenderName: 'Maria Cruz',
        weekly: true,
        weeksPaid: [{ week: 1, paidOn: day(9, 8) }],
      }),
      funding({ loanId: 'own', lenderId: 'admin', lenderName: 'Admin', adminCut: centavos(0), earnings: peso(8_400), startOn: day(9, 3) }),
    ]
    const moves = [deposit('d1', 50_000, day(9, 1))]
    const history = moneyHistory('admin', true, rows, moves)
    const cuts = history.filter((e) => e.kind === 'cut')
    assert.deepEqual(
      cuts.map((e) => [e.title, e.detail, e.amount / 100]),
      [
        ['Admin cut · Angel Dela Cruz', 'On John Ross’s money', 2_400],
        ['Admin cut · Angel Dela Cruz week 1', 'On Maria Cruz’s money', 600],
      ],
    )
    assert.equal(history[0].balance, floatingByLedger('admin', true, rows, moves))
  })

  test('an advance says which loan it was drawn against, and a loan not repaid brings nothing back', () => {
    const rows = [funding({ loanId: 'a' })]
    const moves: HistoryMove[] = [
      deposit('d1', 40_000, day(8, 30)),
      { id: 'w1', type: 'WITHDRAWAL', amount: peso(5_000), occurredOn: day(9, 10), note: 'cash', against: { loanId: 'a', borrowerName: 'Angel Dela Cruz' } },
    ]
    const history = moneyHistory('john', false, rows, moves)
    assert.equal(history[0].title, 'Advance on Angel Dela Cruz’s loan')
    assert.equal(history[0].detail, 'cash')
    assert.equal(history.filter((e) => e.kind === 'repaid').length, 0)
    assert.equal(history[0].balance, peso(5_000))
    assert.equal(history[0].balance, floatingByLedger('john', false, rows, moves))
  })
})
