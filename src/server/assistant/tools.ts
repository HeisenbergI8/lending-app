import { formatPesos, type Centavos } from '../../lib/money/centavos.ts'
import { describeTerm, parseCalendarDate, toDateInput } from '../../lib/money/weeks.ts'
import { NO_FILTER, type LoanFilter, type LoanStatusFilter } from '../../lib/loan-filter.ts'
import { describeTrackRecord } from '../../lib/track-record.ts'
import { borrowerCounts, getBorrower } from '../borrowers/queries.ts'
import { db } from '../db.ts'
import { getLender, listLenders } from '../lenders/queries.ts'
import { listDeleted, type DeletedSection } from '../deleted/queries.ts'
import { listPendingLoans } from '../pending/queries.ts'
import { ACTIONS, actionSpec, checkProposal, findActions } from './actions.ts'
import { describeProposal } from './proposal.ts'
import { readRules } from './knowledge.ts'
import { getLoan, interestSummary, listLoans, overdueSummary } from '../loans/queries.ts'

/**
 * The tools Ask Pondex can call. EVERY ONE OF THEM ONLY READS.
 *
 * Each one is a thin wrapper over a query the screens already use, so the chat
 * and the screens cannot disagree about a number. Nothing here writes, and none
 * of the queries below can: that is the whole of the "read only" promise, kept
 * in code rather than in the prompt.
 *
 * Every call takes the signed-in user's id from the session, never from the
 * model. The model picks WHAT to look at; it never picks whose data it is.
 *
 * Results go back to the model as plain JSON with pesos already formatted and
 * dates as YYYY-MM-DD, so it copies figures instead of doing arithmetic on
 * centavos.
 */

type JsonSchema = Record<string, unknown>
export type ToolSpec = { name: string; description: string; parameters: JsonSchema }

export const TOOLS: ToolSpec[] = [
  {
    name: 'read_rules',
    description:
      "How Pondex works and the Admin's own lending rules: word meanings (floating, earned, late, overdue), interest, payments, weekly loans, splits, advances, labels, reports, deleting, limits, usual length. Returns matching sections with their source, or found: false.",
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'A few words, e.g. "label rules".' } },
      required: ['question'],
    },
  },
  {
    name: 'get_overview',
    description:
      "Today's dashboard totals: out on loan, floating, earned, interest, overdue, borrower counts.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_lenders',
    description:
      "Each lender's pot today: floating, out on loan, earned, interest still owed. isAdmin marks the Admin's pot.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'find_borrower',
    description:
      'A borrower by name: label, track record, still owed, and every loan with funders, each payment made and notes. found: false if nobody matches.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'As written, e.g. "Mitch G".' } },
      required: ['name'],
    },
  },
  {
    name: 'find_loans',
    description:
      'Search loans; filters optional and combined. Up to 25 loans plus totals across all matches.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Borrower or lender name.' },
        status: { type: 'string', enum: ['active', 'overdue', 'paid'] },
        due_from: { type: 'string', description: 'YYYY-MM-DD, due on or after.' },
        due_to: { type: 'string', description: 'YYYY-MM-DD, due on or before.' },
        amount: { type: 'number', description: 'Exact amount or total in pesos.' },
      },
    },
  },
  {
    name: 'get_loan',
    description:
      'One loan by id (from find_loans or find_borrower): rates, interest, funders with earnings and admin cut, weekly schedule, notes.',
    parameters: {
      type: 'object',
      properties: { loan_id: { type: 'string' } },
      required: ['loan_id'],
    },
  },
  {
    name: 'get_lender',
    description: "One lender by name: id, floating, starting capital, and money in/out entries with ids.",
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'list_pending',
    description: 'Pending loan requests with ids.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_deleted',
    description: 'Recently Deleted: borrowers, lenders, loans and money entries with ids, for restoring.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'find_action',
    description: 'Before ANY change: find the action and its fields. * marks required.',
    parameters: {
      type: 'object',
      properties: { what: { type: 'string', description: 'The change in a few words, e.g. "new loan" or "mark paid".' } },
      required: ['what'],
    },
  },
  {
    name: 'propose_action',
    description:
      'Show the Admin a card to confirm a change. Nothing is saved until they tap Confirm. Give ids from the lookup tools, amounts in pesos, dates as YYYY-MM-DD.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        fields: { type: 'object', description: 'Field name to value.' },
        funders: { type: 'array', items: { type: 'object', properties: { lenderId: { type: 'string' }, amount: { type: 'string' } } } },
      },
      required: ['action', 'fields'],
    },
  },
  {
    name: 'search_notes',
    description:
      "Loan notes containing some words. Notes are the Admin's remarks, not checked facts.",
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
]

