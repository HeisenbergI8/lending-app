import path from 'node:path'
import { type DocumentProps, Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { type Centavos, formatPesos } from '../../lib/money/centavos.ts'
import { type LoanState } from '../../lib/loan-state.ts'
import { describeRange } from '../../lib/report-range.ts'
import { describeBytes } from '../../lib/proof.ts'
import { describeTrackRecord } from '../../lib/track-record.ts'
import {
  type BorrowerReport,
  type LenderReport,
  type Report,
  type ReportHeader,
  type SummaryReport,
} from './queries.ts'

/**
 * The reports, as paper.
 *
 * THE FONT IS BUNDLED ON PURPOSE. The PDF standard fonts have no ₱ glyph — a
 * peso amount rendered in Helvetica comes out as "±30,000.00", silently, with
 * no error anywhere. Geist is the app's own typeface, it carries ₱, and reading
 * it off disk means a report renders the same with no network at all.
 *
 * Every peso printed here goes through formatPesos, the same function the
 * screens use. A report is a document somebody is handed; it must not be able to
 * disagree with the screen it came from by a centavo.
 */

const FONTS = path.join(process.cwd(), 'src/server/reports/fonts')

Font.register({
  family: 'Geist',
  fonts: [
    { src: path.join(FONTS, 'Geist-Regular.ttf') },
    { src: path.join(FONTS, 'Geist-SemiBold.ttf'), fontWeight: 600 },
  ],
})

// Names and amounts must never be broken across lines with a hyphen. The default
// callback would turn "Dela Cruz" into "De-la Cruz" in a narrow column.
Font.registerHyphenationCallback((word) => [word])

const INK = '#18181b'
const MUTED = '#71717a'
const LINE = '#e4e4e7'
const LATE = '#b42318'

const styles = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 44, fontFamily: 'Geist', fontSize: 9, color: INK },
  title: { fontSize: 16, fontWeight: 600 },
  subject: { fontSize: 11, marginTop: 2 },
  meta: { fontSize: 8, color: MUTED, marginTop: 4 },
  section: { marginTop: 18 },
  heading: { fontSize: 10, fontWeight: 600, marginBottom: 6 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  figure: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8, minWidth: 110 },
  figureLabel: { fontSize: 7.5, color: MUTED },
  figureValue: { fontSize: 12, fontWeight: 600, marginTop: 2 },
  figureNote: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3 },
  cell: { paddingRight: 6 },
  headCell: { fontSize: 7.5, color: MUTED, fontWeight: 600, paddingRight: 6 },
  empty: { fontSize: 9, color: MUTED, paddingVertical: 6 },
  note: { fontSize: 7.5, color: MUTED, marginTop: 6 },
  late: { color: LATE },
  proof: { fontSize: 7.5, color: MUTED, paddingLeft: 10, paddingTop: 2 },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: MUTED,
  },
})

const STATE_WORD: Record<LoanState, string> = {
  paid: 'Paid',
  overdue: 'Overdue',
  'due-today': 'Due today',
  'due-soon': 'Due soon',
  active: 'Active',
}

