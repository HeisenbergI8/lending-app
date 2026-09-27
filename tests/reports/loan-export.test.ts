import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'

import { centavos } from '../../src/lib/money/centavos.ts'
import { type LoanExportEntry, formatAmount, loanExportLines } from '../../src/lib/loan-export.ts'
import { buildDocument } from '../../src/server/reports/docx.ts'

const entry = (overrides: Partial<LoanExportEntry> = {}): LoanExportEntry => ({
  borrowerName: 'Arianell Matel',
  startOn: new Date(2026, 8, 22, 12),
  dueOn: new Date(2026, 9, 20, 12),
  termDays: 28,
  borrowerRateBps: 700,
  amount: centavos(2_500_000),
  interest: centavos(700_000),
  adminCut: centavos(0),
  ...overrides,
})

describe('loanExportLines', () => {
  test('matches the requested layout on the Admin’s own money', () => {
    assert.deepEqual(loanExportLines(entry()), [
      'NAME: Arianell Matel',
      'DUE: 09/22 - 10/20 (4weeks 7%)',
      'AMOUNT: 25,000',
      'INTEREST: 7,000',
      'TOTAL: 32,000',
    ])
  })

  test('names the Admin cut beside the interest on another lender’s money', () => {
    assert.equal(loanExportLines(entry({ adminCut: centavos(200_000) }))[3], 'INTEREST: 7,000 (Admin cut: 2,000)')
  })

  test('a term that is not whole weeks, and a fixed-amount loan', () => {
    assert.equal(
      loanExportLines(entry({ termDays: 10, borrowerRateBps: null }))[1],
      'DUE: 09/22 - 10/20 (10days fixed)',
    )
    assert.equal(loanExportLines(entry({ termDays: 7, borrowerRateBps: 650 }))[1], 'DUE: 09/22 - 10/20 (1week 6.5%)')
  })

  test('centavos are kept, never rounded away', () => {
    assert.equal(formatAmount(centavos(123_456_78)), '123,456.78')
    assert.equal(formatAmount(centavos(1_050)), '10.50')
    assert.equal(formatAmount(centavos(100)), '1')
  })
})

describe('buildDocument', () => {
  test('writes a .docx whose body carries the lines, label in bold', () => {
    const file = buildDocument([{ kind: 'title', text: 'Loans & more' }, { kind: 'line', text: 'NAME: A <B>' }])
    // First entry is [Content_Types].xml; find word/document.xml by walking the local headers.
    let offset = 0
    let body = ''
    while (file.readUInt32LE(offset) === 0x04034b50) {
      const nameLength = file.readUInt16LE(offset + 26)
      const size = file.readUInt32LE(offset + 18)
      const name = file.subarray(offset + 30, offset + 30 + nameLength).toString()
      const start = offset + 30 + nameLength
      if (name === 'word/document.xml') body = inflateRawSync(file.subarray(start, start + size)).toString()
      offset = start + size
    }
    assert.match(body, /Loans &amp; more/)
    assert.match(body, /<w:b\/><\/w:rPr><w:t xml:space="preserve">NAME:<\/w:t>/)
    assert.match(body, /A &lt;B&gt;/)
  })
})

describe('export options', () => {
  test('only the known statuses are accepted', async () => {
    const { isLoanExportStatus } = await import('../../src/lib/loan-export.ts')
    assert.ok(isLoanExportStatus('active') && isLoanExportStatus('paid') && isLoanExportStatus('all'))
    assert.ok(!isLoanExportStatus('late'))
  })
})

describe('whose file it is', () => {
  test('the overall file names the lender under the borrower', () => {
    assert.deepEqual(loanExportLines(entry({ lenders: 'Juan Cruz 20,000 + Maria Cruz 5,000' })).slice(0, 3), [
      'NAME: Arianell Matel',
      'LENDER: Juan Cruz 20,000 + Maria Cruz 5,000',
      'DUE: 09/22 - 10/20 (4weeks 7%)',
    ])
  })

  test('a header goes on every page', () => {
    const file = buildDocument([{ kind: 'line', text: 'x' }], { header: 'Juan Cruz · Active loans' })
    const names: string[] = []
    let offset = 0
    let header = ''
    let document = ''
    while (file.readUInt32LE(offset) === 0x04034b50) {
      const nameLength = file.readUInt16LE(offset + 26)
      const size = file.readUInt32LE(offset + 18)
      const name = file.subarray(offset + 30, offset + 30 + nameLength).toString()
      const start = offset + 30 + nameLength
      const body = inflateRawSync(file.subarray(start, start + size)).toString()
      if (name === 'word/header1.xml') header = body
      if (name === 'word/document.xml') document = body
      names.push(name)
      offset = start + size
    }
    assert.ok(names.includes('word/_rels/document.xml.rels'))
    assert.match(header, /Juan Cruz · Active loans/)
    assert.match(document, /<w:headerReference w:type="default" r:id="rIdHeader"\/>/)
  })
})
