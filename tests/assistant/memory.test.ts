import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fill, sentenceShape, shapeOf } from '../../src/server/assistant/memory.ts'
import { readTranslation } from '../../src/server/assistant/translate.ts'

const PEOPLE = [
  { firstName: 'Maria', lastName: 'Cruz' },
  { firstName: 'Jun', lastName: 'Reyes' },
  { firstName: 'John Ross', lastName: 'Santos' },
  { firstName: 'Angel', lastName: 'Dela Cruz' },
  { firstName: 'Rico', lastName: 'Mendoza' },
]

describe('memory: a message as a pattern', () => {
  test('names, dates and amounts become slots, in order', () => {
    const s = shapeOf('magkano tubo ni maria nung October?', PEOPLE)
    assert.equal(s.pattern, 'magkano tubo ni {p1} nung {d1}')
    assert.deepEqual(s.slots, { p: ['Maria Cruz'], d: ['october'], n: [] })
  })
  test('a full name and a whole month', () => {
    const s = shapeOf('How much did john ross potential earnings from interest for this whole month', PEOPLE)
    assert.equal(s.pattern, 'how much did {p1} potential earnings from interest for {d1}')
    assert.deepEqual(s.slots.p, ['John Ross Santos'])
  })
  test('a last name two people share is not a name slot on its own', () => {
    assert.deepEqual(shapeOf('how much does cruz owe', PEOPLE).slots.p, [])
  })
  test('the same kind of question has the same pattern', () => {
    assert.equal(shapeOf('magkano tubo ni jun nung november', PEOPLE).pattern, shapeOf('magkano tubo ni Maria nung October', PEOPLE).pattern)
  })
})

describe("memory: the server's sentence with the same slots", () => {
  const s = shapeOf('magkano tubo ni maria nung october', PEOPLE)
  test('kept when every name and date came from the message', () => {
    assert.equal(sentenceShape('how much did Maria Cruz earn October', s.slots, PEOPLE), 'how much did {p1} earn {d1}')
  })
  test('not kept when it says a name the message did not', () => {
    assert.equal(sentenceShape('how much did Jun Reyes earn October', s.slots, PEOPLE), null)
  })
  test('not kept when it adds a number', () => {
    assert.equal(sentenceShape('how much did Maria Cruz earn October 2026', s.slots, PEOPLE), null)
  })
  test('filled from a new message', () => {
    const next = shapeOf('magkano tubo ni jun nung november', PEOPLE)
    assert.equal(fill('how much did {p1} earn {d1}', next.slots), 'how much did Jun Reyes earn november')
  })
})

describe('translator reply', () => {
  test('a clean reply', () => {
    assert.deepEqual(readTranslation('{"kind":"ask","say":"how much did Maria Cruz earn this month","options":[],"understood":"Interest earned · Maria Cruz"}'), { kind: 'ask', say: 'how much did Maria Cruz earn this month', options: [], understood: 'Interest earned · Maria Cruz' })
  })
  test('text around the JSON is ignored', () => assert.equal(readTranslation('Sure: {"kind":"other","say":""} done')?.kind, 'other'))
  test('a question with nothing to say is not usable', () => assert.equal(readTranslation('{"kind":"ask","say":""}'), null))
  test('not JSON', () => assert.equal(readTranslation('I think you mean earnings'), null))
})
