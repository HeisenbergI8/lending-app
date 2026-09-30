import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatListDate } from '../../src/lib/dates.ts'

const today = new Date(2026, 8, 30)

test('this year drops the year', () => {
  assert.equal(formatListDate(new Date(2026, 8, 13), today), 'Sep 13')
})

test('another year keeps its real year', () => {
  assert.equal(formatListDate(new Date(2026, 11, 20), new Date(2027, 0, 5)), 'Dec 20, 2026')
  assert.equal(formatListDate(new Date(2027, 0, 3), today), 'Jan 3, 2027')
})
