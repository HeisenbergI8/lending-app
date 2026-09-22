import path from 'node:path'
import { type DocumentProps, Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { type Centavos, formatPesos } from '../../lib/money/centavos.ts'
import { type LoanState } from '../../lib/loan-state.ts'
import { describeRange } from '../../lib/report-range.ts'
import { describeBytes } from '../../lib/proof.ts'
import { describeTrackRecord } from '../../lib/track-record.ts'
import { describeTerm } from '../../lib/money/weeks.ts'
import {
  type AdminCutReport,
  type AdminCutLoanRow,
  type BorrowerReport,
  type LenderReport,
  type Report,
  type ReportHeader,
  type ReportPreview,
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

/**
 * The two chart colours, and they are the app's own.
 *
 * Series 1 is the money that was handed over, series 2 is what it earns — the
 * same meaning the same colour carries on every screen, so the chart on paper
 * and the chart on the phone are not two vocabularies.
 *
 * Checked with the colourblind-separation validator against white, which is the
 * only surface a printed page ever has.
 */
/** The Admin's own share, wherever it is picked out of a row. The app's brand ink. */
const CUT_INK = '#4747c5'

const CAPITAL_FILL = '#4747c5'
const INTEREST_FILL = '#8d5700'
const CHART_HEIGHT = 74

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
  // THE ONE COLUMN THIS REPORT IS ABOUT. Weight and ink, not colour alone: the
  // page may well be printed in black and white, and a colour nobody can see is
  // not a highlight. The heading above it says so in words as well.
  cut: { fontWeight: 600, color: CUT_INK },
  chartTitle: { fontSize: 7.5, color: MUTED, marginTop: 12 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 3, marginTop: 6 },
  chartSlot: { flex: 1, alignItems: 'center' },
  chartLabels: { flexDirection: 'row', gap: 3, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 3 },
  chartLabel: { flex: 1, fontSize: 6.5, color: MUTED, textAlign: 'center' },
  legend: { flexDirection: 'row', gap: 12, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 6, height: 6, borderRadius: 1.5 },
  legendText: { fontSize: 7.5, color: MUTED },
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

/**
 * Capital, interest, total — and the shape of them month by month.
 *
 * THE FIRST THING ON EVERY REPORT, because it is the whole document in three
 * numbers: what was handed over, what it costs, and what comes back. Everything
 * below it is the detail behind these.
 *
 * The columns are drawn in points rather than percentages. A percentage height
 * inside a flex column is the one thing this renderer is unreliable about, and a
 * bar chart that is quietly wrong about its own heights is worse than no chart.
 *
 * Every month in the range gets a column, empty ones included: a gap where
 * nothing happened is part of the picture.
 */
function Breakdown({
  preview,
  labels,
  capitalNote,
}: {
  preview: ReportPreview
  labels: [string, string]
  capitalNote?: string
}) {
  const totals = preview.months.map((month) => month.capital + month.interest)
  const peak = Math.max(...totals, 0)

  return (
    <View style={styles.section}>
      <View style={styles.figures}>
        <Figure label={labels[0]} value={money(preview.capital)} note={capitalNote} />
        <Figure label={labels[1]} value={money(preview.interest)} />
        <Figure label="Total" value={money(preview.total)} note="capital plus interest" />
      </View>

      {peak > 0 ? (
        <View wrap={false}>
          {/* The figures above cover the whole range; these columns are capped at
              twelve. When the range held more, the title says so — otherwise the
              bars silently total less than the Total beside them. */}
          <Text style={styles.chartTitle}>
            {preview.monthsTruncated ? 'Month by month · last 12 months of the range' : 'Month by month'}
          </Text>
          <View style={styles.chart}>
            {preview.months.map((month, index) => {
              const column = (totals[index] / peak) * CHART_HEIGHT
              const interest = totals[index] > 0 ? (month.interest / totals[index]) * column : 0
              return (
                <View key={month.label} style={styles.chartSlot}>
                  {/* The two segments are separated by 1.5pt of PAPER, not by a
                      border. A rule drawn round each one is ink that is not
                      data, and at this size it doubles the apparent weight of
                      the smaller segment. */}
                  <View style={{ width: 14, height: column }}>
                    <View
                      style={{
                        height: Math.max(0, interest - (interest > 0 ? 1.5 : 0)),
                        backgroundColor: INTEREST_FILL,
                        marginBottom: interest > 0 ? 1.5 : 0,
                      }}
                    />
                    <View style={{ height: column - interest, backgroundColor: CAPITAL_FILL }} />
                  </View>
                </View>
              )
            })}
          </View>

          <View style={styles.chartLabels}>
            {preview.months.map((month) => (
              <Text key={month.label} style={styles.chartLabel}>
                {month.label}
              </Text>
            ))}
          </View>

          {/* Identity is never colour alone, on paper least of all: this page may
              well be printed in black and white. */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: CAPITAL_FILL }]} />
              <Text style={styles.legendText}>{labels[0]}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: INTEREST_FILL }]} />
              <Text style={styles.legendText}>{labels[1]}</Text>
            </View>
          </View>

          <Text style={styles.note}>
            By the month each loan STARTED, so a loan repaid in this period but handed over earlier
            is not counted here. Every figure was fixed the day its loan was made.
          </Text>
        </View>
      ) : (
        <Text style={styles.note}>No loans started in this period.</Text>
      )}
    </View>
  )
}

