import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { clip, dropUnasked, isChangeRequest, isSimpleQuestion, lightModel, toolsFor, manilaToday, nudgeFor, trimHistory, withoutIds } from '../../src/server/assistant/chat.ts'

describe('the chat loop', () => {
  test("today is the Admin's day in Manila, not the server's UTC day", () => {
    // 2026-11-04 06:30 in Manila is still 2026-11-03 in UTC.
    assert.equal(manilaToday(new Date('2026-11-03T22:30:00Z')), '2026-11-04')
    assert.equal(manilaToday(new Date('2026-11-04T15:59:00Z')), '2026-11-04')
    assert.equal(manilaToday(new Date('2026-11-04T16:01:00Z')), '2026-11-05')
  })

  test('a long chat keeps its first turn, where the request usually is', () => {
    const turns = Array.from({ length: 20 }, (_, i) => i)
    const kept = trimHistory(turns, 14)
    assert.equal(kept.length, 14)
    assert.equal(kept[0], 0)
    assert.deepEqual(kept.slice(1), turns.slice(-13))
  })

  test('a short chat is sent whole', () => assert.deepEqual(trimHistory([1, 2, 3], 14), [1, 2, 3]))
})

describe('nudges for smaller models', () => {
  test('an empty reply is sent back once', () => assert.match(nudgeFor('', 'how much does bea owe', []) ?? '', /empty/))
  test('a promise to look is sent back', () => assert.match(nudgeFor('Let me check that for you.', 'how much does bea owe', ['find_borrower']) ?? '', /lookup now/))
  test('a rules question answered without read_rules is sent back', () =>
    assert.match(nudgeFor('Good means never late.', 'What makes a borrower Good, Okay or Bad?', []) ?? '', /read_rules/))
  test('a rules question that used read_rules is left alone', () =>
    assert.equal(nudgeFor('From your rules: Good is never late.', 'What makes a borrower Good?', ['read_rules']), null))
  test('"do I need a screenshot" is a rules question', () =>
    assert.match(nudgeFor('Your rules don\'t say.', 'do i need a screenshot to mark paid?', []) ?? '', /read_rules/))
  test('"can borrowers pay in parts" is a rules question', () =>
    assert.match(nudgeFor('Yes, they can.', 'can borrowers pay in parts?', []) ?? '', /read_rules/))
  test('an answer that cites the rules without reading them is sent back', () =>
    assert.match(nudgeFor('Your rules say 4 weeks.', 'usual length?', []) ?? '', /read_rules/))
  test('a plain data answer is left alone', () => assert.equal(nudgeFor('Out on loan is ₱95,000.00.', 'How much is out on loan right now?', ['get_overview']), null))
})

describe('ids never reach the Admin', () => {
  test('a cuid and a uuid are removed', () => {
    assert.equal(withoutIds('Loan cmw0yq3cm0010odoobg23mycx was not found.'), 'Loan was not found.')
    assert.equal(withoutIds('Loan (eb4f7578-e29d-45e5-a2ea-188994cb4be3) is paid.'), 'Loan is paid.')
  })
  test('ordinary words and amounts stay', () => assert.equal(withoutIds('Rico owes ₱25,600.00.'), 'Rico owes ₱25,600.00.'))
})

describe('long messages', () => {
  test('a long message keeps its start and its end, where the question is', () => {
    const text = 'Context. '.repeat(100) + 'How much is out on loan right now?'
    const kept = clip(text, 600)
    assert.ok(kept.length <= 600)
    assert.ok(kept.startsWith('Context.'))
    assert.ok(kept.endsWith('How much is out on loan right now?'))
  })
  test('a short message is untouched', () => assert.equal(clip('hi', 600), 'hi'))
})

describe('change requests are not rules questions', () => {
  test('"can you lend…" asking a follow-up is left alone', () =>
    assert.equal(nudgeFor('How much from each lender?', 'can you lend lyn 5k from maria and jun?', ['find_action']), null))
})

describe('a change in progress is not nudged to the rules', () => {
  test('"mark Lyn as good" after find_action is left alone', () =>
    assert.equal(nudgeFor('Which label: Good, Okay or Bad?', 'mark Lyn as good', ['find_action']), null))
})

describe('loan options the Admin did not ask for are dropped', () => {
  test('weekly interest nobody mentioned is removed', () => {
    const args = { action: 'create_loan', fields: { capital: '5000', interestCollection: 'WEEKLY', borrowerRate: '7', interestBasis: 'WEEKLY_RATE' } }
    dropUnasked(args, 'lend Lyn Bautista 5,000 today, due in 4 weeks, all from Maria')
    assert.deepEqual(args.fields, { capital: '5000' })
  })
  test('what the Admin said stays', () => {
    const args = { action: 'create_loan', fields: { interestCollection: 'WEEKLY', borrowerRate: '8' } }
    dropUnasked(args, 'lend bea 30k at 8% with weekly interest')
    assert.deepEqual(args.fields, { interestCollection: 'WEEKLY', borrowerRate: '8' })
  })
  test('other actions are untouched', () => {
    const args = { action: 'update_loan', fields: { interestCollection: 'WEEKLY' } }
    dropUnasked(args, 'change the date')
    assert.deepEqual(args.fields, { interestCollection: 'WEEKLY' })
  })
})

