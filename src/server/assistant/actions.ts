import { parsePesos } from '../../lib/money/centavos.ts'
import { parseCalendarDate } from '../../lib/money/weeks.ts'

/**
 * Every change Ask Pondex can PROPOSE. It never makes one: the Admin taps
 * Confirm on a card, and the card runs the same server action the app's own
 * form runs, with the same checks. A refusal comes back as the form's own
 * sentence ("Fidel only has ₱6,500.00 floating"), which the chat shows as is.
 *
 * Field names are the form's own, so the FormData built from them is exactly
 * what the form would have posted. Plain data, so it can be tested without
 * Next; the server actions themselves are wired up in action-runners.ts. Left out on purpose: signing in and out,
 * changing the password, and setting a borrower photo, which needs the
 * cropper on the borrower's page.
 */

export type FieldKind = 'id' | 'text' | 'pesos' | 'date' | 'percent' | 'number' | 'choice'
export type ActionField = { name: string; kind: FieldKind; required?: boolean; values?: string[]; about?: string }
export type ActionSpec = {
  name: string
  /** What the card's heading says. */
  title: string
  /** For the model: when to use it, and anything it must know. */
  about: string
  fields: ActionField[]
  /** Funder rows, the one repeated input: [{ lenderId, amount }]. Only on loans. */
  funders?: boolean
  /** A file picker on the card, posted as the form's `proof`. */
  files?: { required: boolean; label: string }
  /** Words people use for it, for find_action. */
  words: string
}

const id = (name: string, about?: string): ActionField => ({ name, kind: 'id', required: true, about })
const DATE = 'YYYY-MM-DD'

const NAME: ActionField[] = [
  { name: 'firstName', kind: 'text', required: true },
  { name: 'lastName', kind: 'text', required: true },
]

const LOAN_FIELDS: ActionField[] = [
  { name: 'borrowerId', kind: 'id', about: 'An existing borrower. Or leave out and give borrowerFirstName and borrowerLastName to add a new one.' },
  { name: 'borrowerFirstName', kind: 'text' },
  { name: 'borrowerLastName', kind: 'text' },
  { name: 'capital', kind: 'pesos', required: true },
  { name: 'startOn', kind: 'date', required: true, about: `${DATE}. Usually today.` },
  { name: 'dueOn', kind: 'date', required: true, about: `${DATE}. Whole weeks after startOn on a weekly-rate loan.` },
  { name: 'interestBasis', kind: 'choice', values: ['WEEKLY_RATE', 'FIXED_AMOUNT'], about: 'Default WEEKLY_RATE.' },
  { name: 'borrowerRate', kind: 'percent', about: 'Per week, default 7.' },
  { name: 'adminCut', kind: 'percent', about: 'Per week, default 2.' },
  { name: 'fixedInterest', kind: 'pesos', about: 'Only on FIXED_AMOUNT.' },
  { name: 'fixedLenderShare', kind: 'pesos', about: 'Only on FIXED_AMOUNT: how much of it the lenders keep, 0 if none.' },
  { name: 'interestCollection', kind: 'choice', values: ['AT_END', 'WEEKLY'], about: 'Default AT_END.' },
  { name: 'remindEveryWeeks', kind: 'number' },
]

