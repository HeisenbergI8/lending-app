import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  verdictFor,
  describeRetryAfter,
  identifierFor,
  ipHashFor,
  WINDOW_MS,
  MAX_ATTEMPTS_PER_PAIR,
} from '../../src/server/auth/rate-limit.ts'

const NOW = new Date('2026-09-21T12:00:00Z')
const agoMs = (ms: number) => new Date(NOW.getTime() - ms)
const minutes = (n: number) => n * 60_000

describe('the policy', () => {
  test('no attempts means not blocked', () => {
    assert.deepEqual(verdictFor([], MAX_ATTEMPTS_PER_PAIR, NOW), { blocked: false })
  })

  test('one under the limit is still allowed', () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS_PER_PAIR - 1 }, () => agoMs(minutes(1)))
    assert.equal(verdictFor(attempts, MAX_ATTEMPTS_PER_PAIR, NOW).blocked, false)
  })

  test('hitting the limit blocks', () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS_PER_PAIR }, () => agoMs(minutes(1)))
    assert.equal(verdictFor(attempts, MAX_ATTEMPTS_PER_PAIR, NOW).blocked, true)
  })

  test('attempts older than the window do not count', () => {
    const stale = Array.from({ length: 50 }, () => agoMs(WINDOW_MS + minutes(1)))
    assert.equal(verdictFor(stale, MAX_ATTEMPTS_PER_PAIR, NOW).blocked, false)
  })

  test('a mix of stale and recent counts only the recent', () => {
    const attempts = [
      ...Array.from({ length: 20 }, () => agoMs(WINDOW_MS + minutes(5))),
      ...Array.from({ length: MAX_ATTEMPTS_PER_PAIR - 1 }, () => agoMs(minutes(2))),
    ]
    assert.equal(verdictFor(attempts, MAX_ATTEMPTS_PER_PAIR, NOW).blocked, false)
  })
})

describe('the lockout runs from the OLDEST attempt in the window', () => {
  // Counting from the newest would let someone extend their own lockout forever
  // by retrying, and would punish a legitimate user far longer than intended.
  test('a full window of old-but-recent attempts releases soon', () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS_PER_PAIR }, () => agoMs(minutes(14)))
    const verdict = verdictFor(attempts, MAX_ATTEMPTS_PER_PAIR, NOW)
    assert.equal(verdict.blocked, true)
    if (verdict.blocked) {
      assert.ok(verdict.retryAfterMs <= minutes(1) + 1, `got ${verdict.retryAfterMs}ms`)
    }
  })

  test('retrying while locked out does not extend the lockout', () => {
    const oldest = agoMs(minutes(10))
    const withoutRetry = [oldest, ...Array.from({ length: 4 }, () => agoMs(minutes(9)))]
    const withRetry = [...withoutRetry, agoMs(0), agoMs(0), agoMs(0)]

    const a = verdictFor(withoutRetry, MAX_ATTEMPTS_PER_PAIR, NOW)
    const b = verdictFor(withRetry, MAX_ATTEMPTS_PER_PAIR, NOW)
    assert.equal(a.blocked, true)
    assert.equal(b.blocked, true)
    if (a.blocked && b.blocked) assert.equal(a.retryAfterMs, b.retryAfterMs)
  })

  test('the delay is never negative', () => {
    const attempts = Array.from({ length: 10 }, () => agoMs(WINDOW_MS - 1))
    const verdict = verdictFor(attempts, MAX_ATTEMPTS_PER_PAIR, NOW)
    if (verdict.blocked) assert.ok(verdict.retryAfterMs >= 0)
  })
})

describe('identifiers leak nothing', () => {
  test('the username does not appear in its identifier', () => {
    const id = identifierFor('immanuel', '203.0.113.7')
    assert.ok(!id.includes('immanuel'))
    assert.ok(!id.includes('203.0.113.7'))
    assert.equal(id.length, 64)
  })

  test('the IP does not appear in its hash', () => {
    const hash = ipHashFor('203.0.113.7')
    assert.ok(!hash.includes('203.0.113.7'))
    assert.equal(hash.length, 64)
  })

  test('username matching ignores case, so Demo and demo share a budget', () => {
    assert.equal(identifierFor('Demo', '1.2.3.4'), identifierFor('demo', '1.2.3.4'))
    assert.equal(identifierFor('DEMO', '1.2.3.4'), identifierFor('demo', '1.2.3.4'))
  })

  test('different users from the same address get separate budgets', () => {
    assert.notEqual(identifierFor('a', '1.2.3.4'), identifierFor('b', '1.2.3.4'))
  })

  test('the same user from different addresses gets separate budgets', () => {
    assert.notEqual(identifierFor('a', '1.2.3.4'), identifierFor('a', '5.6.7.8'))
  })
})

describe('the message a person reads', () => {
  test('rounds up to whole minutes', () => {
    assert.equal(describeRetryAfter(0), 'in about a minute')
    assert.equal(describeRetryAfter(30_000), 'in about a minute')
    assert.equal(describeRetryAfter(minutes(1)), 'in about a minute')
    assert.equal(describeRetryAfter(minutes(1) + 1), 'in about 2 minutes')
    assert.equal(describeRetryAfter(minutes(14)), 'in about 14 minutes')
  })
})
