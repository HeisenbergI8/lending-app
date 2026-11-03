import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { closestNames, distance, nameScore } from '../../src/server/assistant/names.ts'

/** The demo account's borrowers (prisma/seed/demo.ts). */
const people = [
  { id: 'angel', firstName: 'Angel', lastName: 'Dela Cruz' },
  { id: 'rico', firstName: 'Rico', lastName: 'Mendoza' },
  { id: 'bea', firstName: 'Bea', lastName: 'Villanueva' },
  { id: 'dan', firstName: 'Dan', lastName: 'Aquino' },
  { id: 'lyn', firstName: 'Lyn', lastName: 'Bautista' },
]
const ids = (typed: string) => closestNames(typed, people).map((p) => p.id)

describe('did you mean', () => {
  test('edit distance', () => {
    assert.equal(distance('ricco', 'rico'), 1)
    assert.equal(distance('mendosa', 'mendoza'), 1)
    assert.equal(distance('same', 'same'), 0)
  })

  test('a misspelled full name finds the real person', () => assert.deepEqual(ids('Ricco Mendosa'), ['rico']))
  test('a misspelled first name alone', () => assert.deepEqual(ids('Angle'), ['angel']))
  test('a misspelled last name alone', () => assert.deepEqual(ids('Villanuava'), ['bea']))
  test('case and accents do not matter', () => assert.deepEqual(ids('BEÁ villanueva'), ['bea']))
  test('a stranger matches nobody', () => assert.deepEqual(ids('Juan Santos'), []))
  test('the exact name scores highest', () => assert.ok(nameScore('Rico Mendoza', people[1]) > nameScore('Ricco Mendosa', people[1])))
})
