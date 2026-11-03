import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { ACTIONS, actionSpec, checkProposal, findActions, toFormData } from '../../src/server/assistant/actions.ts'
import { parseRefusal } from '../../src/server/assistant/usage.ts'

/**
 * The parts of Ask Pondex's changes that decide what reaches a server action:
 * which action a request finds, what a proposal must carry before a card is
 * shown, and the FormData the card posts. The server action itself is the
 * app's own and is tested where it lives.
 */

describe('find_action finds the change that was asked for', () => {
  const cases: [string, string][] = [
    ['new loan', 'create_loan'],
    ['mark paid', 'mark_paid'],
    ['extend the loan', 'extend_loan'],
    ['add a note', 'add_note'],
    ['deposit money', 'record_money'],
    ['set label good', 'set_label'],
    ['restore borrower', 'restore_borrower'],
  ]
  for (const [what, name] of cases) {
    test(what, () => assert.equal(findActions(what)[0]?.name, name))
  }

  test('nothing for an unrelated request', () => assert.deepEqual(findActions('weather tomorrow'), []))
})

describe('the catalog', () => {
  test('every action name is unique', () => assert.equal(new Set(ACTIONS.map((a) => a.name)).size, ACTIONS.length))

  test('no sign-in, password or photo upload action is offered', () => {
    for (const name of ['login', 'logout', 'change_password', 'set_borrower_photo']) assert.equal(actionSpec(name), null)
  })
})

describe('a proposal must be complete before a card is shown', () => {
  const loan = actionSpec('create_loan')!

  test('a loan with no funders is sent back to ask', () => {
    const result = checkProposal(loan, { borrowerId: 'b', capital: '20000', startOn: '2026-11-04', dueOn: '2026-11-25' }, [])
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /funders/)
  })

  test('a missing required field is named', () => {
    const result = checkProposal(actionSpec('mark_paid')!, { loanId: 'x' }, undefined)
    assert.deepEqual(result, { ok: false, error: 'Missing: paidOn. Ask the Admin.' })
  })

  test('a choice outside its list is refused', () => {
    const result = checkProposal(actionSpec('set_label')!, { borrowerId: 'b', label: 'GREAT' }, undefined)
    assert.equal(result.ok, false)
  })

  test('fields the action does not take are dropped', () => {
    const result = checkProposal(actionSpec('add_note')!, { loanId: 'x', body: 'Paid half', userId: 'someone-else' }, undefined)
    assert.deepEqual(result, { ok: true, fields: { loanId: 'x', body: 'Paid half' }, funders: [] })
  })

  test('funders become the rows the loan form posts', () => {
    const checked = checkProposal(
      loan,
      { borrowerId: 'b', capital: '20000', startOn: '2026-11-04', dueOn: '2026-11-25' },
      [{ lenderId: 'fidel', amount: '10000' }, { lenderId: 'jr', amount: '10000' }],
    )
    assert.ok(checked.ok)
    const form = toFormData(checked.fields, checked.funders, [])
    assert.deepEqual(form.getAll('funderLenderId'), ['fidel', 'jr'])
    assert.deepEqual(form.getAll('funderAmount'), ['10000', '10000'])
    assert.equal(form.get('capital'), '20000')
  })
})

describe("reading Groq's refusals", () => {
  test('a daily refusal gives the real figures and the wait', () => {
    const refusal = parseRefusal(
      'Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 199539, Requested 2510. Please try again in 14m12.4s.',
      '853',
    )
    assert.deepEqual(refusal, { daily: true, waitS: 853, used: 199539, limit: 200000 })
  })

  test('a per-minute refusal is not mistaken for the day', () => {
    const refusal = parseRefusal('on tokens per minute (TPM): Limit 8000, Used 7000, Requested 2000. Please try again in 7.5s.', '8')
    assert.deepEqual(refusal, { daily: false, waitS: 8, used: null, limit: null })
  })

  test('with no message, the header decides the wait', () => {
    assert.equal(parseRefusal('', '30').waitS, 30)
  })

  test('hours are read too', () => {
    assert.equal(parseRefusal('per day (TPD). Please try again in 1h2m3s.', null).waitS, 3723)
  })
})
