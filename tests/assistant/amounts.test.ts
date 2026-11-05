import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { partOf, readAmountSpec } from '../../src/server/assistant/amounts.ts'
import { readTranslation } from '../../src/server/assistant/translate.ts'

describe('amounts said as part of a figure', () => {
  test('shares in words and numbers', () => {
    assert.equal(partOf('all'), 1)
    assert.equal(partOf('half'), 0.5)
    assert.equal(partOf('kalahati'), 0.5)
    assert.equal(partOf(0.25), 0.25)
    assert.equal(partOf('30%'), 0.3)
    assert.equal(partOf(undefined), 1)
    assert.equal(partOf('a lot'), null)
    assert.equal(partOf(250), null)
  })
  test('a lookup is a known figure, a name and a share', () => {
    assert.deepEqual(readAmountSpec({ of: 'floating', who: 'John Ross Rivera', part: 'all' }), { of: 'floating', who: 'John Ross Rivera', part: 1 })
    assert.equal(readAmountSpec({ of: 'salary', who: 'John Ross Rivera' }), null)
    assert.equal(readAmountSpec({ of: 'floating', who: '' }), null)
  })
  test('a translation with {amount} needs its lookup', () => {
    const ok = readTranslation('{"kind":"change","say":"lend Aby Yamio {amount} from John Ross Rivera for 2 weeks","amount":{"of":"floating","who":"John Ross Rivera","part":"all"}}')
    assert.equal(ok?.amount?.of, 'floating')
    assert.equal(readTranslation('{"kind":"change","say":"lend Aby Yamio {amount} from John Ross Rivera"}'), null)
  })
})

describe('a share of a pot said in words', async () => {
  const { potShareSaid } = await import('../../src/server/assistant/server-cards.ts')
  test('all, half, a percent, Taglish', () => {
    assert.equal(potShareSaid('Lend all the remaining floating amount of john ross to aby yamio'), 1)
    assert.equal(potShareSaid("lend rico half of maria's floating for 2 weeks"), 0.5)
    assert.equal(potShareSaid("take out 30% of maria's money"), 0.3)
    assert.equal(potShareSaid('pahiram lahat ng natitira ni maria kay angel'), 1)
    assert.equal(potShareSaid('withdraw everything from jun'), 1)
  })
  test('an amount said plainly is no share', () => assert.equal(potShareSaid('lend rico 5k from maria'), null))
})
