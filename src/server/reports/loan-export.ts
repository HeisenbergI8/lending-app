import { centavos } from '../../lib/money/centavos.ts'
import { type LoanExportEntry, type LoanExportScope, type LoanExportStatus, loanExportLines } from '../../lib/loan-export.ts'
import { storedCalendarDate, toDateInput } from '../../lib/money/weeks.ts'
import { db } from '../db.ts'
import { type DocLine, buildDocument } from './docx.ts'

/**
 * The loan export as a Word file: every loan (overall) or every loan one lender
 * funded (per lender), in the NAME / DUE / AMOUNT / INTEREST / TOTAL layout.
 *
 * EVERY FIGURE IS A STORED ONE, read from the same LoanFunding rows the lender
 * page shows. Per lender, a row's interest is its own earnings plus the Admin cut
 * charged on it — the borrower's full rate on that lender's capital — and the
 * cut is named beside it. Overall, the loan's own stored interest and total are
 * used, and the cut is the sum of the cuts on its non-Admin funding rows (the
 * Admin's own rows carry a cut of 0 by construction, so nothing is filtered).
 *
 * Deleted loans are left out, as on every screen.
 */

const STATUS_WHERE = {
  active: { status: 'ACTIVE' },
  paid: { status: 'PAID' },
  all: {},
} as const

const STATUS_LABEL: Record<LoanExportStatus, string> = {
  active: 'Active loans',
  paid: 'Paid loans',
  all: 'All loans',
}

const fullName = (person: { firstName: string; lastName: string }): string =>
  `${person.firstName} ${person.lastName}`

const LOAN_SELECT = {
  startOn: true,
  dueOn: true,
  termDays: true,
  borrowerRateBps: true,
  borrower: { select: { firstName: true, lastName: true } },
} as const

export type LoanExport = { fileName: string; file: Buffer }

/** Null when the lender asked for is not on this account. */
export async function loanExport(
  userId: string,
  scope: LoanExportScope,
  status: LoanExportStatus,
  lenderId: string,
  now: Date = new Date(),
): Promise<LoanExport | null> {
  const loanWhere = { userId, deletedAt: null, ...STATUS_WHERE[status] }
  let subject: string
  let entries: LoanExportEntry[]

  if (scope === 'overall') {
    const loans = await db.loan.findMany({
      where: loanWhere,
      select: {
        ...LOAN_SELECT,
        capitalCentavos: true,
        interestCentavos: true,
        fundings: { select: { adminCutCentavos: true } },
      },
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
    })
    subject = 'Overall'
    entries = loans.map((loan) => ({
      borrowerName: fullName(loan.borrower),
      startOn: storedCalendarDate(loan.startOn),
      dueOn: storedCalendarDate(loan.dueOn),
      termDays: loan.termDays,
      borrowerRateBps: loan.borrowerRateBps,
      amount: centavos(loan.capitalCentavos),
      interest: centavos(loan.interestCentavos),
      adminCut: centavos(loan.fundings.reduce((total, funding) => total + funding.adminCutCentavos, 0)),
    }))
  } else {
    const lender = await db.lender.findFirst({ where: { id: lenderId, userId } })
    if (!lender) return null

    const fundings = await db.loanFunding.findMany({
      where: { userId, lenderId, loan: loanWhere },
      select: {
        principalCentavos: true,
        earningsCentavos: true,
        adminCutCentavos: true,
        loan: { select: LOAN_SELECT },
      },
      orderBy: [{ loan: { dueOn: 'asc' } }, { loan: { createdAt: 'asc' } }],
    })
    subject = `${fullName(lender)}${lender.isSelf ? ' (Admin)' : ''}`
    entries = fundings.map((row) => ({
      borrowerName: fullName(row.loan.borrower),
      startOn: storedCalendarDate(row.loan.startOn),
      dueOn: storedCalendarDate(row.loan.dueOn),
      termDays: row.loan.termDays,
      borrowerRateBps: row.loan.borrowerRateBps,
      amount: centavos(row.principalCentavos),
      interest: centavos(row.earningsCentavos + row.adminCutCentavos),
      // 0 on the Admin's own money, so the line does not appear there.
      adminCut: centavos(row.adminCutCentavos),
    }))
  }

  const today = now.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
  const lines: DocLine[] = [
    { kind: 'title', text: `Loan list: ${subject}` },
    { kind: 'line', text: `${STATUS_LABEL[status]} as of ${today}` },
    { kind: 'blank' },
  ]
  if (entries.length === 0) lines.push({ kind: 'line', text: 'No loans to show.' })
  for (const entry of entries) {
    for (const text of loanExportLines(entry)) lines.push({ kind: 'line', text })
    lines.push({ kind: 'blank' })
  }

  const slug = `loans ${subject} ${status}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return { fileName: `${slug}-${toDateInput(now)}.docx`, file: buildDocument(lines) }
}
