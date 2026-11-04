import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { amountsSaid, closestNames, distance, looksLikeChangeVerb, maybeNames, nameSaid, nameScore, tokensOf, wordNames } from '../../src/server/assistant/names.ts'

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

describe('a misspelt change verb (kend, mrak) is not part of a name', () => {
  for (const w of ['kend', 'mrak', 'delte', 'restor', 'lned']) test(w, () => assert.equal(looksLikeChangeVerb(w), true))
  test('names and short words are not verbs', () => {
    for (const w of ['rico', 'lyn', 'maria', 'angel', 'and', 'from', 'weeks', 'lopez']) assert.equal(looksLikeChangeVerb(w), false, w)
  })
})

describe('a real word is not a misspelt name', () => {
  const mary = { firstName: 'Mary Joy', lastName: 'Nazaire' }
  const names = (text: string, part: string) => {
    const t = tokensOf(text)
    return t.some((_, i) => wordNames(t, i, part))
  }

  // Seen on the live site 2026-11-04: "how many" was read as Mary Joy Nazaire.
  test('"how many" is never Mary', () => assert.equal(nameSaid('How many are still pending loans?', mary), false))
  test('"how much" is never a name', () => assert.equal(names('how much is out on loan', 'mich'), false))
  test('a real word in a name spot is not guessed, it is asked about', () => {
    assert.equal(nameSaid('lend money to Many', mary), false)
    assert.deepEqual(maybeNames('lend money to Many'), ['many'])
    assert.deepEqual(closestNames('many', [{ id: 'mary', ...mary }]).map((p) => p.id), ['mary'])
  })
  test('a word that is not a real word is still a typo', () => {
    assert.equal(nameSaid('how much does Ricco owe', { firstName: 'Rico', lastName: 'Mendoza' }), true)
    assert.equal(nameSaid('lend mery 5k', mary), true)
  })
  test('the exact name always counts in a name spot', () => assert.equal(nameSaid('lend Mary 5k', mary), true))

  const joy = { firstName: 'Joy', lastName: 'Santos' }
  const may = { firstName: 'May', lastName: 'Reyes' }
  test('a name that is an everyday word counts where a name belongs', () => {
    assert.equal(nameSaid('how much does Joy owe', joy), true)
    assert.equal(nameSaid("Joy's loan", joy), true)
    assert.equal(nameSaid('lend joy 5k', joy), true)
  })
  test('the same word elsewhere is just the word', () => {
    assert.equal(nameSaid('may utang ba si Rico', may), false)
    assert.equal(nameSaid('it was a joy to lend', joy), false)
    assert.equal(nameSaid('may utang ba si May', may), true)
  })

  const mark = { firstName: 'Mark', lastName: 'Lim' }
  test('"mark" the action is not Mark the person', () => {
    assert.equal(names('mark Rico paid', 'mark'), false)
    assert.equal(names('mark Mark paid', 'mark'), true)
    assert.equal(nameSaid('mark rico paid', mark), false)
  })

  test('short names allow no typo', () => {
    assert.equal(names('lend jo 5k', 'al'), false)
    assert.equal(names('lend bee 5k', 'bea'), false)
    assert.equal(names('lend bea 5k', 'bea'), true)
  })
  test('a capital at the start of the sentence proves nothing', () => assert.equal(nameSaid('Many loans are late', mary), false))
  test('a capital mid-sentence marks a name', () => assert.equal(nameSaid('what about Joy', joy), true))
})
