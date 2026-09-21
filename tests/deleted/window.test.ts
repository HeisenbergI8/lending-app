import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { PURGE_AFTER_DAYS, daysUntilPurge, purgeCutoff } from '../../src/server/deleted/window.ts'

/**
 * The thirty-day promise, checked from both ends.
 *
 * These two functions are the only place the window is expressed, and they are
 * read by two parties who must never disagree: the screen telling the admin how
 * long they have, and the purge deciding what to destroy. A row the screen says
 * has a day left must not be a row the purge is willing to take.
 */

const DAY_MS = 86_400_000
const now = new Date('2026-09-21T12:00:00.000Z')
const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY_MS - hours * 3_600_000)

describe('daysUntilPurge — what the screen tells the admin', () => {
  test('a row deleted just now has the full window', () => {
    assert.equal(daysUntilPurge(now, now), PURGE_AFTER_DAYS)
  })

  test('counts down a day at a time', () => {
    assert.equal(daysUntilPurge(ago(1), now), 29)
    assert.equal(daysUntilPurge(ago(29), now), 1)
  })

  test('rounds part-days UP, so the last hours still read as a day left', () => {
    assert.equal(daysUntilPurge(ago(29, 13), now), 1)
  })

  test('never goes below zero, however long something has sat there', () => {
    assert.equal(daysUntilPurge(ago(30), now), 0)
    assert.equal(daysUntilPurge(ago(400), now), 0)
  })
})

describe('purgeCutoff — what the purge is willing to destroy', () => {
  test('is exactly the window behind now', () => {
    assert.equal(purgeCutoff(now).getTime(), now.getTime() - PURGE_AFTER_DAYS * DAY_MS)
  })

  test('agrees with the screen: nothing showing days left is ever past the cutoff', () => {
    const cutoff = purgeCutoff(now)
    for (const days of [0, 1, 15, 29]) {
      const deletedAt = ago(days)
      assert.ok(daysUntilPurge(deletedAt, now) > 0, `${days} days old should still show a countdown`)
      assert.ok(deletedAt >= cutoff, `${days} days old should be safe from the purge`)
    }
  })

  test('and the reverse: anything past the cutoff has already reached zero', () => {
    const cutoff = purgeCutoff(now)
    for (const days of [31, 90]) {
      const deletedAt = ago(days)
      assert.ok(deletedAt < cutoff, `${days} days old should be purgeable`)
      assert.equal(daysUntilPurge(deletedAt, now), 0)
    }
  })

  /**
   * The boundary falls on the side of keeping the row.
   *
   * At exactly thirty days deletedAt EQUALS the cutoff, and the purge filters on
   * `lt`, so it survives until the next day's run. The screen has already
   * stopped promising it any days, which is the honest way round: a countdown
   * that reads zero on something still present is a warning, where a countdown
   * reading "1 day" on something already destroyed would be a lie.
   */
  test('a row at exactly the window survives one more run', () => {
    const deletedAt = ago(PURGE_AFTER_DAYS)
    assert.equal(deletedAt.getTime(), purgeCutoff(now).getTime())
    assert.ok(!(deletedAt < purgeCutoff(now)))
    assert.equal(daysUntilPurge(deletedAt, now), 0)
  })
})
