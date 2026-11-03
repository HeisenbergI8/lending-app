import { centavos, formatPesos, parsePesos } from '../../lib/money/centavos.ts'
import { parseCalendarDate } from '../../lib/money/weeks.ts'
import { db } from '../db.ts'
import { type ActionSpec, type Funder } from './actions.ts'

/**
 * What the Confirm card says: each field in words, with every id turned back
 * into the name it points at. The Admin is approving a change to real money,
 * so the card shows "Jelo Cruz", never a cuid, and a wrong id shows up as
 * "not found" before anything is saved.
 */

export type Proposal = {
  action: string
  title: string
  lines: { label: string; value: string }[]
  /** Exactly what Confirm posts back. The server checks it again from scratch. */
  fields: Record<string, string>
  funders: Funder[]
  files: { required: boolean; label: string } | null
}

const LABELS: Record<string, string> = {
  borrowerId: 'Borrower',
  lenderId: 'Lender',
  loanId: 'Loan',
  pendingId: 'Request',
  noteId: 'Note',
  transactionId: 'Entry',
  paymentId: 'Payment',
  extensionId: 'Extension',
  capital: 'Amount',
  startOn: 'Start',
  dueOn: 'Due',
  paidOn: 'Paid on',
  occurredOn: 'Date',
  borrowerRate: 'Borrower rate',
  adminCut: 'Admin cut',
  interestBasis: 'Interest',
  interestCollection: 'Interest paid',
  fixedInterest: 'Fixed interest',
  fixedLenderShare: "Lenders' share",
  remindEveryWeeks: 'Remind every (weeks)',
  firstName: 'First name',
  lastName: 'Last name',
  borrowerFirstName: 'New borrower first name',
  borrowerLastName: 'New borrower last name',
  startingCapital: 'Starting capital',
  extraInterest: 'Extra interest',
  extraLenderShare: "Lenders' share",
  paidNow: 'Interest paid now',
  weekNumber: 'Week',
  termChoice: 'Term given as',
  body: 'Note',
  weeks: 'Weeks',
  type: 'Type',
  amount: 'Amount',
  note: 'Note',
  label: 'Label',
  loans: 'Their loans',
}

const CHOICES: Record<string, string> = {
  WEEKLY_RATE: 'Weekly rate',
  FIXED_AMOUNT: 'Fixed amount',
  AT_END: 'With the capital at the end',
  WEEKLY: 'Every week',
  DEPOSIT: 'Money in',
  WITHDRAWAL: 'Money out',
  GOOD: 'Good',
  OKAY: 'Okay',
  BAD: 'Bad',
  unpaid: 'Also delete their unpaid loans',
  keep: 'Keep their loans',
}

const day = (raw: string) => {
  const date = parseCalendarDate(raw)
  return date ? date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : `${raw} (not a date)`
}
const pesos = (raw: string) => {
  const parsed = parsePesos(raw)
  return parsed.ok ? formatPesos(parsed.value) : `${raw} (not an amount)`
}
const person = (p: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : 'not found')

/** One id in words, always within this account. */
async function nameOf(userId: string, field: string, value: string): Promise<string> {
  switch (field) {
    case 'borrowerId':
      return person(await db.borrower.findFirst({ where: { id: value, userId }, select: { firstName: true, lastName: true } }))
    case 'lenderId':
      return person(await db.lender.findFirst({ where: { id: value, userId }, select: { firstName: true, lastName: true } }))
    case 'loanId': {
      const loan = await db.loan.findFirst({
        where: { id: value, userId },
        select: { capitalCentavos: true, dueOn: true, borrower: { select: { firstName: true, lastName: true } } },
      })
      return loan
        ? `${person(loan.borrower)}, ${formatPesos(centavos(loan.capitalCentavos))} due ${loan.dueOn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`
        : 'not found'
    }
    case 'pendingId': {
      const row = await db.pendingLoan.findFirst({ where: { id: value, userId }, select: { firstName: true, lastName: true, capitalCentavos: true } })
      return row ? `${person(row)}, ${formatPesos(centavos(row.capitalCentavos))}` : 'not found'
    }
    case 'noteId': {
      const note = await db.loanNote.findFirst({ where: { id: value, userId }, select: { body: true } })
      return note ? `“${note.body.slice(0, 80)}”` : 'not found'
    }
    case 'transactionId': {
      const tx = await db.lenderTransaction.findFirst({
        where: { id: value, userId },
        select: { type: true, amountCentavos: true, occurredOn: true, lender: { select: { firstName: true, lastName: true } } },
      })
      return tx
        ? `${person(tx.lender)}: ${CHOICES[tx.type]} ${formatPesos(centavos(tx.amountCentavos))} on ${tx.occurredOn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`
        : 'not found'
    }
    default:
      return 'selected'
  }
}

export async function describeProposal(userId: string, spec: ActionSpec, fields: Record<string, string>, funders: Funder[]): Promise<Proposal> {
  const lines: Proposal['lines'] = []
  for (const field of spec.fields) {
    const value = fields[field.name]
    if (value === undefined || value === '') continue
    const label = LABELS[field.name] ?? field.name
    const shown =
      field.kind === 'id'
        ? await nameOf(userId, field.name, value)
        : field.kind === 'pesos'
          ? pesos(value)
          : field.kind === 'date'
            ? day(value)
            : field.kind === 'percent'
              ? `${value}% a week`
              : field.kind === 'choice'
                ? (CHOICES[value] ?? value)
                : value
    lines.push({ label, value: shown })
  }
  for (const row of funders) {
    lines.push({ label: `From ${await nameOf(userId, 'lenderId', row.lenderId)}`, value: pesos(row.amount) })
  }
  if (spec.name === 'set_label' && !fields.label) lines.push({ label: 'Label', value: 'Cleared' })

  return { action: spec.name, title: spec.title, lines, fields, funders, files: spec.files ?? null }
}
