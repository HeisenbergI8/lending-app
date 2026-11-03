import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { manilaToday, trimHistory } from '../../src/server/assistant/chat.ts'

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
