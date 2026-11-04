import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchQuick, sayQuick } from '../../src/lib/quick-answers.ts'

const kind = (q: string) => matchQuick(q)?.kind ?? null

describe('instant answers: which questions the server takes', () => {
  test('the four suggestion buttons', () => {
    assert.equal(kind('How much is out on loan right now?'), 'outOnLoan')
    assert.equal(kind('Who is overdue right now?'), 'overdue')
    assert.equal(kind('How much is floating in each pot?'), 'floatingEach')
    assert.equal(kind('What makes a borrower Good, Okay or Bad?'), 'labelRule')
  })
  test('the same questions in everyday words', () => {
    assert.equal(kind("who's overdue"), 'overdue')
    assert.equal(kind('anyone late?'), 'overdue')
    assert.equal(kind('total out on loan'), 'outOnLoan')
    assert.equal(kind('how much is floating rn'), 'floating')
    assert.equal(kind('what is due this week?'), 'dueThisWeek')
    assert.equal(kind('how much interest is still owed to us'), 'interestOwed')
    assert.equal(kind("what's the total of all loans I've ever made?"), 'loansEver')
    assert.equal(kind('who owes the most'), 'owesMost')
    assert.equal(kind('how many borrowers do I have'), 'borrowerCount')
    assert.equal(kind('any pending requests?'), 'pending')
    assert.equal(kind('who is the nearest due on borrowers?'), 'nextDue')
    assert.equal(kind("who's due next"), 'nextDue')
  })
  test('anything more goes to the AI, never a wrong instant answer', () => {
    for (const q of [
      'who is overdue and owes the most?',
      'how much did Maria earn in October?',
      'how much does Angel owe?',
      'how much is out on loan to Rico?',
      'is dan bad?',
      'lend Rico 10k from Maria for 3 weeks',
      'why is Dan overdue?',
      'ok go ahead',
    ]) assert.equal(kind(q), null, q)
  })
})

describe('instant answers: the words', () => {
  const overview = {
    outOnLoan: '₱95,000.00', floating: '₱223,500.00', earned: '₱27,000.00',
    interest: { charged: '₱30,000.00', collected: '₱5,080.00', stillOwed: '₱24,920.00' },
    overdue: { loans: 1, people: 1, amount: '₱15,360.00', who: [{ borrower: 'Dan Aquino', owes: '₱15,360.00', wasDue: '2026-10-28', daysLate: 7 }] },
    dueThisWeek: { amount: '₱8,560.00', loans: 1, people: 1, from: '2026-11-04', to: '2026-11-10' },
    borrowers: { all: 7, owingNow: 5 },
    allLoansEver: { loans: 8, capital: '₱190,000.00' },
    owesMostNow: [{ borrower: 'Angel Dela Cruz', unpaidLoans: 1, toRepay: '₱38,400.00' }, { borrower: 'Rico Mendoza', unpaidLoans: 1, toRepay: '₱20,000.00' }],
  }
  test('out on loan', () => assert.equal(sayQuick('outOnLoan', overview), '**₱95,000.00** is out on loan right now.\n- Borrowers owing: 5'))
  test('who is overdue, by name', () => {
    assert.equal(sayQuick('overdue', overview), '1 borrower is overdue, **₱15,360.00** in all.\n- Dan Aquino: ₱15,360.00, was due October 28, 2026 (7 days late)')
    assert.equal(sayQuick('overdue', { ...overview, overdue: { loans: 0, people: 0, amount: '₱0.00', who: [] } }), 'Nobody is overdue right now.')
  })
  test('who owes the most', () => assert.equal(sayQuick('owesMost', overview), '**Angel Dela Cruz** owes the most right now: ₱38,400.00.\n- Next: Rico Mendoza, ₱20,000.00'))
  test('each pot', () => assert.equal(sayQuick('floatingEach', [{ name: 'Maria Cruz', floating: '₱45,000.00' }]), 'Floating in each pot:\n- Maria Cruz: ₱45,000.00'))
  test('who is due next, from the list sorted by due date', () => {
    const loans = { loans: [{ borrower: 'Julia Dimaano', amount: '₱10,000.00', totalToRepay: '₱12,800.00', nextDue: '2026-11-04' }, { borrower: 'Rico Mendoza', amount: '₱20,000.00', totalToRepay: '₱25,600.00', nextDue: '2026-11-18' }] }
    assert.equal(sayQuick('nextDue', loans), '**Julia Dimaano** is due next, on November 04, 2026.\n- Loan: ₱10,000.00 loan, ₱12,800.00 to repay')
  })
  test('a failed lookup hands the question to the AI', () => assert.equal(sayQuick('outOnLoan', { error: 'That lookup failed.' }), null))
})