function Shell({ header, children }: { header: ReportHeader; children: React.ReactNode }) {
  return (
    <Document
      title={`${header.title}${header.subject ? ` · ${header.subject}` : ''}`}
      author="Consignment Kush"
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
          <Text>Consignment Kush · prepared {stamp.format(header.generatedAt)}</Text>
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
      {/* "Lent out" lives in the Breakdown as "Capital lent" and is NOT repeated
          below. They were the same number under two names, which is how a reader
          ends up adding one to the other. */}
      <Breakdown
        preview={report.preview}
        labels={['Capital lent', 'Interest charged']}
        capitalNote={report.loansMade === 1 ? '1 loan made' : `${report.loansMade} loans made`}
      />

      <View style={styles.section}>
        <Text style={styles.heading}>In this period</Text>
        <View style={styles.figures}>
          <Figure
            label="Collected"
            value={money(report.collected)}
            note={report.loansPaid === 1 ? '1 loan repaid' : `${report.loansPaid} loans repaid`}
          />
          {/* `earned` is adminTakeOnLoan summed over loans repaid in the range:
              the Admin's cut on other funders' principal, plus the INTEREST the
              Admin's own capital earned on those loans. The old note said "plus
              the Admin's own capital", which names the principal — a far larger
              number that is not in this figure at all, and reading it that way
              makes the Admin's profit look like a fraction of what it was. */}
          <Figure
            label="Admin earned"
            value={money(report.earned)}
            note="the Admin cut plus what the Admin’s own capital earned"
          />
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

/**
 * Every loan the Admin took a share of, with that share picked out.
 *
 * The columns are the loans list on paper — borrower, dates, capital, total,
 * who funded it — plus the one column that list does not carry. That is the
 * whole design: the Admin already knows how to read the list, and this adds the
 * figure they came for rather than inventing a second way to say the same loan.
 *
 * TWO TABLES THAT ARE NEVER ADDED TOGETHER. The first is what the period
 * PROMISED the Admin, the second what it PAID them, and one loan can honestly
 * be in both. There is no grand total anywhere on this report for that reason.
 */
function AdminCutDocument({ report }: { report: AdminCutReport }) {
  const columns = (second: string): Column[] => [
    { key: 'who', label: 'Borrower', width: 22 },
    { key: 'start', label: 'Started', width: 14 },
    { key: 'second', label: second, width: 14 },
    { key: 'capital', label: 'Capital', width: 15, align: 'right' },
    { key: 'total', label: 'Borrower repays', width: 17, align: 'right' },
    { key: 'cut', label: "Admin's cut", width: 18, align: 'right' },
  ]

  // The funders go UNDER the row rather than in a column of their own. A loan
  // split three ways needs three names, and three names do not fit a column
  // narrow enough to leave the figures room.
  const row = (loan: AdminCutLoanRow, second: React.ReactNode) => ({
    key: loan.loanId,
    cells: [
      loan.borrowerName,
      day.format(loan.startOn),
      second,
      money(loan.capital),
      money(loan.total),
      <Text key="cut" style={styles.cut}>
        {money(loan.adminCut)}
      </Text>,
    ],
    under: <Text style={styles.proof}>Funded by {loan.funders.join(', ')}</Text>,
  })

  return (
    <Shell header={report.header}>
      <View style={styles.section}>
        <Text style={styles.heading}>In this period</Text>
        <View style={styles.figures}>
          {/* `agreed` is adminTakeOnLoan summed over loans whose START DATE falls
              in the range. It is what those loans promise the Admin on the day
              they were written, and none of it has necessarily arrived — a loan
              made in this period is usually repaid in a later one. NOT a profit
              figure, and labelled so it cannot be read as one. */}
          <Figure
            label="Cut on loans made"
            value={money(report.agreed)}
            note={report.started.length === 1 ? 'on 1 loan started here' : `on ${report.started.length} loans started here`}
          />
          {/* `collected` is the same sum over loans whose live PAYMENT date falls
              in the range. This is the money that actually reached the pot. */}
          <Figure
            label="Cut collected"
            value={money(report.collected)}
            note={report.repaid.length === 1 ? 'from 1 loan repaid here' : `from ${report.repaid.length} loans repaid here`}
          />
        </View>
        <Text style={styles.note}>
          These two are never added together. A loan can be in both, made and repaid in the same
          period, and the first is money promised while the second is money received.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>As of today</Text>
        <View style={styles.figures}>
          {/* Every ACTIVE loan in the account, whatever period it belongs to. A
              range cannot narrow this: it is a fact about now. */}
          <Figure
            label="Still to come"
            value={money(report.outstandingToday)}
            note="the Admin's cut on every loan still running, whenever it started"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Loans made in this period</Text>
        <Table
          columns={columns('Due')}
          rows={report.started.map((loan) =>
            row(
              loan,
              <Text key="due" style={loan.state === 'overdue' ? styles.late : undefined}>
                {day.format(loan.dueOn)}
                {loan.state === 'overdue' ? ' (late)' : ''}
              </Text>,
            ),
          )}
          empty="No loans were made in this period."
        />
        <Text style={styles.note}>
          The Admin’s cut is what this loan hands the Admin: the cut charged on the other
          funders’ capital, plus what the Admin’s own money earned where any went in. Fixed
          the day the loan was made and never recalculated.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Loans repaid in this period</Text>
        <Table
          columns={columns('Paid')}
          rows={report.repaid.map((loan) =>
            row(loan, loan.paidOn ? day.format(loan.paidOn) : 'Paid'),
          )}
          empty="No loans were repaid in this period."
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
      {/* NOT "interest earned". These are loans that STARTED in the period, and
          a share of one still running is owed rather than received — "Earned"
          below is the figure that has actually arrived. */}
      <Breakdown preview={report.preview} labels={['Capital funded', 'Their interest']} />

      <View style={styles.section}>
        <Text style={styles.heading}>In this period</Text>
        <View style={styles.figures}>
          <Figure label="Money in" value={money(report.putIn)} />
          <Figure label="Money out" value={money(report.tookOut)} />
          {/* `earnedInPeriod` is this lender's own earnings on loans repaid in
              the range, plus — on the Admin pot only — the 2% cut charged on the
              other funders' share of those same loans. The cut sits on no row of
              this statement, so the note prints it rather than letting the total
              exceed the loans listed above it. */}
          <Figure
            label="Earned"
            value={money(report.earnedInPeriod)}
            note={
              report.adminCutInPeriod > 0
                ? `on loans repaid in this period, includes ${money(report.adminCutInPeriod)} cut from other lenders' loans`
                : 'on loans repaid in this period'
            }
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
        <Text style={styles.heading}>Where this money is, today</Text>
        <Table
          columns={[
            { key: 'who', label: 'Borrower', width: 34 },
            { key: 'due', label: 'Due', width: 22 },
            { key: 'principal', label: 'Capital', width: 22, align: 'right' },
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
          empty="None of this money is out on loan right now."
        />
        <Text style={styles.note}>
          Every loan this money is still in, whenever it started, not only the ones in this period.
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
              move.note ?? '-',
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
      {/* "Borrowed" lives in the Breakdown as "Capital borrowed" and is NOT
          repeated below: the same number under two names invites arithmetic
          between them. */}
      <Breakdown
        preview={report.preview}
        labels={['Capital borrowed', 'Interest charged']}
        capitalNote="capital taken"
      />

      <View style={styles.section}>
        <Text style={styles.heading}>In this period</Text>
        <View style={styles.figures}>
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
            { key: 'start', label: 'Started', width: 14 },
            { key: 'due', label: 'Due', width: 14 },
            // "Term", not "Weeks": a loan charging a fixed amount can run any
            // number of days, and this column now prints what it actually ran.
            { key: 'term', label: 'Term', width: 11, align: 'right' },
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
              describeTerm(loan.termDays),
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
  if (report.kind === 'admin-cut') return <AdminCutDocument report={report} />
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
