import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { manilaToday, nudgeFor, trimHistory, withoutIds } from '../../src/server/assistant/chat.ts'

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
  test('a plain data answer is left alone', () => assert.equal(nudgeFor('Out on loan is ₱95,000.00.', 'How much is out on loan right now?', ['get_overview']), null))
})

describe('ids never reach the Admin', () => {
  test('a cuid and a uuid are removed', () => {
    assert.equal(withoutIds('Loan cmw0yq3cm0010odoobg23mycx was not found.'), 'Loan was not found.')
    assert.equal(withoutIds('Loan (eb4f7578-e29d-45e5-a2ea-188994cb4be3) is paid.'), 'Loan is paid.')
  })
  test('ordinary words and amounts stay', () => assert.equal(withoutIds('Rico owes ₱25,600.00.'), 'Rico owes ₱25,600.00.'))
})
