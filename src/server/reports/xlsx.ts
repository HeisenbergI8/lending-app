import { deflateRawSync } from 'node:zlib'

/**
 * Writing a real .xlsx file, with no library.
 *
 * An .xlsx is a ZIP of XML parts. The subset a backup needs — text, numbers,
 * dates, a bold frozen header row, a column filter — is small and completely
 * specified, so it is written here rather than pulled in as a dependency the
 * size of the rest of the app. The PDF renderer is the one heavyweight this
 * project carries, and one is enough.
 *
 * NUMBERS ARE WRITTEN AS NUMBERS. A money column holds pesos as a number with a
 * peso format on the cell, not the string "₱30,000.00" — so the Admin can select
 * a column and Excel adds it up. Writing money as text is what turns a
 * spreadsheet into a picture of one.
 *
 * Strings go in the cells themselves (`inlineStr`) rather than through a shared
 * string table. The table saves space on a file with heavy repetition; it also
 * adds a part that has to stay in step with every sheet, which is a way to
 * produce a file Excel refuses to open.
 */

/** What a cell can hold. `null` writes an empty cell — not a zero, and not "N/A". */
export type CellValue = string | number | null

export type ColumnType = 'text' | 'money' | 'date' | 'number' | 'percent'

export type Column = {
  header: string
  type: ColumnType
  /** Rough character width. Excel has no autofit at write time. */
  width: number
}

export type Sheet = {
  name: string
  columns: Column[]
  rows: CellValue[][]
}

/**
 * Cell format slots, matching the order of `<cellXfs>` in the stylesheet below.
 * The indexes are the contract between the two — change one and change both.
 */
const STYLE = { text: 0, header: 1, money: 2, date: 3, number: 4, percent: 5 } as const

/**
 * A calendar date as an Excel serial number: days since 30 December 1899.
 *
 * Read off the date's LOCAL parts, the same way `toDateInput` does, because
 * that is the day the rest of the app shows for the same row. Prisma hands back
 * a `date` column at midnight UTC; taking the UTC parts instead would agree with
 * the database and disagree with every screen.
 *
 * 25569 is 1 January 1970 in Excel's numbering, which counts a 29 February 1900
 * that never happened. Dates before March 1900 are therefore off by one — they
 * are also a century before this ledger exists.
 */
export function excelSerialDate(date: Date): number {
  const days = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  return days + 25_569
}

/** Characters XML 1.0 has no way to carry. A note pasted from a phone can hold them. */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

function xml(value: string): string {
  return value
    .replace(FORBIDDEN, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 1 -> A, 27 -> AA. Sheets here are narrow, but the loop costs nothing. */
function columnLetter(index: number): string {
  let letter = ''
  let n = index
  while (n > 0) {
    const remainder = (n - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

function cell(ref: string, value: CellValue, type: ColumnType): string {
  if (value === null || value === '') return ''

  if (typeof value === 'number') {
    // A date arrives already converted to a serial number; every other numeric
    // type writes itself. A number landing in a text column still gets a number
    // format rather than the text one, so it stays addable.
    const style = STYLE[type === 'text' ? 'number' : type]
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`
  }

  return `<c r="${ref}" s="${STYLE.text}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
}

function sheetXml(sheet: Sheet): string {
  const lastColumn = columnLetter(sheet.columns.length)

  const cols = sheet.columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`,
    )
    .join('')

  const header = sheet.columns
    .map(
      (column, index) =>
        `<c r="${columnLetter(index + 1)}1" s="${STYLE.header}" t="inlineStr"><is><t>${xml(column.header)}</t></is></c>`,
    )
    .join('')

  const body = sheet.rows
    .map((row, rowIndex) => {
      const number = rowIndex + 2
      const cells = sheet.columns
        .map((column, index) =>
          cell(`${columnLetter(index + 1)}${number}`, row[index] ?? null, column.type),
        )
        .join('')
      return `<row r="${number}">${cells}</row>`
    })
    .join('')

  // The header row is frozen and filterable: a backup is a file somebody scrolls
  // and sorts, and a thousand rows with the headings gone off the top is a file
  // nobody can read.
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${lastColumn}${sheet.rows.length + 1}"/>` +
    `</worksheet>`
  )
}

/**
 * Excel refuses a workbook whose sheet names break its rules, and refuses it
 * without saying which name was the problem. Five characters are banned, a name
 * cannot exceed 31 characters, and two sheets cannot share one.
 */
function sheetName(name: string, index: number, taken: Set<string>): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Sheet ${index + 1}`
  if (!taken.has(cleaned.toLowerCase())) {
    taken.add(cleaned.toLowerCase())
    return cleaned
  }
  const suffix = ` (${index + 1})`
  return cleaned.slice(0, 31 - suffix.length) + suffix
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="3">` +
  `<numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/>` +
  `<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/>` +
  `<numFmt numFmtId="166" formatCode="0.00%"/>` +
  `</numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEAEAEA"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  // Order fixed by STYLE above: text, header, money, date, number, percent.
  `<cellXfs count="6">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  // Excel writes this and some readers warn without it; it costs one line.
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`

/** The whole workbook as the bytes of an .xlsx file. */
export function buildWorkbook(sheets: Sheet[]): Buffer {
  const taken = new Set<string>()
  const names = sheets.map((sheet, index) => sheetName(sheet.name, index, taken))

  const sheetTags = names
    .map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')

  const sheetRels = names
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('')

  const overrides = names
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')

  const parts: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `${overrides}</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheetTags}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `${sheetRels}` +
        `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ],
    ['xl/styles.xml', STYLES_XML],
    ...sheets.map((sheet, index): [string, string] => [
      `xl/worksheets/sheet${index + 1}.xml`,
      sheetXml(sheet),
    ]),
  ]

  return zip(parts)
}

// --- ZIP ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * A ZIP archive of the parts, deflated.
 *
 * No timestamps: every field that would carry one is left at zero, so the same
 * data produces the same bytes. A backup taken twice in one minute that differs
 * only in a hidden clock is a backup nobody can compare.
 */
function zip(parts: [string, string][]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const [path, content] of parts) {
    const name = Buffer.from(path, 'utf8')
    const raw = Buffer.from(content, 'utf8')
    const deflated = deflateRawSync(raw)
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // names are UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)

    const entry = Buffer.concat([local, name, deflated])
    locals.push(entry)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4) // version made by
    header.writeUInt16LE(20, 6) // version needed to extract
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(8, 10)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(deflated.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)

    central.push(Buffer.concat([header, name]))
    offset += entry.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(parts.length, 8)
  end.writeUInt16LE(parts.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}
