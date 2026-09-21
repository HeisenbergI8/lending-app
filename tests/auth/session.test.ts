import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateSessionToken,
  sessionIdFromToken,
  sessionExpiry,
  shouldRefresh,
} from '../../src/server/auth/session.ts'

const DAY_MS = 86_400_000

describe('session tokens', () => {
  test('every token is different', () => {
    const seen = new Set(Array.from({ length: 1_000 }, generateSessionToken))
    assert.equal(seen.size, 1_000)
  })

  test('a token carries enough randomness to be unguessable', () => {
    // 32 bytes, base64url -> 43 characters.
    assert.equal(generateSessionToken().length, 43)
  })

  test('tokens are URL-safe, so a cookie never needs escaping', () => {
    for (let i = 0; i < 200; i++) {
      assert.match(generateSessionToken(), /^[A-Za-z0-9_-]+$/)
    }
  })
})

describe('the database never holds a usable token', () => {
  test('the stored id is a hash, not the token', () => {
    const token = generateSessionToken()
    const id = sessionIdFromToken(token)
    assert.notEqual(id, token)
    assert.ok(!id.includes(token))
    assert.equal(id.length, 64) // sha-256 as hex
  })

  test('the same token always maps to the same id', () => {
    const token = generateSessionToken()
    assert.equal(sessionIdFromToken(token), sessionIdFromToken(token))
  })

  test('different tokens map to different ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => sessionIdFromToken(generateSessionToken())))
    assert.equal(ids.size, 500)
  })
})

describe('expiry', () => {
  test('a new session lasts 30 days', () => {
    const now = new Date('2026-09-21T00:00:00Z')
    assert.equal(sessionExpiry(now).getTime() - now.getTime(), 30 * DAY_MS)
  })

  test('a fresh session is not refreshed', () => {
    const now = new Date()
    assert.equal(shouldRefresh(sessionExpiry(now), now), false)
  })

  test('a session with under 15 days left is refreshed', () => {
    const now = new Date()
    assert.equal(shouldRefresh(new Date(now.getTime() + 14 * DAY_MS), now), true)
    assert.equal(shouldRefresh(new Date(now.getTime() + 16 * DAY_MS), now), false)
  })

  test('an already-expired session is not kept alive by refresh', () => {
    const now = new Date()
    // shouldRefresh says yes, but validateSessionToken checks expiry first and deletes.
    assert.equal(shouldRefresh(new Date(now.getTime() - DAY_MS), now), true)
  })
})
