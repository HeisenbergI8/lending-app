import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { amountsSaid, closestNames, distance, nameSaid, nameScore } from '../../src/server/assistant/names.ts'

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

describe('what the Admin actually said', () => {
  test('amounts in every common form', () => {
    assert.deepEqual(amountsSaid('lend bea 20k'), [20000])
    assert.deepEqual(amountsSaid('₱20,000.50 from john'), [20000.5])
    assert.deepEqual(amountsSaid('twenty thousand from john ross'), [20000])
    assert.deepEqual(amountsSaid('15 thousand, 10k each'), [15000, 10000])
  })
  test('a person is named by first or last name, with one typo allowed', () => {
    const rico = { firstName: 'Rico', lastName: 'Mendoza' }
    assert.equal(nameSaid('lend rico 5k', rico), true)
    assert.equal(nameSaid('mendosa paid today', rico), true)
    assert.equal(nameSaid('lend lyn 5k from maria', rico), false)
  })
})

describe('number words next to names', () => {
  test('"lend bea twenty thousand" is 20,000', () => assert.deepEqual(amountsSaid('lend bea twenty thousand from john ross'), [20000]))
  test('"lend twenty five thousand" is 25,000', () => assert.deepEqual(amountsSaid('lend twenty five thousand'), [25000]))
})
