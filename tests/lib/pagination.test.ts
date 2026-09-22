import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { PAGE_SIZE, pageCount, pageRange, pagedHref, parsePage } from '../../src/lib/pagination.ts'

describe('parsePage — reading ?page= out of the URL', () => {
  test('no page parameter is page 1, skipping nothing', () => {
    assert.deepEqual(parsePage(undefined), { page: 1, skip: 0, take: PAGE_SIZE })
  })

  test('page 3 skips the two pages before it', () => {
    assert.deepEqual(parsePage('3', 20), { page: 3, skip: 40, take: 20 })
  })

  // A hand-edited or stale URL shows the list, it does not throw an error page.
  for (const junk of ['', '   ', 'two', '0', '-4', '1.5', 'NaN', 'Infinity', '1e999']) {
    test(`"${junk}" falls back to page 1`, () => {
      assert.equal(parsePage(junk).page, 1)
    })
  }

  test('a repeated key takes the first value, like the search does', () => {
    assert.equal(parsePage(['2', '9']).page, 2)
  })
})

describe('pageCount', () => {
  test('an empty list is still one page, so "Page 1 of 1" reads normally', () => {
    assert.equal(pageCount(0, 20), 1)
  })

  test('a part-full last page counts', () => {
    assert.equal(pageCount(21, 20), 2)
    assert.equal(pageCount(87, 20), 5)
  })

  test('an exactly-full list does not gain an empty page', () => {
    assert.equal(pageCount(40, 20), 2)
  })
})

describe('pageRange — the bound printed beside the list', () => {
  test('the first page starts at row 1', () => {
    assert.deepEqual(pageRange(1, 87, 20), { first: 1, last: 20 })
  })

  test('a middle page is its own slice', () => {
    assert.deepEqual(pageRange(2, 87, 20), { first: 21, last: 40 })
  })

  // The last page must not promise rows that are not there.
  test('the last page stops at the total', () => {
    assert.deepEqual(pageRange(5, 87, 20), { first: 81, last: 87 })
  })

  test('an empty list ranges over nothing', () => {
    assert.deepEqual(pageRange(1, 0, 20), { first: 0, last: 0 })
  })
})

describe('pagedHref — one page number per list on a screen that holds several', () => {
  const href = pagedHref('/lenders/abc', { out: '3', withdrawn: '2' })

  test('paging one list leaves the others where they were', () => {
    assert.equal(href('in', 'money-in')(4), '/lenders/abc?out=3&withdrawn=2&in=4#money-in')
  })

  test('its own key is replaced, not repeated', () => {
    assert.equal(href('out', 'out-with')(5), '/lenders/abc?withdrawn=2&out=5#out-with')
  })

  // Page 1 is the default, so going back to it drops the key rather than
  // leaving ?out=1 behind in the URL.
  test('page 1 drops the key', () => {
    assert.equal(href('out', 'out-with')(1), '/lenders/abc?withdrawn=2#out-with')
  })

  test('with nothing else in the query string the URL is just the anchor', () => {
    assert.equal(pagedHref('/lenders/abc', {})('in', 'money-in')(1), '/lenders/abc#money-in')
  })

  test('a repeated key takes the first value, the same as parsePage', () => {
    assert.equal(
      pagedHref('/lenders/abc', { out: ['3', '9'] })('in', 'money-in')(2),
      '/lenders/abc?out=3&in=2#money-in',
    )
  })
})