export const ACTIONS: ActionSpec[] = [
  // Loans
  {
    name: 'create_loan',
    title: 'Make a new loan',
    about: 'Lend money. funders must add up exactly to capital; ask how much from each lender if not said. Needs the screenshot of the money being sent.',
    // No reminder on a new loan from chat: models filled it in unasked. Set it on the loan page.
    fields: [...LOAN_FIELDS.filter((f) => f.name !== 'remindEveryWeeks'), { name: 'pendingId', kind: 'id', about: 'When funding a pending request.' }],
    funders: true,
    files: { required: true, label: 'Screenshot of the money being sent' },
    words: 'lend new loan create borrow give money fund request',
  },
  {
    name: 'update_loan',
    title: 'Edit a loan',
    about: "Fix a loan entered wrong. Start from get_loan's editValues, change only what the Admin asked, and send all of them, or the rest is cleared.",
    fields: [id('loanId'), ...LOAN_FIELDS],
    funders: true,
    words: 'edit change fix correct loan amount date rate',
  },
  { name: 'delete_loan', title: 'Delete a loan', about: 'Restorable for 30 days.', fields: [id('loanId')], words: 'delete remove loan' },
  { name: 'restore_loan', title: 'Restore a deleted loan', about: '', fields: [id('loanId')], words: 'restore undelete loan' },
  {
    name: 'extend_loan',
    title: 'Extend a loan',
    about: 'Push the due date out by whole weeks, with extra interest. paidNow "yes" if that interest was paid today.',
    fields: [
      id('loanId'),
      { name: 'weeks', kind: 'number', required: true },
      { name: 'paidNow', kind: 'choice', values: ['yes', 'no'] },
      { name: 'extraInterest', kind: 'pesos', about: 'Only on a fixed-amount loan.' },
      { name: 'extraLenderShare', kind: 'pesos', about: 'Only on a fixed-amount loan.' },
    ],
    files: { required: false, label: 'Screenshot of the interest paid (needed when paid now)' },
    words: 'extend extension more time push due date later',
  },
  { name: 'undo_extension', title: 'Undo a loan extension', about: '', fields: [id('extensionId', 'From get_loan.')], words: 'undo extension' },
  { name: 'convert_to_weekly', title: 'Collect interest weekly', about: 'Switch a loan to weekly interest collection.', fields: [id('loanId')], words: 'convert weekly interest every week' },
  { name: 'add_note', title: 'Add a note', about: '', fields: [id('loanId'), { name: 'body', kind: 'text', required: true }], words: 'note remark comment write' },
  { name: 'delete_note', title: 'Delete a note', about: 'Gone at once; notes are not restorable.', fields: [id('noteId', 'From get_loan.')], words: 'delete remove note' },
  {
    name: 'add_loan_proof',
    title: 'Add proof the loan money was sent',
    about: '',
    fields: [id('loanId')],
    files: { required: true, label: 'Screenshot of the money being sent' },
    words: 'proof screenshot sent transfer attach',
  },
  { name: 'delete_loan_proof', title: 'Remove a loan proof file', about: '', fields: [id('loanProofId', 'From get_loan.')], words: 'remove proof screenshot sent' },

  // Payments
  {
    name: 'mark_paid',
    title: 'Mark a loan as paid',
    about: 'The whole total, paid in one go. Not for a single week of a weekly loan.',
    fields: [id('loanId'), { name: 'paidOn', kind: 'date', required: true, about: `${DATE}. Usually today.` }],
    files: { required: true, label: 'Screenshot of the payment' },
    words: 'paid pay repaid settle mark paid payment received',
  },
  { name: 'undo_payment', title: 'Undo a payment', about: '', fields: [id('loanId')], words: 'undo unpay reverse payment' },
  {
    name: 'mark_week_paid',
    title: 'Mark the next week paid',
    about: "A weekly-interest loan's next unpaid week.",
    fields: [id('loanId'), { name: 'paidOn', kind: 'date', required: true, about: DATE }],
    files: { required: false, label: 'Proof of payment (optional)' },
    words: 'week weekly interest paid this week',
  },
  {
    name: 'undo_week_paid',
    title: 'Undo a paid week',
    about: '',
    fields: [id('loanId'), { name: 'weekNumber', kind: 'number', required: true }],
    words: 'undo week weekly payment',
  },
  {
    name: 'add_payment_proof',
    title: 'Add proof to a payment',
    about: '',
    fields: [id('loanId'), id('paymentId', 'From get_loan.')],
    files: { required: true, label: 'Proof of payment' },
    words: 'proof receipt screenshot gcash payment attach',
  },
  { name: 'delete_payment_proof', title: 'Remove a payment proof file', about: '', fields: [id('proofFileId', 'From get_loan.')], words: 'remove proof receipt payment' },

  // Borrowers
  { name: 'create_borrower', title: 'Add a borrower', about: '', fields: NAME, words: 'add new borrower person' },
  { name: 'rename_borrower', title: 'Rename a borrower', about: '', fields: [id('borrowerId'), ...NAME], words: 'rename borrower name spelling' },
  {
    name: 'set_label',
    title: "Set a borrower's label",
    about: 'Empty label clears it.',
    fields: [id('borrowerId'), { name: 'label', kind: 'choice', values: ['GOOD', 'OKAY', 'BAD', ''] }],
    words: 'label rating good okay bad rate borrower',
  },
  {
    name: 'delete_borrower',
    title: 'Delete a borrower',
    about: 'loans "unpaid" also deletes their unpaid loans. Restorable for 30 days.',
    fields: [id('borrowerId'), { name: 'loans', kind: 'choice', values: ['unpaid', 'keep'] }],
    words: 'delete remove borrower',
  },
  { name: 'restore_borrower', title: 'Restore a deleted borrower', about: '', fields: [id('borrowerId')], words: 'restore borrower' },
  { name: 'clear_borrower_photo', title: "Remove a borrower's photo", about: 'Setting a photo is done on the borrower page.', fields: [id('borrowerId')], words: 'photo picture remove' },

  // Lenders and their money
  { name: 'create_lender', title: 'Add a lender', about: '', fields: NAME, words: 'add new lender investor' },
  { name: 'rename_lender', title: 'Rename a lender', about: '', fields: [id('lenderId'), ...NAME], words: 'rename lender' },
  {
    name: 'set_starting_capital',
    title: "Set a lender's starting capital",
    about: '',
    fields: [id('lenderId'), { name: 'startingCapital', kind: 'pesos', required: true }, { name: 'note', kind: 'text' }],
    words: 'starting capital stake initial',
  },
  { name: 'delete_lender', title: 'Delete a lender', about: 'Restorable for 30 days.', fields: [id('lenderId')], words: 'delete remove lender' },
  { name: 'restore_lender', title: 'Restore a deleted lender', about: '', fields: [id('lenderId')], words: 'restore lender' },
  {
    name: 'record_money',
    title: 'Record money in or out',
    about: "DEPOSIT puts money in a lender's pot, WITHDRAWAL takes it out.",
    fields: [
      id('lenderId'),
      { name: 'type', kind: 'choice', values: ['DEPOSIT', 'WITHDRAWAL'], required: true },
      { name: 'amount', kind: 'pesos', required: true },
      { name: 'occurredOn', kind: 'date', required: true, about: DATE },
      { name: 'note', kind: 'text' },
    ],
    words: 'deposit withdraw withdrawal money in out add funds cash',
  },
  {
    name: 'record_advance',
    title: 'Take an advance against a loan',
    about: "Money out of the Admin's pot early, against a loan not repaid yet.",
    fields: [id('loanId'), { name: 'amount', kind: 'pesos', required: true }, { name: 'occurredOn', kind: 'date', required: true, about: DATE }, { name: 'note', kind: 'text' }],
    words: 'advance draw early',
  },
  {
    name: 'update_money',
    title: 'Edit a money in/out entry',
    about: '',
    fields: [
      id('transactionId', 'From get_lender.'),
      { name: 'type', kind: 'choice', values: ['DEPOSIT', 'WITHDRAWAL'], required: true },
      { name: 'amount', kind: 'pesos', required: true },
      { name: 'occurredOn', kind: 'date', required: true, about: DATE },
      { name: 'note', kind: 'text' },
    ],
    words: 'edit fix deposit withdrawal entry transaction',
  },
  { name: 'delete_money', title: 'Delete a money in/out entry', about: 'Restorable for 30 days.', fields: [id('transactionId', 'From get_lender.')], words: 'delete deposit withdrawal entry' },
  { name: 'restore_money', title: 'Restore a money in/out entry', about: '', fields: [id('transactionId')], words: 'restore deposit withdrawal entry' },

  // Pending requests
  {
    name: 'create_request',
    title: 'Add a pending request',
    about: 'Someone asking to borrow, before money is behind it. The borrower must exist first (create_borrower). termChoice "weeks" with weeks, or "custom" with startOn and dueOn.',
    fields: [
      id('borrowerId'),
      { name: 'capital', kind: 'pesos', required: true },
      { name: 'borrowerRate', kind: 'percent', about: 'Default 7.' },
      // The pending form's own option names: "weeks" with a count, or "custom" with two dates.
      { name: 'termChoice', kind: 'choice', values: ['weeks', 'custom'], required: true },
      { name: 'weeks', kind: 'number' },
      { name: 'startOn', kind: 'date' },
      { name: 'dueOn', kind: 'date' },
      { name: 'remindEveryWeeks', kind: 'number' },
    ],
    words: 'pending request wants to borrow waiting list',
  },
  { name: 'delete_request', title: 'Remove a pending request', about: 'Gone at once.', fields: [id('pendingId', 'From list_pending.')], words: 'remove decline pending request' },
]

const BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]))
export const actionSpec = (name: string) => BY_NAME.get(name) ?? null

/** The actions whose name, title or words share the most words with what was asked. */
export function findActions(what: string, limit = 3): ActionSpec[] {
  const asked = what.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2)
  return ACTIONS.map((a) => {
    const hay = `${a.name.replace(/_/g, ' ')} ${a.title} ${a.words}`.toLowerCase()
    return { a, score: asked.filter((w) => hay.includes(w)).length }
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a)
}

export type Funder = { lenderId: string; amount: string }

/** Why a value cannot be what its field needs, or null when it can. Same parsers as the forms. */
function badValue(field: ActionField, value: string): string | null {
  switch (field.kind) {
    case 'pesos':
      return parsePesos(value).ok ? null : `${field.name} "${value}" is not an amount in pesos (like 20000 or 20,000.50).`
    case 'date':
      return parseCalendarDate(value) ? null : `${field.name} "${value}" is not a date (YYYY-MM-DD).`
    case 'percent':
      return parsePesos(value).ok ? null : `${field.name} "${value}" is not a rate (like 7 or 7.5).`
    case 'number':
      return /^\d+$/.test(value) ? null : `${field.name} "${value}" is not a whole number.`
    default:
      return null
  }
}

/**
 * Details that are only needed in some cases, named so the model can ask for
 * them before a card is shown rather than the app refusing after Confirm.
 */
