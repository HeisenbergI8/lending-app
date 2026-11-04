import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { ACTIONS, actionSpec, checkProposal, fileRequired, findActions, normalizeFields, toFormData } from '../../src/server/assistant/actions.ts'
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

describe('a loan names its borrower', () => {
  const loan = actionSpec('create_loan')!
  const base = { capital: '20000', startOn: '2026-11-04', dueOn: '2026-11-25' }
  const funders = [{ lenderId: 'fidel', amount: '20000' }]

  test('a first name alone is not enough for someone new', () => {
    const result = checkProposal(loan, { ...base, borrowerFirstName: 'Jelo' }, funders)
    assert.equal(result.ok, false)
  })

  test('both names, or an existing borrower, are', () => {
    assert.equal(checkProposal(loan, { ...base, borrowerFirstName: 'Jelo', borrowerLastName: 'Cruz' }, funders).ok, true)
    assert.equal(checkProposal(loan, { ...base, borrowerId: 'b1' }, funders).ok, true)
  })
})

describe('overnight fixes (2026-11-04)', () => {
  test('a pending request by dates uses the form\'s own "custom" option and needs both dates', () => {
    const request = actionSpec('create_request')!
    assert.deepEqual(checkProposal(request, { borrowerId: 'b', capital: '5000', termChoice: 'dates' }, undefined).ok, false)
    const result = checkProposal(request, { borrowerId: 'b', capital: '5000', termChoice: 'custom', startOn: '2026-11-04' }, undefined)
    assert.deepEqual(result, { ok: false, error: 'Missing: dueOn. Ask the Admin.' })
    assert.equal(checkProposal(request, { borrowerId: 'b', capital: '5000', termChoice: 'weeks' }, undefined).ok, false)
    assert.equal(checkProposal(request, { borrowerId: 'b', capital: '5000', termChoice: 'weeks', weeks: '3' }, undefined).ok, true)
  })

  test('an edit card must carry the funders, or the app would refuse after Confirm', () => {
    const edit = actionSpec('update_loan')!
    const result = checkProposal(edit, { loanId: 'l', borrowerId: 'b', capital: '20000', startOn: '2026-11-04', dueOn: '2026-11-25' }, [])
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /funders/)
  })

  test('extending with the interest paid now needs the screenshot on the card', () => {
    const extend = actionSpec('extend_loan')!
    assert.equal(fileRequired(extend, { loanId: 'l', weeks: '2', paidNow: 'yes' }), true)
    assert.equal(fileRequired(extend, { loanId: 'l', weeks: '2', paidNow: 'no' }), false)
    assert.equal(fileRequired(actionSpec('mark_paid')!, { loanId: 'l', paidOn: '2026-11-04' }), true)
    assert.equal(fileRequired(actionSpec('add_note')!, { loanId: 'l', body: 'x' }), false)
  })

  test('an amount or date the forms would refuse never reaches a card', () => {
    const loan = actionSpec('create_loan')!
    const funders = [{ lenderId: 'f', amount: '20000' }]
    assert.equal(checkProposal(loan, { borrowerId: 'b', capital: '20k', startOn: '2026-11-04', dueOn: '2026-11-25' }, funders).ok, false)
    assert.equal(checkProposal(loan, { borrowerId: 'b', capital: '20000', startOn: 'today', dueOn: '2026-11-25' }, funders).ok, false)
    assert.equal(checkProposal(loan, { borrowerId: 'b', capital: '20000', startOn: '2026-11-04', dueOn: '2026-11-25' }, [{ lenderId: 'f', amount: 'half' }]).ok, false)
    assert.equal(checkProposal(actionSpec('extend_loan')!, { loanId: 'l', weeks: 'two' }, undefined).ok, false)
  })

  test('a rate typed with a percent sign is read as the number, so the card says "7% a week" not "7%%"', () => {
    const loan = actionSpec('create_loan')!
    const result = checkProposal(loan, { borrowerId: 'b', capital: '20000', startOn: '2026-11-04', dueOn: '2026-11-25', borrowerRate: '7%' }, [{ lenderId: 'f', amount: '20000' }])
    assert.ok(result.ok)
    assert.equal(result.fields.borrowerRate, '7')
  })

  test('a fixed-amount loan needs its interest and the lenders\' share', () => {
    const loan = actionSpec('create_loan')!
    const result = checkProposal(loan, { borrowerId: 'b', capital: '20000', startOn: '2026-11-04', dueOn: '2026-11-07', interestBasis: 'FIXED_AMOUNT' }, [{ lenderId: 'f', amount: '20000' }])
    assert.deepEqual(result, { ok: false, error: 'Missing: fixedInterest, fixedLenderShare. Ask the Admin.' })
  })
})

