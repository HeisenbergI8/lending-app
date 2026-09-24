import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'

import { buildWorkbook, excelSerialDate, type Sheet } from '../../src/server/reports/xlsx.ts'

/**
 * The file is written by hand, so these tests do what a spreadsheet program
 * would: unzip it and read the parts back. A workbook Excel refuses to open
 * fails silently everywhere else — it typechecks, it downloads, and the Admin
 * finds out a month later that the backup is unreadable.
 */

/** The named part's XML, read back out of the archive the way any reader would. */
function part(book: Buffer, path: string): string {
  const name = Buffer.from(path, 'utf8')
  let offset = 0

  while (offset < book.length - 4) {
    if (book.readUInt32LE(offset) !== 0x04034b50) break
    const nameLength = book.readUInt16LE(offset + 26)
    const extraLength = book.readUInt16LE(offset + 28)
    const compressed = book.readUInt32LE(offset + 18)
    const start = offset + 30 + nameLength + extraLength

    if (book.subarray(offset + 30, offset + 30 + nameLength).equals(name)) {
      return inflateRawSync(book.subarray(start, start + compressed)).toString('utf8')
    }
    offset = start + compressed
  }

  throw new Error(`no part named ${path}`)
}

const sheet = (overrides: Partial<Sheet> = {}): Sheet => ({
  name: 'Loans',
  columns: [
    { header: 'Borrower', type: 'text', width: 20 },
    { header: 'Capital', type: 'money', width: 14 },
  ],
  rows: [['Angel dela Cruz', 300]],
  ...overrides,
})

describe('the archive itself', () => {
  const book = buildWorkbook([sheet()])

  test('starts with the ZIP signature, which is what makes it an .xlsx', () => {
    assert.equal(book.readUInt32LE(0), 0x04034b50)
  })

  test('carries the six parts a reader looks for', () => {
    for (const path of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      assert.ok(part(book, path).startsWith('<?xml'), `${path} is not XML`)
    }
  })

  test('the same data twice produces the same bytes', () => {
    assert.ok(book.equals(buildWorkbook([sheet()])))
  })
})

describe('cells', () => {
  const book = buildWorkbook([
    sheet({
      columns: [
        { header: 'Borrower', type: 'text', width: 20 },
        { header: 'Capital', type: 'money', width: 14 },
        { header: 'Rate', type: 'percent', width: 10 },
      ],
      rows: [
        ['Angel & "co" <PH>', 30_000, 0.07],
        // A blank is a blank. A loan with no rate agreed must not read as 0%.
        ['Juan Santos', null, null],
      ],
    }),
  ])
  const xml = part(book, 'xl/worksheets/sheet1.xml')

  test('a number is written as a number, so Excel can add the column up', () => {
    assert.match(xml, /<c r="B2" s="2"><v>30000<\/v><\/c>/)
  })

  test('text that looks like markup is escaped rather than breaking the file', () => {
    assert.match(xml, /Angel &amp; "co" &lt;PH&gt;/)
  })

  test('a null writes no cell at all', () => {
    assert.doesNotMatch(xml, /r="B3"/)
    assert.doesNotMatch(xml, /r="C3"/)
  })

  test('the header row is frozen and the columns are filterable', () => {
    assert.match(xml, /state="frozen"/)
    assert.match(xml, /<autoFilter ref="A1:C3"\/>/)
  })
})

describe('sheet names, which Excel is strict about', () => {
  test('banned characters are replaced and the name is capped at 31', () => {
    const book = buildWorkbook([sheet({ name: 'Pending: loans / requests [all of them]' })])
    const name = /name="([^"]*)"/.exec(part(book, 'xl/workbook.xml'))?.[1]
    assert.equal(name, 'Pending  loans   requests  all')
    assert.ok(!/[\\/?*[\]:]/.test(name!))
  })

  test('two sheets cannot end up sharing one name', () => {
    const book = buildWorkbook([sheet({ name: 'Loans' }), sheet({ name: 'Loans' })])
    const names = [...part(book, 'xl/workbook.xml').matchAll(/name="([^"]*)"/g)].map((m) => m[1])
    assert.deepEqual(names, ['Loans', 'Loans (2)'])
  })
})

describe('dates', () => {
  // Excel's own numbering, and the one date everybody checks it against.
  test('1 January 1970 is serial 25569', () => {
    assert.equal(excelSerialDate(new Date(1970, 0, 1)), 25_569)
  })

  test('a day is one apart from the day before it', () => {
    assert.equal(
      excelSerialDate(new Date(2026, 8, 24)) - excelSerialDate(new Date(2026, 8, 23)),
      1,
    )
  })

  /**
   * The spring-forward day is 23 hours long. Dividing elapsed milliseconds
   * would put it at 0.958 of a day and land the date on the wrong serial; the
   * local calendar parts cannot.
   */
  test('a clock change does not move a date', () => {
    assert.equal(
      excelSerialDate(new Date(2026, 2, 30)) - excelSerialDate(new Date(2026, 2, 29)),
      1,
    )
  })
})