const peso = (amount: Centavos) => formatPesos(amount)
const day = (date: Date | null) => (date ? toDateInput(date) : null)
const INSENSITIVE = { mode: 'insensitive' as const }

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

function words(text: string): string[] {
  return text.split(/\s+/).map((w) => w.replace(/\.$/, '')).filter((w) => w.length > 0)
}

async function getOverview(userId: string) {
  const [lenders, overdue, interest, people] = await Promise.all([
    listLenders(userId),
    overdueSummary(userId),
    interestSummary(userId),
    borrowerCounts(userId),
  ])
  const sum = (pick: (l: (typeof lenders)[number]) => number) =>
    peso(lenders.reduce((total, l) => total + pick(l), 0) as Centavos)

  return {
    today: day(new Date()),
    outOnLoan: sum((l) => l.position.outOnLoan),
    floating: sum((l) => l.position.floating),
    earned: sum((l) => l.position.earned),
    interest: { charged: peso(interest.charged), collected: peso(interest.collected), stillOwed: peso(interest.pending) },
    overdue: { loans: overdue.loans, people: overdue.borrowers, amount: peso(overdue.total) },
    borrowers: { all: people.all, owingNow: people.owing },
  }
}

async function listLenderPots(userId: string) {
  const lenders = await listLenders(userId)
  return lenders.map((l) => ({
    id: l.id,
    name: `${l.firstName} ${l.lastName}`,
    isAdmin: l.isSelf,
    floating: peso(l.position.floating),
    outOnLoan: peso(l.position.outOnLoan),
    earned: peso(l.position.earned),
    interestStillOwed: peso(l.position.pending),
  }))
}