const day = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
const stamp = new Intl.DateTimeFormat('en-PH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

type Column = { key: string; label: string; width: number; align?: 'right' }

function Table({
  columns,
  rows,
  empty,
}: {
  columns: Column[]
  rows: { key: string; cells: React.ReactNode[]; under?: React.ReactNode }[]
  empty: string
}) {
  if (rows.length === 0) return <Text style={styles.empty}>{empty}</Text>

  return (
    <View>
      <View style={styles.headRow}>
        {columns.map((column) => (
          <Text
            key={column.key}
            style={[styles.headCell, { width: `${column.width}%`, textAlign: column.align ?? 'left' }]}
          >
            {column.label}
          </Text>
        ))}
      </View>

      {rows.map((row) => (
        <View key={row.key} wrap={false}>
          <View style={styles.row}>
            {row.cells.map((cell, index) => (
              <View
                key={columns[index].key}
                style={[styles.cell, { width: `${columns[index].width}%` }]}
              >
                <Text style={{ textAlign: columns[index].align ?? 'left' }}>{cell}</Text>
              </View>
            ))}
          </View>
          {row.under}
        </View>
      ))}
    </View>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
      {note ? <Text style={styles.figureNote}>{note}</Text> : null}
    </View>
  )
}

function Shell({ header, children }: { header: ReportHeader; children: React.ReactNode }) {
  return (
    <Document
      title={`${header.title}${header.subject ? ` — ${header.subject}` : ''}`}
      author="Lending App"
    >
      <Page size="A4" style={styles.page}>
        <View>
          <Text style={styles.title}>{header.title}</Text>
          {header.subject ? <Text style={styles.subject}>{header.subject}</Text> : null}
          <Text style={styles.meta}>
            {describeRange(header.range)} · prepared {stamp.format(header.generatedAt)}
          </Text>
        </View>

        {children}

        {/* Every figure carries when it was measured, because a report outlives
            the screen it came from. */}
        <View style={styles.footer} fixed>
          <Text>Lending App · prepared {stamp.format(header.generatedAt)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

const money = (amount: Centavos) => formatPesos(amount)

function SummaryDocument({ report }: { report: SummaryReport }) {
  return (
    <Shell header={report.header}>
      <View style={styles.section}>
        <Text style={styles.heading}>In this period</Text>
        <View style={styles.figures}>
          <Figure
            label="Lent out"
            value={money(report.lentOut)}
            note={report.loansMade === 1 ? '1 loan made' : `${report.loansMade} loans made`}
          />
          <Figure
            label="Collected"
            value={money(report.collected)}
            note={report.loansPaid === 1 ? '1 loan repaid' : `${report.loansPaid} loans repaid`}
          />
          <Figure label="You earned" value={money(report.earned)} note="your cut plus your own capital" />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>As of today</Text>
        <View style={styles.figures}>
          <Figure label="Out on loan" value={money(report.outOnLoan)} note="principal in borrowers' hands" />
          <Figure label="Floating" value={money(report.floating)} note="idle, ready to lend" />
          <Figure
            label="Overdue"
            value={String(report.overdue.length)}
            note={report.overdue.length === 1 ? 'loan past due' : 'loans past due'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Who is overdue, today</Text>
        <Table
          columns={[
            { key: 'who', label: 'Borrower', width: 40 },
            { key: 'due', label: 'Was due', width: 22 },
            { key: 'late', label: 'Days late', width: 16, align: 'right' },
            { key: 'total', label: 'Owed', width: 22, align: 'right' },
          ]}
          rows={report.overdue.map((row, index) => ({
            key: `${row.borrowerName}-${index}`,
            cells: [
              row.borrowerName,
              day.format(row.dueOn),
              String(row.daysLate),
              money(row.total),
            ],
          }))}
          empty="Nobody is overdue."
        />
      </View>
    </Shell>
  )
}

function LenderDocument({ report }: { report: LenderReport }) {
  const loanColumns: Column[] = [
    { key: 'who', label: 'Borrower', width: 30 },
    { key: 'start', label: 'Started', width: 18 },
    { key: 'due', label: 'Due', width: 18 },
    { key: 'principal', label: 'Their capital', width: 17, align: 'right' },
    { key: 'earnings', label: 'Earns', width: 17, align: 'right' },
  ]

  const loanRow = (row: LenderReport['funded'][number], index: number) => ({
    key: `${row.borrowerName}-${index}`,
    cells: [
      row.borrowerName,
      day.format(row.startOn),
      `${day.format(row.dueOn)}${row.state === 'overdue' ? ' (late)' : ''}`,
      money(row.principal),
      money(row.earnings),
    ],
  })

  return (
    <Shell header={report.header}>
      <View style={styles.section}>
        <Text style={styles.heading}>In this period</Text>
        <View style={styles.figures}>
          <Figure label="Money in" value={money(report.putIn)} />
          <Figure label="Money out" value={money(report.tookOut)} />
          <Figure
            label="Earned"
            value={money(report.earnedInPeriod)}
            note="on loans repaid in this period"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>As of today</Text>
        <View style={styles.figures}>
          <Figure label="Floating" value={money(report.position.floating)} note="idle, ready to lend" />
          <Figure label="Out on loan" value={money(report.position.outOnLoan)} />
          <Figure label="Earned, all time" value={money(report.position.earned)} note="already in floating" />
          <Figure
            label="Still to come"
            value={money(report.position.pending)}
            note="on loans not yet repaid"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Where your money is, today</Text>
        <Table
          columns={[
            { key: 'who', label: 'Borrower', width: 34 },
            { key: 'due', label: 'Due', width: 22 },
            { key: 'principal', label: 'Your capital', width: 22, align: 'right' },
            { key: 'earnings', label: 'Will earn', width: 22, align: 'right' },
          ]}
          rows={report.outWith.map((row, index) => ({
            key: `${row.borrowerName}-${index}`,
            cells: [
              row.borrowerName,
              <Text key="due" style={row.state === 'overdue' ? styles.late : undefined}>
                {day.format(row.dueOn)}
                {row.state === 'overdue' ? ' (late)' : ''}
              </Text>,
              money(row.principal),
              money(row.earnings),
            ],
          }))}
          empty="None of your money is out on loan right now."
        />
        <Text style={styles.note}>
          Every loan your money is still in, whenever it started — not only the ones in this period.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Money in and out</Text>
        <Table
          columns={[
            { key: 'when', label: 'Date', width: 20 },
            { key: 'what', label: 'Type', width: 18 },
            { key: 'note', label: 'Note', width: 42 },
            { key: 'amount', label: 'Amount', width: 20, align: 'right' },
          ]}
          rows={report.moves.map((move, index) => ({
            key: `${move.occurredOn.toISOString()}-${index}`,
            cells: [
              day.format(move.occurredOn),
              move.type === 'DEPOSIT' ? 'Money in' : 'Money out',
              move.note ?? '—',
              money(move.amount),
            ],
          }))}
          empty="No money moved in or out in this period."
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Loans funded in this period</Text>
        <Table columns={loanColumns} rows={report.funded.map(loanRow)} empty="No new loans in this period." />
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Repaid in this period</Text>
        <Table columns={loanColumns} rows={report.repaid.map(loanRow)} empty="Nothing was repaid in this period." />
        <Text style={styles.note}>
          Capital and earnings both return to floating funds when a loan is repaid.
        </Text>
      </View>
    </Shell>
  )
}

function BorrowerDocument({ report }: { report: BorrowerReport }) {
  const withProof = report.kind === 'borrower-file'

  return (
    <Shell header={report.header}>
      <View style={styles.section}>
        <Text style={styles.heading}>In this period</Text>
        <View style={styles.figures}>
          <Figure label="Borrowed" value={money(report.borrowedInPeriod)} note="capital taken" />
          <Figure label="Repaid" value={money(report.paidInPeriod)} note="capital plus interest" />
          <Figure label="Owes today" value={money(report.owedToday)} note="across every loan" />
        </View>
        <Text style={styles.note}>
          Track record, all time: {describeTrackRecord(report.record)}
          {report.label ? ` · rated ${report.label.toLowerCase()}` : ''}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Loans</Text>
        <Table
          columns={[
            { key: 'start', label: 'Started', width: 15 },
            { key: 'due', label: 'Due', width: 15 },
            { key: 'weeks', label: 'Weeks', width: 9, align: 'right' },
            { key: 'capital', label: 'Capital', width: 16, align: 'right' },
            { key: 'interest', label: 'Interest', width: 15, align: 'right' },
            { key: 'total', label: 'Total', width: 16, align: 'right' },
            { key: 'state', label: 'Status', width: 14, align: 'right' },
          ]}
          rows={report.loans.map((loan, index) => ({
            key: `${loan.startOn.toISOString()}-${index}`,
            cells: [
              day.format(loan.startOn),
              day.format(loan.dueOn),
              String(loan.weeks),
              money(loan.capital),
              money(loan.interest),
              money(loan.total),
              <Text key="state" style={loan.state === 'overdue' ? styles.late : undefined}>
                {loan.paidOn ? `Paid ${day.format(loan.paidOn)}` : STATE_WORD[loan.state]}
              </Text>,
            ],
            under: withProof ? (
              <View>
                <Text style={styles.proof}>
                  Funded by {loan.funders.join(', ') || 'nobody recorded'}
                </Text>
                {loan.proofs.map((proof) => (
                  <Text key={proof.reference} style={styles.proof}>
                    Proof: {proof.reference} · {proof.mimeType} · {describeBytes(proof.sizeBytes)} ·
                    uploaded {day.format(proof.uploadedAt)}
                  </Text>
                ))}
                {loan.missingProof ? (
                  <Text style={[styles.proof, styles.late]}>Paid with no proof attached.</Text>
                ) : null}
              </View>
            ) : undefined,
          }))}
          empty="No loans in this period."
        />
        {withProof ? (
          <Text style={styles.note}>
            Proof files are listed, not copied in. The files themselves stay in the app, where the
            links are signed and expire.
          </Text>
        ) : null}
      </View>
    </Shell>
  )
}

function ReportDocument({ report }: { report: Report }) {
  if (report.kind === 'summary') return <SummaryDocument report={report} />
  if (report.kind === 'lender') return <LenderDocument report={report} />
  return <BorrowerDocument report={report} />
}

/**
 * The report as PDF bytes.
 *
 * The cast is here rather than at the caller: renderToBuffer wants an element
 * whose props ARE a Document's, and every branch above does return a Document —
 * it is the wrapper taking a `report` prop that the signature cannot see. Doing
 * it once, next to the components it is about, keeps the route free of both the
 * cast and the renderer.
 */
export function renderReport(report: Report): Promise<Buffer> {
  const element = <ReportDocument report={report} /> as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
