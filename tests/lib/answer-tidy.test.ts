import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { tidyAnswer } from '../../src/lib/answer-tidy.ts'

describe('small slips in an AI answer', () => {
  test('the answer seen on the testing link: said twice, glued with no space', () => {
    assert.equal(
      tidyAnswer('John Ross Rivera is the nearest due on borrowers.John Ross Rivera is the nearest due on borrowers.'),
      'John Ross Rivera is the nearest due on borrowers.',
    )
  })
  test('a missing space after a stop is put back', () => assert.equal(tidyAnswer('Angel owes ₱57,600.00.It is due soon.'), 'Angel owes ₱57,600.00. It is due soon.'))
  test('amounts and short forms are left alone', () => {
    assert.equal(tidyAnswer('Angel owes ₱57,600.00 in all.'), 'Angel owes ₱57,600.00 in all.')
    assert.equal(tidyAnswer('Pay by cash, e.g. GCash.'), 'Pay by cash, e.g. GCash.')
  })
  test('a line said twice in a row is said once; the layout lines stay', () => {
    assert.equal(tidyAnswer('Angel owes ₱57,600.00.\n- Due: November 26, 2026\n- Due: November 26, 2026'), 'Angel owes ₱57,600.00.\n- Due: November 26, 2026')
    assert.equal(tidyAnswer('Two loans.\n- Rico: ₱10,000.00\n- Lyn: ₱10,000.00'), 'Two loans.\n- Rico: ₱10,000.00\n- Lyn: ₱10,000.00')
  })
})