describe('the slips the first runs found', () => {
  test('"ready to confirm" with no card is sent back', () =>
    assert.match(nudgeFor('Done, check it, then tap Confirm.', 'add a note on dan', ['find_action']) ?? '', /No card/))
  test('an invented "did you mean" name is sent back', () =>
    assert.match(nudgeFor('Did you mean Mark Lope?', 'how much does mark owe', ['find_borrower'], ['Rico Mendoza']) ?? '', /Only offer names/))
  test('a "did you mean" from the lookup is fine', () =>
    assert.equal(nudgeFor('Did you mean Rico Mendoza?', 'how much does ricco owe', ['find_borrower'], ['Rico Mendoza']), null))
  test('a change answered without trying it is sent back', () =>
    assert.match(nudgeFor('Okay, noted.', 'add lender Paolo Garcia', []) ?? '', /This is a change/))
  test('a question about paying is not a change', () => assert.equal(nudgeFor('From your rules: full payment only.', 'can borrowers pay in parts?', ['read_rules']), null))
})

describe('phantom cards and missed changes (run 7)', () => {
  test('"Here is the ready-to-confirm card" with no card is sent back', () =>
    assert.match(nudgeFor('Here is the ready-to-confirm card.', 'lyn paid in full today', ['find_borrower']) ?? '', /No card/))
  test('a proposal written out as text ("**Proposed action** ... Please confirm") is sent back', () =>
    assert.match(nudgeFor('**Proposed action**\n\nAction: create_loan\nPlease confirm.', 'lend 20k to rico from john ross', ['find_borrower']) ?? '', /No card/))
  test('"pd" and "withdrawal" are change requests', () => {
    assert.match(nudgeFor('Okay.', 'rico pd today', []) ?? '', /This is a change/)
    assert.match(nudgeFor('Noted.', 'record jun withdrawal 5k', []) ?? '', /This is a change/)
  })
})

describe('phantom cards, more wordings (run 8)', () => {
  test('"You can now review and confirm the changes" with no card is sent back', () =>
    assert.match(nudgeFor('You can now review and confirm the changes.', 'move the due date', ['find_action']) ?? '', /No card/))
})

describe('change requests are planned by the server', () => {
  test('"add lender Paolo Garcia" is a change request', () => assert.equal(isChangeRequest('add lender Paolo Garcia'), true))
  test('"rico pd today" is a change request', () => assert.equal(isChangeRequest('rico pd today'), true))
  test('"can borrowers pay in parts?" is a question', () => assert.equal(isChangeRequest('can borrowers pay in parts?'), false))
  test('"how much does bea owe" is a question', () => assert.equal(isChangeRequest('how much does bea owe'), false))
})

describe('which model answers (plain lookups go to the light model)', () => {
  test('a short lookup is simple', () => {
    assert.equal(isSimpleQuestion('How much is out on loan right now?', 1), true)
    assert.equal(isSimpleQuestion('who is overdue', 1), true)
  })
  test('a change is not simple', () => assert.equal(isSimpleQuestion('lend Bea 3k from the admin pot for 3 days', 1), false))
  test('a rules question is not simple', () => {
    assert.equal(isSimpleQuestion('is dan bad?', 1), false)
    assert.equal(isSimpleQuestion('how much interest on 20k at 7% for 3 weeks', 1), false)
  })
  test('a follow-up in a conversation is not simple', () => assert.equal(isSimpleQuestion('and jun?', 2), false))
  test('a long or compound question is not simple', () => {
    assert.equal(isSimpleQuestion('how much does Rico owe and when is it due', 1), false)
    assert.equal(isSimpleQuestion('x'.repeat(81), 1), false)
  })
  test('the light model is used only when it is in the list and not already first', () => {
    assert.equal(lightModel(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']), 'openai/gpt-oss-20b')
    assert.equal(lightModel(['openai/gpt-oss-120b']), null)
    assert.equal(lightModel(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']), null)
  })
})

describe('sending only what a question needs (fewer tokens per call)', () => {
  const names = (mode: 'read' | 'change') => toolsFor(mode).map((t) => t.function.name)
  test('a plain question gets no propose_action', () => assert.ok(!names('read').includes('propose_action')))
  test('a plain question keeps find_action, so a missed change can still switch over', () => assert.ok(names('read').includes('find_action')))
  test('a change gets every tool', () => assert.ok(names('change').includes('propose_action')))
  test('change requests the words used to miss (Groq rerun, recall check)', () => {
    assert.equal(isChangeRequest('pahiram si lyn ng 3k galing kay maria, 2 weeks simula ngayon'), true)
    assert.equal(isChangeRequest('maria deposited 5k'), true)
    assert.equal(isChangeRequest('Lyn is good now, set it'), true)
    assert.equal(isChangeRequest('update Rico to 6%'), true)
  })
})

describe('a change typed with a slip of the thumb is still a change', () => {
  for (const q of ['kend Rico 10k from Maria for 3 weeks starting today', 'mrak lyn as paid', 'delte jun 5k withdrawl', 'rico payed today', 'restor Paolo'])
    test(q, () => assert.equal(isChangeRequest(q), true))
  test('plain questions with near words are not changes', () => {
    assert.equal(isChangeRequest('how much is out on loan right now?'), false)
    assert.equal(isChangeRequest('who is overdue'), false)
    assert.equal(isChangeRequest('show lenders'), false)
    assert.equal(isChangeRequest('total of all loans'), false)
  })
})
