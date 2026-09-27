import { centavos } from '../../lib/money/centavos.ts'
import { ALL_LENDERS, OVERALL, type LoanExportEntry, type LoanExportStatus, formatAmount, loanExportLines } from '../../lib/loan-export.ts'
import { storedCalendarDate } from '../../lib/money/weeks.ts'
import { db } from '../db.ts'
import { type DocLine, buildDocument } from './docx.ts'

/**
 * The loan export as a Word file: every loan (overall), or every loan one lender
 * funded (per lender) — for one lender, or for all of them grouped by name, in the NAME / DUE / AMOUNT / INTEREST / TOTAL layout.
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

/**
 * The Admin's clock, not the server's. Vercel runs in UTC, so a file made at
 * 7am in Manila would otherwise be stamped with yesterday's date and a time
 * eight hours off — on the one line meant to tell two downloads apart.
 */
const ZONE = 'Asia/Manila'

function stamp(now: Date): { day: string; long: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-PH', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    long: now.toLocaleString('en-PH', { timeZone: ZONE, dateStyle: 'long', timeStyle: 'short' }),
    time: `${parts.hour}${parts.minute}`,
  }
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

/** Characters a phone or Windows refuses in a file name. */
const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|\u0000-\u001F]+/g

const FUNDING_SELECT = {
  principalCentavos: true,
  earningsCentavos: true,
  adminCutCentavos: true,
  loan: { select: LOAN_SELECT },
} as const

/** One lender's share of a loan: their capital, and the interest on it with the Admin cut named. */
function fundingEntry(row: {
  principalCentavos: number
  earningsCentavos: number
  adminCutCentavos: number
  loan: { startOn: Date; dueOn: Date; termDays: number; borrowerRateBps: number | null; borrower: { firstName: string; lastName: string } }
}): LoanExportEntry {
  return {
    borrowerName: fullName(row.loan.borrower),
    startOn: storedCalendarDate(row.loan.startOn),
    dueOn: storedCalendarDate(row.loan.dueOn),
    termDays: row.loan.termDays,
    borrowerRateBps: row.loan.borrowerRateBps,
    amount: centavos(row.principalCentavos),
    interest: centavos(row.earningsCentavos + row.adminCutCentavos),
    // 0 on the Admin's own money, so the line does not appear there.
    adminCut: centavos(row.adminCutCentavos),
  }
}

const lenderName = (lender: { firstName: string; lastName: string; isSelf: boolean }): string =>
  `${fullName(lender)}${lender.isSelf ? ' (Admin)' : ''}`

/** A run of entries, under a lender's name when the file holds more than one lender. */
type Section = { heading: string | null; entries: LoanExportEntry[] }

/**
 * Null when the lender asked for is not on this account.
 *
 * `who` is OVERALL, ALL_LENDERS (every lender in one file, each under their
 * own name), or one lender's id.
 */
export async function loanExport(
  userId: string,
  who: string,
  status: LoanExportStatus,
  now: Date = new Date(),
): Promise<LoanExport | null> {
  const loanWhere = { userId, deletedAt: null, ...STATUS_WHERE[status] }
  let subject: string
  let sections: Section[]

  if (who === OVERALL) {
    const loans = await db.loan.findMany({
      where: loanWhere,
      select: {
        ...LOAN_SELECT,
        capitalCentavos: true,
        interestCentavos: true,
        fundings: {
          select: {
            principalCentavos: true,
            adminCutCentavos: true,
            lender: { select: { firstName: true, lastName: true, isSelf: true } },
          },
          orderBy: { principalCentavos: 'desc' },
        },
      },
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
    })
    subject = 'Overall'
    sections = [
      {
        heading: null,
        entries: loans.map((loan) => ({
          borrowerName: fullName(loan.borrower),
          // One funder is just a name; a shared loan names each with their part.
          lenders:
            loan.fundings.length === 1
              ? lenderName(loan.fundings[0].lender)
              : loan.fundings
                  .map((funding) => `${lenderName(funding.lender)} ${formatAmount(centavos(funding.principalCentavos))}`)
                  .join(' + '),
          startOn: storedCalendarDate(loan.startOn),
          dueOn: storedCalendarDate(loan.dueOn),
          termDays: loan.termDays,
          borrowerRateBps: loan.borrowerRateBps,
          amount: centavos(loan.capitalCentavos),
          interest: centavos(loan.interestCentavos),
          adminCut: centavos(loan.fundings.reduce((total, funding) => total + funding.adminCutCentavos, 0)),
        })),
      },
    ]
  } else if (who === ALL_LENDERS) {
    // Every lender who funded a loan in the list, in the order the lender
    // dropdowns use: the Admin first, then by name. A lender with nothing to
    // show is left out rather than printed as an empty heading.
    const lenders = await db.lender.findMany({
      where: { userId, fundings: { some: { loan: loanWhere } } },
      orderBy: [{ isSelf: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        firstName: true,
        lastName: true,
        isSelf: true,
        fundings: {
          where: { loan: loanWhere },
          select: FUNDING_SELECT,
          orderBy: [{ loan: { dueOn: 'asc' } }, { loan: { createdAt: 'asc' } }],
        },
      },
    })
    subject = 'All lenders'
    sections = lenders.map((lender) => ({
      heading: lenderName(lender),
      entries: lender.fundings.map(fundingEntry),
    }))
  } else {
    const lender = await db.lender.findFirst({ where: { id: who, userId } })
    if (!lender) return null

    const fundings = await db.loanFunding.findMany({
      where: { userId, lenderId: who, loan: loanWhere },
      select: FUNDING_SELECT,
      orderBy: [{ loan: { dueOn: 'asc' } }, { loan: { createdAt: 'asc' } }],
    })
    subject = lenderName(lender)
    sections = [{ heading: null, entries: fundings.map(fundingEntry) }]
  }

  const when = stamp(now)
  const lines: DocLine[] = [
    { kind: 'title', text: `Loan list: ${subject}` },
    { kind: 'line', text: `${STATUS_LABEL[status]} as of ${when.long}` },
    { kind: 'blank' },
  ]
  if (sections.every((section) => section.entries.length === 0)) {
    lines.push({ kind: 'line', text: 'No loans to show.' })
  }
  for (const section of sections) {
    if (section.heading) lines.push({ kind: 'heading', text: section.heading })
    for (const entry of section.entries) {
      for (const text of loanExportLines(entry)) lines.push({ kind: 'line', text })
      lines.push({ kind: 'blank' })
    }
  }

  // WHOSE FILE IT IS, on every page and in the name it is saved under, so two
  // downloads cannot be mixed up halfway down a page or in a Files folder. The
  // time is in the name because two lists of the same lender on the same day
  // are otherwise indistinguishable.
  const header = `${subject} · ${STATUS_LABEL[status]} · ${when.long}`
  const fileName = `Loan list - ${subject} - ${STATUS_LABEL[status]} - ${when.day} ${when.time}.docx`
    .replace(UNSAFE_IN_FILE_NAME, ' ')
    .replace(/\s+/g, ' ')

  return { fileName, file: buildDocument(lines, { header }) }
}
