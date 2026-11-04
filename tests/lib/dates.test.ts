import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatListDate, spellDate, spellDatesIn } from '../../src/lib/dates.ts'

const today = new Date(2026, 8, 30)

test('this year drops the year', () => {
  assert.equal(formatListDate(new Date(2026, 8, 13), today), 'Sep 13')
})

test('another year keeps its real year', () => {
  assert.equal(formatListDate(new Date(2026, 11, 20), new Date(2027, 0, 5)), 'Dec 20, 2026')
  assert.equal(formatListDate(new Date(2027, 0, 3), today), 'Jan 3, 2027')
})

describe('spelled-out dates in Dex-E answers', () => {
  test('a stored day reads as November 01, 2026', () => {
    assert.equal(spellDate('2026-11-01'), 'November 01, 2026')
    assert.equal(spellDate('2026-12-31'), 'December 31, 2026')
  })
  test('every date in an answer, the non-breaking hyphen the model sometimes writes included', () => {
    assert.equal(spellDatesIn('due 2026‑11‑26, paid 2026-10-05.'), 'due November 26, 2026, paid October 05, 2026.')
  })
  test('something that is not a real date is left alone', () => assert.equal(spellDate('2026-13-40'), '2026-13-40'))
})