async function findBorrower(userId: string, name: string) {
  const terms = words(name)
  if (terms.length === 0) return { found: false, reason: 'No name given.' }

  const matches = await db.borrower.findMany({
    where: {
      userId,
      deletedAt: null,
      // A single letter is an initial ("Mitch G."), so it only matches the start
      // of the last name. Anything longer may sit anywhere in either name.
      AND: terms.map((term) =>
        term.length === 1
          ? { lastName: { startsWith: term, ...INSENSITIVE } }
          : { OR: [{ firstName: { contains: term, ...INSENSITIVE } }, { lastName: { contains: term, ...INSENSITIVE } }] },
      ),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 6,
    select: { id: true, firstName: true, lastName: true },
  })

  if (matches.length === 0) return { found: false, reason: `No borrower named "${name}".` }
  // More than a handful means the name was too short to mean one person. Hand
  // back the names so the model can ask which one, instead of guessing.
  if (matches.length > 3) {
    return { found: true, tooMany: true, names: matches.map((m) => `${m.firstName} ${m.lastName}`) }
  }

  const people = await Promise.all(matches.map((m) => getBorrower(userId, m.id)))
  // Notes ride along with each loan. Smaller models rarely go back for get_loan
  // on their own, and "what note is on her loan" is a common question.
  const notes = await db.loanNote.findMany({
    where: { userId, loanId: { in: people.flatMap((p) => p?.loans.map((l) => l.id) ?? []) } },
    orderBy: { createdAt: 'asc' },
    select: { loanId: true, body: true },
  })
  const notesOf = (loanId: string) => notes.filter((n) => n.loanId === loanId).map((n) => n.body)
  return {
    found: true,
    borrowers: people
      .filter((b) => b !== null)
      .map((b) => ({
        id: b.id,
        name: `${b.firstName} ${b.lastName}`,
        label: b.label,
        trackRecord: describeTrackRecord(b.record),
        stillOwes: peso(b.outstanding),
        overdueAmount: peso(b.overdueOutstanding),
        loans: b.loans.map((loan) => ({
          id: loan.id,
          amount: peso(loan.capital),
          interest: peso(loan.interest),
          totalToRepay: peso(loan.total),
          term: describeTerm(loan.termDays),
          start: day(loan.startOn),
          due: day(loan.dueOn),
          state: loan.state,
          paidOn: day(loan.paidOn),
          interestPaid: loan.weekly ? 'every week' : 'with the capital at the end',
          payments: loan.payments.map((p) => ({ date: day(p.paidOn), amount: peso(p.amount), ...(p.week ? { week: p.week } : {}) })),
          funders: loan.funders.map((f) => ({ name: f.name, isAdmin: f.isAdmin, amount: peso(f.principal) })),
          notes: notesOf(loan.id),
        })),
      })),
  }
}

async function findLoans(userId: string, args: Record<string, unknown>) {
  const status = str(args, 'status')
  const amount = typeof args.amount === 'number' && args.amount > 0 ? Math.round(args.amount * 100) : null
  const filter: LoanFilter = {
    ...NO_FILTER,
    terms: words(str(args, 'name')),
    amount: amount as Centavos | null,
    from: parseCalendarDate(str(args, 'due_from')),
    to: parseCalendarDate(str(args, 'due_to')),
    status: ['active', 'overdue', 'paid'].includes(status) ? (status as LoanStatusFilter) : null,
  }

  const { rows, totals } = await listLoans(userId, filter, { page: 1, skip: 0, take: 25 })
  return {
    totals: {
      matching: totals.all,
      active: totals.active,
      overdue: totals.overdue,
      paid: totals.paid,
      stillToCollect: peso(totals.outstanding),
    },
    shown: rows.length,
    loans: rows.map((loan) => ({
      id: loan.id,
      borrower: loan.borrowerName,
      amount: peso(loan.capital),
      totalToRepay: peso(loan.total),
      nextDue: day(loan.dueOn),
      nextDueIsAWeeklyPayment: loan.dueIsWeekly,
      state: loan.state,
      funders: loan.funders.map((f) => ({ name: f.name, amount: peso(f.principal) })),
      latestNote: loan.latestNote?.body ?? null,
    })),
  }
}

async function loanDetail(userId: string, loanId: string) {
  const loan = loanId ? await getLoan(userId, loanId) : null
  if (!loan) return { found: false, reason: 'No loan with that id.' }

  const bps = (value: number | null) => (value === null ? null : `${value / 100}% a week`)
  return {
    found: true,
    borrower: loan.borrowerName,
    amount: peso(loan.capital),
    interest: peso(loan.interest),
    totalToRepay: peso(loan.total),
    borrowerRate: bps(loan.borrowerRateBps),
    interestType: loan.interestBasis,
    collection: loan.interestCollection,
    term: describeTerm(loan.termDays),
    start: day(loan.startOn),
    capitalDue: day(loan.capitalDueOn),
    state: loan.state,
    paidOn: day(loan.paidOn),
    missingProof: loan.missingProof,
    adminEarnings: peso(loan.adminEarnings),
    lenderEarnings: peso(loan.lenderEarnings),
    funders: loan.funders.map((f) => ({
      name: f.name,
      isAdmin: f.isSelf,
      amount: peso(f.principal),
      earns: peso(f.earnings),
      adminCut: peso(f.adminCut),
      lenderRate: bps(f.lenderRateBps),
    })),
    weeks: loan.weeks.map((w) => ({
      week: w.week,
      due: day(w.dueOn),
      interest: peso(w.interest),
      paidOn: day(w.paidOn),
      ...(w.withCapital ? { paidWithCapital: true } : {}),
    })),
    notes: loan.notes.map((n) => ({ id: n.id, written: day(n.createdAt), text: n.body })),
    ...(await loanRecordIds(userId, loanId)),
    // Exactly what update_loan must send back, so an edit changes only what was asked.
    editValues: {
      borrowerId: loan.borrowerId,
      capital: String(loan.capital / 100),
      startOn: day(loan.startOn),
      dueOn: day(loan.capitalDueOn),
      interestBasis: loan.interestBasis,
      interestCollection: loan.interestCollection,
      ...(loan.borrowerRateBps !== null ? { borrowerRate: String(loan.borrowerRateBps / 100) } : {}),
      ...(loan.funders.find((f) => f.adminCutBps !== null) ? { adminCut: String(loan.funders.find((f) => f.adminCutBps !== null)!.adminCutBps! / 100) } : {}),
      ...(loan.interestBasis === 'FIXED_AMOUNT' ? { fixedInterest: String(loan.interest / 100), fixedLenderShare: String(loan.lenderEarnings / 100) } : {}),
      ...(loan.remindEveryWeeks !== null ? { remindEveryWeeks: String(loan.remindEveryWeeks) } : {}),
      funders: loan.funders.map((f) => ({ lenderId: f.lenderId, amount: String(f.principal / 100) })),
    },
  }
}

/**
 * The ids a change needs that the loan page shows but LoanDetail does not
 * carry: each payment and its proof files, the proof the money was sent, and
 * any extensions. Only for propose_action; never shown to the Admin.
 */
async function loanRecordIds(userId: string, loanId: string) {
  const [payments, sentProof, extensions] = await Promise.all([
    db.payment.findMany({
      where: { userId, loanId, deletedAt: null },
      orderBy: { paidOn: 'asc' },
      select: { id: true, weekNumber: true, paidOn: true, proofFiles: { where: { deletedAt: null }, select: { id: true } } },
    }),
    db.loanProof.findMany({ where: { userId, loanId, deletedAt: null }, select: { id: true } }),
    // The extensions table may be missing on an older database; the loan page treats that as none.
    db.loanExtension
      .findMany({ where: { userId, loanId }, orderBy: { extendedOn: 'asc' }, select: { id: true, fromDueOn: true, toDueOn: true } })
      .catch(() => []),
  ])
  return {
    payments: payments.map((p) => ({ id: p.id, week: p.weekNumber, paidOn: day(p.paidOn), proofFileIds: p.proofFiles.map((f) => f.id) })),
    sentProofIds: sentProof.map((p) => p.id),
    extensions: extensions.map((e) => ({ id: e.id, from: day(e.fromDueOn), to: day(e.toDueOn) })),
  }
}

async function lenderDetail(userId: string, name: string) {
  const terms = words(name)
  const lender = await db.lender.findFirst({
    where: {
      userId,
      deletedAt: null,
      AND: terms.map((term) => ({ OR: [{ firstName: { contains: term, ...INSENSITIVE } }, { lastName: { contains: term, ...INSENSITIVE } }] })),
    },
    select: { id: true },
  })
  const detail = lender ? await getLender(userId, lender.id) : null
  if (!detail) return { found: false, reason: `No lender named "${name}".` }
  return {
    found: true,
    id: detail.id,
    name: `${detail.firstName} ${detail.lastName}`,
    isAdmin: detail.isSelf,
    floating: peso(detail.position.floating),
    outOnLoan: peso(detail.position.outOnLoan),
    startingCapital: peso(detail.startingCapital),
    moneyInAndOut: detail.transactions.slice(0, 30).map((t) => ({
      id: t.id,
      type: t.type,
      amount: peso(t.amount),
      date: day(t.occurredOn),
      note: t.note,
      advanceAgainst: t.against?.borrowerName ?? null,
    })),
  }
}

async function pendingRequests(userId: string) {
  const { rows } = await listPendingLoans(userId, { page: 1, skip: 0, take: 50 })
  return rows.map((r) => ({
    id: r.id,
    name: `${r.firstName} ${r.lastName}`,
    amount: peso(r.capital),
    rate: `${r.rateBps / 100}% a week`,
    term: describeTerm(r.termDays),
    start: day(r.startOn),
  }))
}

async function recentlyDeleted(userId: string) {
  const sections: DeletedSection[] = ['lenders', 'borrowers', 'loans', 'transactions']
  const all = await Promise.all(sections.map((section) => listDeleted(userId, section, { page: 1, skip: 0, take: 25 })))
  return {
    borrowers: all[1].borrowers.map((b) => ({ id: b.id, name: `${b.firstName} ${b.lastName}`, deleted: day(b.deletedAt) })),
    lenders: all[0].lenders.map((l) => ({ id: l.id, name: `${l.firstName} ${l.lastName}`, deleted: day(l.deletedAt) })),
    loans: all[2].loans.map((l) => ({ id: l.id, borrower: l.borrowerName, amount: peso(l.capital), due: day(l.dueOn), deleted: day(l.deletedAt) })),
    moneyEntries: all[3].transactions.map((t) => ({ id: t.id, lender: t.lenderName, type: t.type, amount: peso(t.amount), date: day(t.occurredOn) })),
  }
}

/** The fields of the actions that fit what the Admin wants to do. */
function describeActions(what: string) {
  const found = findActions(what)
  return {
    actions: found.map((a) => ({
      action: a.name,
      what: a.title + (a.about ? `. ${a.about}` : ''),
      fields: a.fields.map((f) => `${f.name}${f.required ? '*' : ''}: ${f.kind}${f.values ? ` (${f.values.join('|')})` : ''}${f.about ? ` - ${f.about}` : ''}`),
      ...(a.funders ? { funders: '* list of { lenderId, amount }' } : {}),
      ...(a.files ? { file: `${a.files.label}; the Admin attaches it on the card` } : {}),
    })),
    ...(found.length === 0 ? { all: ACTIONS.map((a) => a.name) } : {}),
  }
}

/** A change for the Admin to confirm. Nothing is saved here. */
export async function proposeAction(userId: string, args: Record<string, unknown>) {
  const spec = actionSpec(str(args, 'action'))
  if (!spec) return { error: `No action called "${str(args, 'action')}". Use find_action.` }
  const fields = args.fields && typeof args.fields === 'object' ? (args.fields as Record<string, unknown>) : {}
  const checked = checkProposal(spec, fields, args.funders)
  if (!checked.ok) return { error: checked.error }
  const proposal = await describeProposal(userId, spec, checked.fields, checked.funders)
  // Every id must point at a real record of this account, funders included,
  // or the card would ask the Admin to approve "not found".
  const unknown = proposal.lines
    .filter((line) => line.value === 'not found' || line.label.includes('not found'))
    .map((line) => line.label)
  if (unknown.length > 0) return { error: `Not found: ${unknown.join(', ')}. Look the ids up with find_borrower, list_lenders or get_loan.` }
  return { proposal }
}

async function searchNotes(userId: string, text: string) {
  if (!text) return { notes: [] }
  const notes = await db.loanNote.findMany({
    where: { userId, loan: { deletedAt: null }, body: { contains: text, ...INSENSITIVE } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      body: true,
      createdAt: true,
      loan: {
        select: {
          id: true,
          dueOn: true,
          capitalCentavos: true,
          borrower: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
  return {
    notes: notes.map((n) => ({
      id: n.id,
      text: n.body,
      written: day(n.createdAt),
      loanId: n.loan.id,
      borrower: `${n.loan.borrower.firstName} ${n.loan.borrower.lastName}`,
      loanDue: day(n.loan.dueOn),
      loanAmount: peso(n.loan.capitalCentavos as Centavos),
    })),
  }
}

/** Run one tool the model asked for. An unknown name is answered, not thrown. */
export async function runTool(userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'read_rules':
      return readRules(str(args, 'question'))
    case 'get_overview':
      return getOverview(userId)
    case 'list_lenders':
      return listLenderPots(userId)
    case 'find_borrower':
      return findBorrower(userId, str(args, 'name'))
    case 'find_loans':
      return findLoans(userId, args)
    case 'get_loan':
      return loanDetail(userId, str(args, 'loan_id'))
    case 'get_lender':
      return lenderDetail(userId, str(args, 'name'))
    case 'list_pending':
      return pendingRequests(userId)
    case 'list_deleted':
      return recentlyDeleted(userId)
    case 'find_action':
      return describeActions(str(args, 'what'))
    case 'propose_action':
      return proposeAction(userId, args)
    case 'search_notes':
      return searchNotes(userId, str(args, 'text'))
    default:
      return { error: `There is no tool called ${name}.` }
  }
}
