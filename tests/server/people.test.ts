import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  duplicateMessage,
  restoreBlockedMessage,
} from '../../src/server/people.ts'

const angel = { firstName: 'Angel', lastName: 'Cruz' }

/**
 * The wording, not the query.
 *
 * `node --test` cannot reach Prisma, so the lookup itself is covered by the
 * tester driving the real forms. What is pinned here is the branch that decides
 * WHICH refusal the admin reads — a deleted match and a live one need different
 * instructions, and sending her to Recently Deleted for somebody who is sitting
 * on the list is a message that wastes a trip.
 */
describe('refusing a name already on the list', () => {
  test('a live match says to open the one already there', () => {
    const message = duplicateMessage('borrower', angel, false)
    assert.match(message, /^Angel Cruz is already a borrower\./)
    assert.doesNotMatch(message, /Recently Deleted/)
  })

  test('a deleted match sends the Admin to Recently Deleted instead', () => {
    const message = duplicateMessage('borrower', angel, true)
    assert.match(message, /Recently Deleted/)
    assert.match(message, /Restore that borrower/)
  })

  test('the noun follows the kind, so a lender is not called a borrower', () => {
    assert.match(duplicateMessage('lender', angel, false), /already a lender/)
    assert.match(duplicateMessage('lender', angel, true), /Restore that lender/)
  })

  test('the name is named, so the Admin knows which entry was refused', () => {
    assert.match(duplicateMessage('borrower', { firstName: 'Rica', lastName: 'Santos' }, false), /Rica Santos/)
  })
})

describe('refusing a restore that would collide', () => {
  // The create path deliberately lets a name through while its owner sits in
  // Recently Deleted. Restore is where that permission comes due, so its
  // message has to say what to do about the pair rather than repeat "already
  // exists" at somebody holding two rows.
  test('names the clash and says what to do about it', () => {
    const message = restoreBlockedMessage('borrower', angel)
    assert.match(message, /already a borrower called Angel Cruz/)
    assert.match(message, /Rename one of them before restoring/)
  })

  test('works for lenders too', () => {
    assert.match(restoreBlockedMessage('lender', angel), /already a lender called Angel Cruz/)
  })

  // Distinct wording is the point: these two refusals are reached from
  // different screens and ask for different actions.
  test('is not the same sentence as an ordinary duplicate', () => {
    assert.notEqual(restoreBlockedMessage('borrower', angel), duplicateMessage('borrower', angel, false))
    assert.notEqual(restoreBlockedMessage('borrower', angel), duplicateMessage('borrower', angel, true))
  })
})

describe('no screen copy says "you"', () => {
  // CONVENTIONS.md: the app addresses the Admin, never "you". These strings go
  // straight to a form, so the rule applies to them.
  const every = [
    duplicateMessage('borrower', angel, false),
    duplicateMessage('borrower', angel, true),
    duplicateMessage('lender', angel, false),
    duplicateMessage('lender', angel, true),
    restoreBlockedMessage('borrower', angel),
    restoreBlockedMessage('lender', angel),
  ]

  test('and none contains an em dash', () => {
    for (const message of every) {
      assert.doesNotMatch(message, /\byou\b/i, message)
      assert.doesNotMatch(message, /—/, message)
    }
  })
})
