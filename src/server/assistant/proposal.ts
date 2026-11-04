import { centavos, formatPesos, parsePesos } from '../../lib/money/centavos.ts'
import { parseCalendarDate } from '../../lib/money/weeks.ts'
import { db } from '../db.ts'
import { type ActionSpec, type Funder, fileRequired } from './actions.ts'
import { closestNames } from './names.ts'

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
  proofFileId: 'Payment proof file',
  loanProofId: 'Loan proof file',
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
  // Spelled out like every Dex-E answer: "November 25, 2026".
  return date ? date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }) : `${raw} (not a date)`
}
const pesos = (raw: string) => {
  const parsed = parsePesos(raw)
  return parsed.ok ? formatPesos(parsed.value) : `${raw} (not an amount)`
}
const short = (date: Date) => date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric', timeZone: 'Asia/Manila' })
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
        ? `${person(loan.borrower)}, ${formatPesos(centavos(loan.capitalCentavos))} due ${short(loan.dueOn)}`
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
        ? `${person(tx.lender)}: ${CHOICES[tx.type]} ${formatPesos(centavos(tx.amountCentavos))} on ${short(tx.occurredOn)}`
        : 'not found'
    }
    case 'paymentId': {
      const payment = await db.payment.findFirst({
        where: { id: value, userId, deletedAt: null },
        select: { paidOn: true, amountCentavos: true, weekNumber: true },
      })
      return payment
        ? `${formatPesos(centavos(payment.amountCentavos))} paid ${short(payment.paidOn)}${payment.weekNumber ? ` (week ${payment.weekNumber})` : ''}`
        : 'not found'
    }
    case 'proofFileId': {
      const file = await db.proofFile.findFirst({ where: { id: value, userId, deletedAt: null }, select: { uploadedAt: true } })
      return file ? `File added ${short(file.uploadedAt)}` : 'not found'
    }
    case 'loanProofId': {
      const file = await db.loanProof.findFirst({ where: { id: value, userId, deletedAt: null }, select: { uploadedAt: true } })
      return file ? `File added ${short(file.uploadedAt)}` : 'not found'
    }
    case 'extensionId': {
      const extension = await db.loanExtension
        .findFirst({ where: { id: value, userId }, select: { fromDueOn: true, toDueOn: true } })
        .catch(() => null)
      return extension ? `Due ${short(extension.fromDueOn)} moved to ${short(extension.toDueOn)}` : 'not found'
    }
    default:
      // Every id field has a case above; an unknown one is refused, never shown as "selected".
      return 'not found'
  }
}

export async function describeProposal(userId: string, spec: ActionSpec, fields: Record<string, string>, funders: Funder[]): Promise<Proposal> {
  const lines: Proposal['lines'] = []
  for (const field of spec.fields) {
    const value = fields[field.name]
    if (value === undefined || value === '') continue
    // How the request's length was given is the form's own detail; the Weeks or Start and Due lines say it.
    if (field.name === 'termChoice') continue
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

  // A "new" person who looks like someone already on the list is most often a
  // typo. Say so on the card, where the Admin decides, rather than block it:
  // two real people can have close names.
  const newName =
    spec.name === 'create_loan' && !fields.borrowerId
      ? `${fields.borrowerFirstName ?? ''} ${fields.borrowerLastName ?? ''}`
      : spec.name === 'create_borrower'
        ? `${fields.firstName ?? ''} ${fields.lastName ?? ''}`
        : spec.name === 'create_lender'
          ? `${fields.firstName ?? ''} ${fields.lastName ?? ''}`
          : null
  if (newName && newName.trim()) {
    const existing = spec.name === 'create_lender'
      ? await db.lender.findMany({ where: { userId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } })
      : await db.borrower.findMany({ where: { userId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } })
    const close = closestNames(newName, existing)
    if (close.length > 0) {
      lines.push({ label: '⚠ Already on the list', value: `${close.map((p) => person(p)).join(', ')}. Is this really someone new?` })
    }
  }

  return {
    action: spec.name,
    title: spec.title,
    lines,
    fields,
    funders,
    files: spec.files ? { label: spec.files.label, required: fileRequired(spec, fields) } : null,
  }
}
