import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { stepFinished, stepStarted } from '../../src/lib/assistant-steps.ts'

describe('Dex-E steps, in plain words', () => {
  test('a name is shown the way a person writes it', () => {
    assert.equal(stepStarted('find_borrower', { name: 'angel dela cruz' }), 'Looking for Angel Dela Cruz')
    assert.equal(stepStarted('find_loans', { name: 'rico' }), 'Looking at Rico’s loans')
  })
  test('no tool names reach the screen', () => {
    for (const tool of ['read_rules', 'get_overview', 'list_lenders', 'find_loans', 'get_loan', 'list_pending', 'list_deleted', 'find_action', 'propose_action', 'search_notes', 'lender_earnings', 'period_summary', 'admin_cut', 'borrower_statement', 'money_history', 'floating_on', 'something_new']) {
      assert.doesNotMatch(stepStarted(tool, {}), /_/)
      assert.doesNotMatch(stepFinished(tool, {}, {}).text, /_/)
    }
  })
  test('one borrower found', () => {
    assert.deepEqual(stepFinished('find_borrower', { name: 'angel' }, { found: true, borrowers: [{ name: 'Angel Dela Cruz' }] }), { text: 'Found Angel Dela Cruz', state: 'done' })
  })
  test('nobody found, and a lender rather than a borrower', () => {
    assert.deepEqual(stepFinished('find_borrower', { name: 'juan' }, { found: false, reason: 'x' }), { text: 'Nobody named “Juan”', state: 'missed' })
    assert.equal(stepFinished('find_borrower', { name: 'maria' }, { found: false, lenders: [{ name: 'Maria Cruz' }] }).text, 'Maria Cruz is a lender, not a borrower')
    assert.equal(stepFinished('find_borrower', { name: 'mrak lyn' }, { found: false, didYouMean: [{ name: 'Lyn Reyes' }] }).text, 'No exact match for “Mrak Lyn”')
  })
  test('loans are counted across every match, not only the ones shown', () => {
    assert.equal(stepFinished('find_loans', {}, { totals: { matching: 30 }, loans: new Array(25).fill({}) }).text, 'Found 30 loans')
    assert.equal(stepFinished('find_loans', {}, { totals: { matching: 1 }, loans: [{}] }).text, 'Found 1 loan')
    assert.equal(stepFinished('find_loans', {}, { totals: { matching: 0 }, loans: [] }).state, 'missed')
  })
  test('pending requests come back as a plain list', () => {
    assert.equal(stepFinished('list_pending', {}, [{}, {}]).text, 'Found 2 pending requests')
    assert.equal(stepFinished('list_pending', {}, []).text, 'No pending requests')
  })
  test('a card ready, and a card the app sent back', () => {
    assert.deepEqual(stepFinished('propose_action', {}, { proposal: {} }), { text: 'Change ready for you to check', state: 'done' })
    assert.equal(stepFinished('propose_action', {}, { error: 'x' }).state, 'missed')
  })
  test('a failed lookup says so plainly', () => {
    assert.deepEqual(stepFinished('get_overview', {}, { error: 'That lookup failed.' }), { text: 'Could not look that up', state: 'missed' })
  })
})