function conditionalMissing(spec: ActionSpec, clean: Record<string, string>, funders: Funder[]): string[] {
  const missing: string[] = []
  const isLoan = spec.name === 'create_loan' || spec.name === 'update_loan'
  // Every loan has funders; an edit sends them all again, or the app refuses.
  if (isLoan && funders.length === 0) missing.push('funders')
  // A loan's borrower is either someone on the list or a new person with both names.
  if (isLoan && !clean.borrowerId && !(clean.borrowerFirstName && clean.borrowerLastName)) {
    missing.push('borrowerId (or both borrowerFirstName and borrowerLastName for someone new)')
  }
  if (isLoan && clean.interestBasis === 'FIXED_AMOUNT') {
    if (!clean.fixedInterest) missing.push('fixedInterest')
    if (!clean.fixedLenderShare) missing.push('fixedLenderShare')
  }
  if (spec.name === 'create_request') {
    if (clean.termChoice === 'weeks' && !clean.weeks) missing.push('weeks')
    if (clean.termChoice === 'custom' && !clean.startOn) missing.push('startOn')
    if (clean.termChoice === 'custom' && !clean.dueOn) missing.push('dueOn')
  }
  return missing
}

/** Whether the card must have a file before Confirm. Extending with the interest paid now needs its screenshot. */
export function fileRequired(spec: ActionSpec, fields: Record<string, string>): boolean {
  if (!spec.files) return false
  return spec.files.required || (spec.name === 'extend_loan' && fields.paidNow === 'yes')
}

/** Check a proposal against its spec. Returns what is missing or wrong so the model can ask. */
export function checkProposal(spec: ActionSpec, fields: Record<string, unknown>, funders: unknown) {
  const clean: Record<string, string> = {}
  const wrong: string[] = []
  for (const field of spec.fields) {
    const value = fields[field.name]
    if (value === undefined || value === null) continue
    // A rate typed "7%" means 7; the form strips the sign the same way.
    let textValue = String(value).trim().slice(0, 500)
    if (field.kind === 'percent') textValue = textValue.replace(/%/g, '').trim()
    if (textValue === '' && !field.values) continue
    if (field.values && !field.values.includes(textValue)) return { ok: false as const, error: `${field.name} must be one of: ${field.values.join(', ')}.` }
    const bad = textValue === '' ? null : badValue(field, textValue)
    if (bad) wrong.push(bad)
    clean[field.name] = textValue
  }
  if (wrong.length > 0) return { ok: false as const, error: `${wrong.join(' ')} Ask the Admin.` }

  const rows: Funder[] = spec.funders && Array.isArray(funders)
    ? funders
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({ lenderId: String(r.lenderId ?? '').trim(), amount: String(r.amount ?? '').trim() }))
        .filter((r) => r.lenderId && r.amount)
    : []
  const badFunder = rows.find((r) => !parsePesos(r.amount).ok)
  if (badFunder) return { ok: false as const, error: `Funder amount "${badFunder.amount}" is not an amount in pesos. Ask the Admin.` }

  const missing = [...spec.fields.filter((f) => f.required && !clean[f.name]).map((f) => f.name), ...conditionalMissing(spec, clean, rows)]
  if (missing.length > 0) return { ok: false as const, error: `Missing: ${missing.join(', ')}. Ask the Admin.` }
  return { ok: true as const, fields: clean, funders: rows }
}

/** The FormData the app's own form would post. */
export function toFormData(fields: Record<string, string>, funders: Funder[], files: File[]): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  for (const row of funders) {
    form.append('funderLenderId', row.lenderId)
    form.append('funderAmount', row.amount)
    form.append('funderFirstName', '')
    form.append('funderLastName', '')
  }
  for (const file of files) form.append('proof', file)
  return form
}
