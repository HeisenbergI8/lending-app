import { zip } from './xlsx.ts'

/**
 * Writing a plain .docx file, with no library — the same approach as xlsx.ts.
 *
 * A .docx is a ZIP of XML parts, and a document of a title, headings and plain lines
 * needs only three of them. The text before the first ": " on a line is set in
 * bold, which is what makes "NAME:" and "AMOUNT:" read as labels.
 */

export type DocLine =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'line'; text: string }
  | { kind: 'blank' }

/** Characters XML 1.0 has no way to carry. A name pasted from a phone can hold them. */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

function xml(value: string): string {
  return value
    .replace(FORBIDDEN, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function run(text: string, { bold = false, size }: { bold?: boolean; size?: number } = {}): string {
  const props = `${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}`
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`
}

/** Paragraphs sit tight, like typed lines, rather than Word's default spacing. */
const TIGHT = '<w:spacing w:before="0" w:after="0"/>'

function paragraph(line: DocLine): string {
  if (line.kind === 'blank') return `<w:p><w:pPr>${TIGHT}</w:pPr></w:p>`
  if (line.kind === 'heading') return `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>${run(line.text, { bold: true, size: 26 })}</w:p>`
  if (line.kind === 'title') return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${run(line.text, { bold: true, size: 32 })}</w:p>`

  const split = line.text.indexOf(': ')
  const runs =
    split === -1
      ? run(line.text)
      : run(line.text.slice(0, split + 1), { bold: true }) + run(line.text.slice(split + 1))
  return `<w:p><w:pPr>${TIGHT}</w:pPr>${runs}</w:p>`
}

/** The whole document as the bytes of a .docx file. */
export function buildDocument(lines: DocLine[]): Buffer {
  return zip([
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    ],
    [
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${lines.map(paragraph).join('')}` +
        // A4 with one-inch margins; Word falls back to US Letter without it.
        `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
        `</w:body></w:document>`,
    ],
  ])
}
