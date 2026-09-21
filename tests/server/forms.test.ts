import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { amount, date, personName, text } from '../../src/server/forms.ts'

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

describe('text fields', () => {
  test('a missing field is an empty string, never "undefined"', () => {
    assert.equal(text(form({}), 'note'), '')
  })

  test('surrounding whitespace is trimmed', () => {
    assert.equal(text(form({ note: '  Initial capital  ' }), 'note'), 'Initial capital')
  })
})

describe('amounts a person typed', () => {
  test('plain pesos become centavos', () => {
    const result = amount(form({ amount: '30000' }), 'amount')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 3_000_000)
  })

  test('the commas and the peso sign people actually type are accepted', () => {
    const result = amount(form({ amount: '₱30,000.50' }), 'amount')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 3_000_050)
  })

  test('zero is refused — it is not a transaction', () => {
    const result = amount(form({ amount: '0' }), 'amount')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /greater than zero/)
  })

  test('a negative amount is refused rather than flipped', () => {
    // Money out is a WITHDRAWAL row, not a negative deposit. Accepting a minus
    // sign here would put the direction in two places at once.
    const result = amount(form({ amount: '-500' }), 'amount')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /greater than zero/)
  })

  test('a third decimal place is refused, not rounded away', () => {
    const result = amount(form({ amount: '100.005' }), 'amount')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /two decimal places/)
  })

  test('nonsense gets an error that says what to type instead', () => {
    const result = amount(form({ amount: 'a lot' }), 'amount')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /like 30000/)
  })

  test('an empty field asks for an amount rather than storing zero', () => {
    const result = amount(form({ amount: '' }), 'amount')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /Enter an amount/)
  })
})

describe('dates from <input type="date">', () => {
  test('"2026-09-21" is 21 September 2026 in the admin’s own calendar', () => {
    const result = date(form({ occurredOn: '2026-09-21' }), 'occurredOn')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.getFullYear(), 2026)
      assert.equal(result.value.getMonth(), 8)
      assert.equal(result.value.getDate(), 21)
    }
  })

  test('it is carried at midday, so storing it cannot move it a day', () => {
    // A Postgres `date` column takes the UTC calendar day of the instant it is
    // given. Local midnight in Manila is the previous day in UTC, which is
    // exactly how every date in the app once landed a day early.
    const result = date(form({ occurredOn: '2026-01-05' }), 'occurredOn')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.getHours(), 12)
  })

  test('an empty or malformed date is refused', () => {
    for (const value of ['', '21/09/2026', '2026-9-21', 'today']) {
      const result = date(form({ occurredOn: value }), 'occurredOn')
      assert.equal(result.ok, false, `expected "${value}" to be refused`)
    }
  })

  test('a date that does not exist is refused', () => {
    const result = date(form({ occurredOn: '2026-02-31' }), 'occurredOn')
    assert.equal(result.ok, false)
  })
})

describe('names', () => {
  test('both halves are required', () => {
    const partial: Record<string, string>[] = [{ firstName: 'Angel' }, { lastName: 'Dela Cruz' }, {}]
    for (const fields of partial) {
      const result = personName(form(fields))
      assert.equal(result.ok, false)
    }
  })

  test('whitespace alone is not a name', () => {
    const result = personName(form({ firstName: '   ', lastName: 'Cruz' }))
    assert.equal(result.ok, false)
  })

  test('a name is trimmed on the way in', () => {
    const result = personName(form({ firstName: ' Angel ', lastName: ' Dela Cruz ' }))
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.value, { firstName: 'Angel', lastName: 'Dela Cruz' })
  })

  test('an absurdly long name is refused before it reaches the database', () => {
    const result = personName(form({ firstName: 'a'.repeat(81), lastName: 'Cruz' }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /too long/)
  })
})
