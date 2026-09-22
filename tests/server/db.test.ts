import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The db proxy must hand out ONE client, in every environment.
 *
 * This exists because it did not. The cache was skipped when NODE_ENV was
 * 'production', so each property access built a fresh client with its own
 * connection pool: `db.$transaction(...)` opened a transaction on one client
 * and the writes inside it ran against another, which answered "Transaction
 * not found. Transaction ID is invalid". Marking a loan paid failed in
 * production and only in production — dev was the one environment that cached.
 *
 * Two reads of the same model delegate coming back as the same object is the
 * cheapest proof of one instance: Prisma builds a delegate per client, so two
 * clients cannot produce one object.
 *
 * NODE_ENV is set per import rather than once, because the module memoises on
 * globalThis and would otherwise answer from the first test's cache.
 */

const freshDb = async (nodeEnv: string) => {
  // Next's types declare NODE_ENV read-only, which is right everywhere except
  // here: the whole point of this test is to import the module under each one.
  ;(process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:6543/postgres'
  delete (globalThis as { prisma?: unknown }).prisma
  // A query string Node has not seen before, so the module is evaluated again
  // and its memo starts empty.
  const mod = await import(`../../src/server/db.ts?env=${nodeEnv}-${Math.random()}`)
  return mod.db
}

describe('the Prisma client is a singleton', () => {
  test('in production — the environment where a second client broke transactions', async () => {
    const db = await freshDb('production')
    assert.equal(db.payment, db.payment)
    assert.equal(db.loan, db.loan)
  })

  test('in development', async () => {
    const db = await freshDb('development')
    assert.equal(db.payment, db.payment)
  })

  test('across the separate accesses a transaction actually makes', async () => {
    const db = await freshDb('production')
    // $transaction is read, then the delegate the callback writes through: two
    // trips through the proxy, which must land on the same engine.
    assert.equal(typeof db.$transaction, 'function')
    assert.equal(db.payment, db.payment)
    assert.equal(db.proofFile, db.proofFile)
  })
})
