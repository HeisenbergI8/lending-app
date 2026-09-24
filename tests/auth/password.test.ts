import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPassword,
  verifyPassword,
  fakeVerifyPassword,
  newPasswordProblem,
} from '../../src/server/auth/password.ts'

describe('password hashing', () => {
  test('a correct password verifies', async () => {
    const hash = await hashPassword('correct horse battery staple')
    assert.equal(await verifyPassword('correct horse battery staple', hash), true)
  })

  test('a wrong password does not', async () => {
    const hash = await hashPassword('correct horse battery staple')
    assert.equal(await verifyPassword('Correct horse battery staple', hash), false)
    assert.equal(await verifyPassword('', hash), false)
    assert.equal(await verifyPassword('correct horse battery stapl', hash), false)
  })

  test('the same password hashes differently every time', async () => {
    // Per-password salt. Without it, two accounts sharing a password would share
    // a hash, and cracking one would unlock both.
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    assert.notEqual(a, b)
    assert.equal(await verifyPassword('same-password', a), true)
    assert.equal(await verifyPassword('same-password', b), true)
  })

  test('the plaintext never appears in the stored hash', async () => {
    const hash = await hashPassword('hunter2')
    assert.ok(!hash.includes('hunter2'))
  })

  test('the stored format is scrypt:salt:hash', async () => {
    const parts = (await hashPassword('x')).split(':')
    assert.equal(parts.length, 3)
    assert.equal(parts[0], 'scrypt')
    assert.equal(parts[1].length, 32) // 16 salt bytes as hex
    assert.equal(parts[2].length, 128) // 64 key bytes as hex
  })

  test('unicode and very long passwords work', async () => {
    for (const password of ['pasáword-ñ-😀', 'a'.repeat(1000)]) {
      const hash = await hashPassword(password)
      assert.equal(await verifyPassword(password, hash), true)
    }
  })

  describe('a corrupt stored hash fails the login rather than crashing', () => {
    const broken = [
      '',
      'not-a-hash',
      'scrypt:only-two-parts',
      'bcrypt:abc:def',
      'scrypt::',
      'scrypt:abcd:tooshort',
      'scrypt:abcd:' + 'zz'.repeat(64), // not valid hex
    ]
    for (const stored of broken) {
      test(JSON.stringify(stored.slice(0, 30)), async () => {
        assert.equal(await verifyPassword('anything', stored), false)
      })
    }
  })

  test('fakeVerifyPassword always fails but still does the work', async () => {
    // Exists so a missing username costs the same time as a wrong password.
    // Returning early would let an attacker enumerate real usernames by timing.
    const started = process.hrtime.bigint()
    assert.equal(await fakeVerifyPassword('anything'), false)
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
    assert.ok(elapsedMs > 1, `expected real work, took ${elapsedMs}ms`)
  })
})

describe('the rules for a new password', () => {
  const good = 'a-long-enough-one'

  test('a valid change has no problem', () => {
    assert.equal(newPasswordProblem('old-password', good, good), null)
  })

  test('every box is required', () => {
    assert.ok(newPasswordProblem('', good, good))
    assert.ok(newPasswordProblem('old-password', '', ''))
    assert.ok(newPasswordProblem('old-password', good, ''))
  })

  test('the new one must be at least eight characters', () => {
    assert.ok(newPasswordProblem('old-password', 'short12', 'short12'))
    assert.equal(newPasswordProblem('old-password', 'exactly8', 'exactly8'), null)
  })

  test('the confirmation must match, character for character', () => {
    assert.ok(newPasswordProblem('old-password', good, good + ' '))
    assert.ok(newPasswordProblem('old-password', good, good.toUpperCase()))
  })

  test('the new one must differ from the current one', () => {
    assert.ok(newPasswordProblem(good, good, good))
  })

  test('surrounding spaces are part of the password', () => {
    // Not trimmed anywhere in the change, so " secret123" and "secret123" are
    // two different passwords here and at the sign in screen alike.
    assert.equal(newPasswordProblem('old-password', ' secret123', ' secret123'), null)
    assert.ok(newPasswordProblem('old-password', ' secret123', 'secret123'))
  })
})