describe('the server does the calendar, not the model', () => {
  const loan = actionSpec('create_loan')!
  test('"today" becomes the date, and 4 weeks becomes the due date', () => {
    assert.deepEqual(normalizeFields(loan, { startOn: 'today', weeks: '4' }, '2026-11-04'), { startOn: '2026-11-04', dueOn: '2026-12-02' })
  })
  test('weeks win over a due date the model counted wrong', () => {
    assert.equal(normalizeFields(loan, { startOn: '2026-11-04', dueOn: '2026-11-15', weeks: '2' }, '2026-11-04').dueOn, '2026-11-18')
  })
  test('a due date with no weeks is kept', () => {
    assert.equal(normalizeFields(loan, { startOn: '2026-11-04', dueOn: '2026-11-18' }, '2026-11-04').dueOn, '2026-11-18')
  })
  test('weeks across a month end', () => {
    assert.equal(normalizeFields(loan, { startOn: '2026-11-28', weeks: '1' }, '2026-11-04').dueOn, '2026-12-05')
  })
  test('3 days becomes a due date 3 days out, not a week (Groq rerun LOAN-15)', () => {
    assert.deepEqual(normalizeFields(loan, { startOn: 'today', days: '3' }, '2026-11-04'), { startOn: '2026-11-04', dueOn: '2026-11-07' })
  })
  test('"3 days" typed into the due date is a length', () => {
    assert.equal(normalizeFields(loan, { startOn: '2026-11-04', dueOn: '3 days' }, '2026-11-04').dueOn, '2026-11-07')
  })
  test('weeks win when both weeks and days came through', () => {
    assert.equal(normalizeFields(loan, { startOn: '2026-11-04', weeks: '1', days: '3' }, '2026-11-04').dueOn, '2026-11-11')
  })
  test('tomorrow in another date field', () => {
    assert.equal(normalizeFields(actionSpec('mark_paid')!, { paidOn: 'Tomorrow' }, '2026-11-30').paidOn, '2026-12-01')
  })
})

describe('find_action matches whole words', () => {
  test('"mark as good" finds the label, not a note ("remark")', () => assert.equal(findActions('mark Rico as good')[0]?.name, 'set_label'))
  test('"remove label" finds the label', () => assert.ok(findActions('remove label').some((a) => a.name === 'set_label')))
  test('"mark paid" still finds mark_paid first', () => assert.equal(findActions('mark paid')[0]?.name, 'mark_paid'))
})

describe("the loan form's term checks run before a card", () => {
  const loan = actionSpec('create_loan')!
  const base = { borrowerId: 'b', capital: '5000', startOn: '2026-11-04' }
  const one = [{ lenderId: 'm', amount: '5000' }]
  test('10 days on a weekly-rate loan is refused with the two dates that work', () => {
    const r = checkProposal(loan, { ...base, dueOn: '2026-11-14' }, one)
    assert.equal(r.ok, false)
    assert.match(r.ok ? '' : r.error, /week/i)
  })
  test('a due date before the start is refused', () => {
    assert.match((checkProposal(loan, { ...base, dueOn: '2026-10-28' }, one) as { error: string }).error, /before the start/)
  })
  test('funders that do not add up are refused before the card', () => {
    assert.match((checkProposal(loan, { ...base, dueOn: '2026-11-18' }, [{ lenderId: 'm', amount: '3000' }]) as { error: string }).error, /add up to ₱3,000\.00/)
  })
  test('a fixed-amount loan may run 10 days', () => {
    assert.equal(checkProposal(loan, { ...base, dueOn: '2026-11-14', interestBasis: 'FIXED_AMOUNT', fixedInterest: '500', fixedLenderShare: '300' }, one).ok, true)
  })
  test('an existing borrower drops the new-person names from the card', () => {
    const r = checkProposal(loan, { ...base, dueOn: '2026-11-18', borrowerFirstName: 'Lyn', borrowerLastName: 'Bautista' }, one)
    assert.ok(r.ok)
    assert.equal(r.fields.borrowerFirstName, undefined)
  })
  test('"4 weeks from today" typed as the due date becomes weeks', () => {
    assert.equal(normalizeFields(loan, { startOn: 'today', dueOn: '4 weeks from today' }, '2026-11-04').dueOn, '2026-12-02')
  })
})

describe('find_action word endings (run 10)', () => {
  test('"Maria added 10k" finds money in', () => assert.equal(findActions('Maria added 10k to her pot')[0]?.name, 'record_money'))
  test('"Jun withdrew" and "withdrawal" find money out', () => {
    assert.equal(findActions('record a withdrawal for Jun')[0]?.name, 'record_money')
  })
})
