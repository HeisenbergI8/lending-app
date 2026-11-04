import { formatPesos, parsePesos, type Centavos } from '../../lib/money/centavos.ts'
import { describeTerm, parseCalendarDate, toDateInput } from '../../lib/money/weeks.ts'
import { NO_FILTER, type LoanFilter, type LoanStatusFilter } from '../../lib/loan-filter.ts'
import { describeTrackRecord, labelByRule } from '../../lib/track-record.ts'
import { borrowerCounts, getBorrower, listBorrowerNames } from '../borrowers/queries.ts'
import { db } from '../db.ts'
import { getLender, listLenderNames, listLenders } from '../lenders/queries.ts'
import { listDeleted, type DeletedSection } from '../deleted/queries.ts'
import { listPendingLoans } from '../pending/queries.ts'
import { ACTIONS, actionSpec, checkProposal, findActions, normalizeFields } from './actions.ts'
import { borrowerPhotoUrls } from '../storage/borrower-photos.ts'
import { amountsSaid, closestNames, looksLikeChangeVerb, nameSaid, type Named } from './names.ts'
import { manilaToday } from './today.ts'
import { describeProposal } from './proposal.ts'
import { readRules } from './knowledge.ts'
import { dueThisWeek, getLoan, interestSummary, listLoans, overdueSummary } from '../loans/queries.ts'

/**
 * The tools Dex-E can call. EVERY ONE OF THEM ONLY READS.
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
      "Today's dashboard totals: out on loan, floating, earned, interest, who is overdue, due this week, borrower counts, all loans ever made (count and capital), and the 3 borrowers who owe the most now.",
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
      'A borrower by name: savedLabel (what the app shows), ruleWouldGive (what your rule would give; say both when they differ), track record, still owed, and every loan with funders, each payment made and notes. found: false if nobody matches.',
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
        status: { type: 'string', enum: ['active', 'overdue', 'paid', 'week'], description: '"week" = due within the next 7 days.' },
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
      'Show the Admin a card to confirm a change. Nothing is saved until they tap Confirm. borrowerId and lenderId (also in funders) may be the person\'s name; the server finds them. Other ids come from the lookup tools. Amounts in pesos, dates as YYYY-MM-DD or "today"; for a loan, weeks instead of dueOn is fine.',
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
/** Whole days from a stored date to today in Manila. */
const daysSince = (date: Date) => {
  const [y, m, d] = manilaToday().split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) / 86_400_000)
}
const day = (date: Date | null) => (date ? toDateInput(date) : null)
const INSENSITIVE = { mode: 'insensitive' as const }

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

/** The words of a name as typed, without a trailing period or possessive: "Dan's" is Dan. */
function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, '').replace(/['’]s$/i, ''))
    .filter((w) => w.length > 0)
}

async function getOverview(userId: string) {
  const [lenders, overdue, interest, people, week, late] = await Promise.all([
    listLenders(userId),
    overdueSummary(userId),
    interestSummary(userId),
    borrowerCounts(userId),
    dueThisWeek(userId),
    // "Who is overdue" is the next question after "how many", so the names come along.
    listLoans(userId, { ...NO_FILTER, status: 'overdue' }, { page: 1, skip: 0, take: 25 }),
  ])
  // "Total of all loans ever" and "who owes the most" need every loan, not one page.
  const [ever, unpaid] = await Promise.all([
    db.loan.aggregate({ where: { userId, deletedAt: null }, _count: true, _sum: { capitalCentavos: true } }),
    db.loan.groupBy({ by: ['borrowerId'], where: { userId, deletedAt: null, status: 'ACTIVE' }, _sum: { totalCentavos: true }, _count: true }),
  ])
  const top = unpaid.sort((a, b) => (b._sum.totalCentavos ?? 0) - (a._sum.totalCentavos ?? 0)).slice(0, 3)
  const names = new Map((await db.borrower.findMany({ where: { id: { in: top.map((t) => t.borrowerId) } }, select: { id: true, firstName: true, lastName: true } })).map((b) => [b.id, `${b.firstName} ${b.lastName}`]))
  const overdueWho = late.rows.map((loan) => ({ borrower: loan.borrowerName, owes: peso(loan.total), wasDue: day(loan.dueOn), daysLate: daysSince(loan.dueOn) }))
  const sum = (pick: (l: (typeof lenders)[number]) => number) =>
    peso(lenders.reduce((total, l) => total + pick(l), 0) as Centavos)

  return {
    today: day(new Date()),
    outOnLoan: sum((l) => l.position.outOnLoan),
    floating: sum((l) => l.position.floating),
    earned: sum((l) => l.position.earned),
    interest: { charged: peso(interest.charged), collected: peso(interest.collected), stillOwed: peso(interest.pending) },
    overdue: { loans: overdue.loans, people: overdue.borrowers, amount: peso(overdue.total), who: overdueWho },
    dueThisWeek: { amount: peso(week.total), loans: week.loans, people: week.borrowers, from: day(week.from), to: day(week.to) },
    borrowers: { all: people.all, owingNow: people.owing },
    allLoansEver: { loans: ever._count, capital: peso((ever._sum.capitalCentavos ?? 0) as Centavos) },
    owesMostNow: top.map((t) => ({ borrower: names.get(t.borrowerId), unpaidLoans: t._count, toRepay: peso((t._sum.totalCentavos ?? 0) as Centavos) })),
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
  let terms = words(name)
  if (terms.length === 0) return { found: false, reason: 'No name given.' }

  const search = (list: string[]) => db.borrower.findMany({
    where: {
      userId,
      deletedAt: null,
      // A single letter is an initial ("Mitch G."), so it only matches the start
      // of the last name. Anything longer may sit anywhere in either name.
      AND: list.map((term) =>
        term.length === 1
          ? { lastName: { startsWith: term, ...INSENSITIVE } }
          : { OR: [{ firstName: { contains: term, ...INSENSITIVE } }, { lastName: { contains: term, ...INSENSITIVE } }] },
      ),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 6,
    select: { id: true, firstName: true, lastName: true },
  })
  let matches = await search(terms)
  // "dans loan": a possessive typed without the apostrophe. Only tried when
  // the name as typed found nobody, so a real name ending in s still wins.
  if (matches.length === 0 && terms.some((t) => t.length > 3 && /s$/i.test(t))) {
    const singular = terms.map((t) => (t.length > 3 ? t.replace(/s$/i, '') : t))
    const retry = await search(singular)
    if (retry.length > 0) {
      matches = retry
      terms = singular
    }
  }

  // "kend rico", "mrak lyn": the model sometimes passes a misspelt verb as part of the
  // name. Only tried when the name as typed found nobody, so a real "Mark Lopez" wins.
  let dropped: string[] = []
  if (matches.length === 0 && terms.length > 1 && terms.some(looksLikeChangeVerb)) {
    const rest = terms.filter((t) => !looksLikeChangeVerb(t))
    const retry = rest.length > 0 ? await search(rest) : []
    if (retry.length > 0) {
      dropped = terms.filter(looksLikeChangeVerb)
      matches = retry
      terms = rest
    }
  }

  if (matches.length === 0) {
    // Someone in Recently Deleted is not a stranger: offer the restore, not a new person.
    const deleted = await db.borrower.findMany({
      where: { userId, deletedAt: { not: null }, AND: terms.map((term) => ({ OR: [{ firstName: { contains: term, ...INSENSITIVE } }, { lastName: { contains: term, ...INSENSITIVE } }] })) },
      select: { id: true, firstName: true, lastName: true },
      take: 3,
    })
    if (deleted.length > 0) {
      return {
        found: false,
        reason: `${deleted.map((d) => `${d.firstName} ${d.lastName}`).join(', ')} is in Recently Deleted. Say so, and offer restore_borrower before anything else.`,
        deleted: deleted.map((d) => ({ id: d.id, name: `${d.firstName} ${d.lastName}` })),
      }
    }
    // A lender is not a stranger either: "how much did Maria earn" is about a lender,
    // and offering to add her as a borrower would make a duplicate person.
    const lenders = await db.lender.findMany({
      where: { userId, deletedAt: null, AND: terms.map((term) => ({ OR: [{ firstName: { contains: term, ...INSENSITIVE } }, { lastName: { contains: term, ...INSENSITIVE } }] })) },
      select: { id: true, firstName: true, lastName: true },
      take: 3,
    })
    if (lenders.length > 0) {
      return {
        found: false,
        reason: `${lenders.map((l) => `${l.firstName} ${l.lastName}`).join(', ')} is a lender, not a borrower. Answer with get_lender, and never offer to add them as a borrower.`,
        lenders: lenders.map((l) => ({ id: l.id, name: `${l.firstName} ${l.lastName}` })),
      }
    }
    // A typo finds nobody by exact match. Offer the close names before the
    // model offers to add a new person, which would be a duplicate.
    const everyone = await listBorrowerNames(userId)
    // "mrak lyn": one stray word (a typo of the verb, or of half the name) makes the
    // whole name match nobody. People matching one of the words are offered too,
    // as a question, never picked: "Juan Dela Cruz" must not quietly become Angel Dela Cruz.
    const oneWord = terms.length > 1
      ? everyone.filter((p) => terms.some((t) => t.length >= 3 && [p.firstName, p.lastName].some((part) => part.toLowerCase().split(/\s+/).includes(t.toLowerCase()))))
      : []
    const close = closestNames(name, everyone)
    const didYouMean = [...close, ...oneWord.filter((p) => !close.some((c) => c.id === p.id))].slice(0, 3).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))
    return didYouMean.length > 0
      ? { found: false, reason: `No borrower named exactly "${name}". Ask the Admin if they meant one of didYouMean before anything else.`, didYouMean }
      : { found: false, reason: `No borrower named "${name}". Ask the Admin whether to add them as a new borrower, with first and last name.` }
  }
  // More than a handful means the name was too short to mean one person. Hand
  // back the names so the model can ask which one, instead of guessing.
  if (matches.length > 3) {
    return { found: true, tooMany: true, names: matches.map((m) => `${m.firstName} ${m.lastName}`) }
  }

  const people = await Promise.all(matches.map((m) => getBorrower(userId, m.id)))
  const several = matches.length > 1 ? { note: 'Several borrowers match. Unless the question is about all of them, ask which one.' } : {}
  // "Cruz" can be a borrower AND a lender. Say so, or the lender is invisible.
  const lenderTwins = await db.lender.findMany({
    where: { userId, deletedAt: null, AND: terms.map((term) => ({ OR: [{ firstName: { contains: term, ...INSENSITIVE } }, { lastName: { contains: term, ...INSENSITIVE } }] })) },
    select: { firstName: true, lastName: true },
    take: 3,
  })
  const alsoLenders = lenderTwins.length > 0 ? { alsoLenders: lenderTwins.map((l) => `${l.firstName} ${l.lastName}`) } : {}
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
    ...(dropped.length > 0 ? { ignoredWords: dropped } : {}),
    ...several,
    ...alsoLenders,
    borrowers: people
      .filter((b) => b !== null)
      .map((b) => ({
        id: b.id,
        name: `${b.firstName} ${b.lastName}`,
        // The label the Admin saved (what set_label changes), and separately what the
        // Admin's rule would give. Named apart so neither is read as the other.
        savedLabel: b.label ?? 'none',
        ruleWouldGive: labelByRule(b.record),
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
    status: ['active', 'overdue', 'paid', 'week'].includes(status) ? (status as LoanStatusFilter) : null,
  }

  let { rows, totals } = await listLoans(userId, filter, { page: 1, skip: 0, take: 25 })
  // "dans loan": a possessive typed without the apostrophe, as in findBorrower.
  if (rows.length === 0 && filter.terms.some((t) => t.length > 3 && /s$/i.test(t))) {
    const singular = { ...filter, terms: filter.terms.map((t) => (t.length > 3 ? t.replace(/s$/i, '') : t)) }
    const retry = await listLoans(userId, singular, { page: 1, skip: 0, take: 25 })
    if (retry.rows.length > 0) ({ rows, totals } = retry)
  }
  // A typed name that matches no loan is most often a typo: offer the close
  // borrower and lender names, as find_borrower does, instead of "none".
  const typed = str(args, 'name')
  if (rows.length === 0 && typed) {
    const [borrowers, lenders] = await Promise.all([listBorrowerNames(userId), listLenderNames(userId)])
    const didYouMean = closestNames(typed, [...borrowers, ...lenders]).map((p) => `${p.firstName} ${p.lastName}`)
    if (didYouMean.length > 0) return { found: false, reason: `No loans for "${typed}". Ask if they meant one of didYouMean.`, didYouMean }
  }
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
      // Only said when true: on every row of a 25-loan list, "false" is tokens for nothing.
      ...(loan.dueIsWeekly ? { nextDueIsAWeeklyPayment: true } : {}),
      // Worked out here: counting days on a calendar is where models slip.
      ...(loan.state === 'overdue' ? { daysLate: daysSince(loan.dueOn) } : {}),
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
  const matches = await db.lender.findMany({
    where: {
      userId,
      deletedAt: null,
      AND: terms.map((term) => ({ OR: [{ firstName: { contains: term, ...INSENSITIVE } }, { lastName: { contains: term, ...INSENSITIVE } }] })),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 5,
    select: { id: true, firstName: true, lastName: true },
  })
  // Two lenders sharing a name is a question for the Admin, not a guess.
  if (matches.length > 1) {
    return { found: false, reason: 'Several lenders match. Ask which one.', matches: matches.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` })) }
  }
  if (matches.length === 0) {
    const didYouMean = closestNames(name, await listLenderNames(userId)).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))
    return { found: false, reason: `No lender named "${name}".`, ...(didYouMean.length > 0 ? { didYouMean } : {}) }
  }
  const detail = await getLender(userId, matches[0].id)
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

/**
 * The one person a name points at, or null. Used where a model passed a name
 * (or an id it made up) instead of an id: every typed word must match, or,
 * failing that, exactly one close spelling. Two candidates is never a guess.
 * Whatever this picks is shown by name on the card, where the Admin checks it.
 */
async function personId(userId: string, kind: 'borrower' | 'lender', value: string): Promise<string | null> {
  const table = kind === 'borrower' ? db.borrower : db.lender
  const exact = await (table as typeof db.borrower).findFirst({ where: { id: value, userId }, select: { id: true } })
  if (exact) return exact.id
  const terms = words(value.replace(/[^\p{L}\s'.-]/gu, ' '))
  if (terms.length === 0) return null
  const people: Named[] = kind === 'borrower' ? await listBorrowerNames(userId) : await listLenderNames(userId)
  const full = (p: Named) => `${p.firstName} ${p.lastName}`.toLowerCase()
  const containing = people.filter((p) => terms.every((t) => full(p).includes(t.toLowerCase())))
  if (containing.length === 1) return containing[0].id
  if (containing.length > 1) return null
  const close = closestNames(value, people)
  return close.length === 1 ? close[0].id : null
}

async function resolveNames(userId: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...fields }
  for (const [key, kind] of [['borrowerId', 'borrower'], ['lenderId', 'lender']] as const) {
    if (typeof out[key] === 'string' && out[key]) out[key] = (await personId(userId, kind, out[key] as string)) ?? out[key]
  }
  return out
}

async function resolveFunders(userId: string, funders: unknown): Promise<unknown> {
  if (!Array.isArray(funders)) return funders
  return Promise.all(
    funders.map(async (row) => {
      if (!row || typeof row !== 'object') return row
      const r = row as Record<string, unknown>
      // Models also write { lender: "Maria", amount } or { name: ... }.
      const said = String(r.lenderId ?? r.lender ?? r.name ?? '')
      return { ...r, lenderId: said ? ((await personId(userId, 'lender', said)) ?? said) : '' }
    }),
  )
}

/** A change for the Admin to confirm. Nothing is saved here. */
/** A length or a date in the Admin's words: "4 weeks", "3 weaks", "10 days", "until Dec 2", "2026-12-02", "12/2". */
const LENGTH_SAID = /(\d+\s*(weeks?|weaks?|wks?|days?|linggo|araw|months?)\b|\b(a|one|two|three|four|five|six)\s+(weeks?|weaks?)\b|\b(due|until|hanggang|by)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{1,2}\b|\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2}\b)/i

/** Words that point at the Admin's own pot without naming it. */
const ADMIN_POT = /\b(admin|my pot|my money|own money|own pot|from me|sarili|akin)\b/i
/** Amounts that must be ones the Admin said: a model filling one in is the costliest guess. */
const SAID_AMOUNT: Record<string, string> = {
  create_loan: 'capital',
  create_request: 'capital',
  record_money: 'amount',
  record_advance: 'amount',
  update_money: 'amount',
  set_starting_capital: 'startingCapital',
}

/**
 * Whether a card's amounts and people come from the Admin's own words, or the
 * reason to ask instead. Seen in testing: the small model filled in a lender,
 * an amount, or the wrong borrower's loan, and the card looked complete.
 * Asking costs a turn; a confirmed guess costs money.
 */
async function notSaidByAdmin(
  userId: string,
  action: string,
  fields: Record<string, string>,
  funders: { lenderId: string; amount: string }[],
  said: string,
  unchanged: Set<string> = new Set(),
): Promise<string | null> {
  // Funding a pending request: its amount and length were agreed when it was made,
  // so they count as said.
  let request: { capital: number; weeks: number } | null = null
  if (action === 'create_loan' && fields.pendingId) {
    const row = await db.pendingLoan.findFirst({ where: { id: fields.pendingId, userId }, select: { capitalCentavos: true, termDays: true } })
    if (row) request = { capital: row.capitalCentavos, weeks: row.termDays / 7 }
  }
  // A new loan or request needs a length the Admin gave: weeks, days, or a date.
  if ((action === 'create_loan' || action === 'create_request') && !request && !LENGTH_SAID.test(said)) {
    return 'The Admin did not say how long the loan runs. Ask (for example "4 weeks" or a due date).'
  }
  const amounts = amountsSaid(said).map((n) => Math.round(n * 100))
  if (request) amounts.push(request.capital)
  const cents = (v: string) => (parsePesos(v).ok ? (parsePesos(v) as { value: number }).value : NaN)
  const field = SAID_AMOUNT[action]
  if (field && fields[field]) {
    const value = cents(fields[field])
    // A loan's total may also be the sum of per-lender amounts the Admin gave ("10k each").
    const fromParts = action === 'create_loan' && funders.length > 0 && funders.every((f) => amounts.includes(cents(f.amount)))
    if (!amounts.includes(value) && !fromParts) return `The Admin did not say ${field} ${fields[field]}. Ask how much.`
  }
  if (action === 'create_loan' && funders.length > 1) {
    const even = funders.every((f) => f.amount === funders[0].amount)
    const allSaid = funders.every((f) => amounts.includes(cents(f.amount)))
    if (!allSaid && !(even && /\b(each|half|evenly|equally|hati)\b/i.test(said))) return 'The Admin did not say how much from each lender. Ask.'
  }

  const people: { firstName: string; lastName: string; isSelf?: boolean; role: string }[] = []
  if (fields.borrowerId && !unchanged.has(fields.borrowerId)) {
    const b = await db.borrower.findFirst({ where: { id: fields.borrowerId, userId }, select: { firstName: true, lastName: true } })
    if (b) people.push({ ...b, role: 'borrower' })
  }
  if (fields.loanId) {
    const l = await db.loan.findFirst({ where: { id: fields.loanId, userId }, select: { borrower: { select: { firstName: true, lastName: true } } } })
    if (l) people.push({ ...l.borrower, role: 'borrower on that loan' })
  }
  // On an edit, the people already on the loan were not named in this request, and need not be.
  const lenderIds = [fields.lenderId, ...funders.map((f) => f.lenderId)].filter((id) => id && !unchanged.has(id))
  if (lenderIds.length > 0) {
    const lenders = await db.lender.findMany({ where: { id: { in: lenderIds }, userId }, select: { firstName: true, lastName: true, isSelf: true } })
    people.push(...lenders.map((l) => ({ ...l, role: 'lender' })))
  }
  const missing = people.filter((p) => !(nameSaid(said, p) || (p.isSelf && ADMIN_POT.test(said))))
  if (missing.length > 0) {
    return `The Admin did not name ${missing.map((p) => `${p.firstName} ${p.lastName} (${p.role})`).join(', ')}. Ask who they meant; do not pick someone.`
  }
  return null
}

export async function proposeAction(userId: string, args: Record<string, unknown>) {
  const said = args._said
  delete args._said
  const spec = actionSpec(str(args, 'action'))
  if (!spec) return { error: `No action called "${str(args, 'action')}". Use find_action.` }
  let given = args.fields && typeof args.fields === 'object' ? (args.fields as Record<string, unknown>) : {}
  let rawFunders = args.funders
  const unchanged = new Set<string>()
  // An edit starts from the loan as saved, so the model only has to send what
  // changes. Without this, any field it left out was cleared by the form.
  if (spec.name === 'update_loan' && typeof given.loanId === 'string') {
    const saved = (await loanDetail(userId, given.loanId)) as { found: boolean; editValues?: Record<string, unknown> & { funders: unknown[] } }
    if (saved.found && saved.editValues) {
      const { funders: savedFunders, ...savedFields } = saved.editValues
      // Who is on the loan now: the check below only asks about people this edit adds.
      unchanged.add(String(savedFields.borrowerId))
      for (const f of savedFunders as { lenderId: string }[]) unchanged.add(f.lenderId)
      // A new length in weeks replaces the saved due date, which would otherwise win.
      if (given.weeks !== undefined && given.dueOn === undefined) delete savedFields.dueOn
      given = { ...savedFields, ...given }
      if (!Array.isArray(rawFunders) || rawFunders.length === 0) rawFunders = savedFunders
    }
  }
  // Extra interest is typed only on a fixed-amount loan; on a weekly-rate loan the app
  // works it out and ignores a typed figure, so a card must not show one.
  if (spec.name === 'extend_loan' && typeof given.loanId === 'string') {
    const loan = await db.loan.findFirst({ where: { id: given.loanId, userId }, select: { interestBasis: true } })
    if (loan && loan.interestBasis !== 'FIXED_AMOUNT') {
      delete given.extraInterest
      delete given.extraLenderShare
    }
  }
  // Funding a pending request: its amount, borrower and length are already agreed.
  if (spec.name === 'create_loan' && typeof given.pendingId === 'string') {
    const request = await db.pendingLoan.findFirst({ where: { id: given.pendingId, userId }, select: { capitalCentavos: true, termDays: true, firstName: true, lastName: true, startOn: true } })
    if (request) {
      given.capital ??= String(request.capitalCentavos / 100)
      if (!given.borrowerId && !given.borrowerFirstName) given.borrowerId = `${request.firstName} ${request.lastName}`
      if (given.startOn === undefined) given.startOn = request.startOn ? request.startOn.toISOString().slice(0, 10) : 'today'
      if (given.dueOn === undefined && given.weeks === undefined && request.termDays % 7 === 0) given.weeks = String(request.termDays / 7)
    }
  }
  // "for 3 days": the Admin's own length decides, never a week the model rounded it up to.
  const daysSaid = typeof said === 'string' ? /\b(\d+)\s*(days?|araw)\b/i.exec(said) : null
  if (spec.name === 'create_loan' && daysSaid && !/\d+\s*(weeks?|wks?|weaks?)\b/i.test(String(said))) {
    given.days = daysSaid[1]
    delete given.weeks
    delete given.dueOn
  }
  // A "new" borrower whose full name is exactly someone already on the list is that person.
  if (spec.name === 'create_loan' && !given.borrowerId && typeof given.borrowerFirstName === 'string' && typeof given.borrowerLastName === 'string') {
    const same = await db.borrower.findMany({
      where: { userId, deletedAt: null, firstName: { equals: given.borrowerFirstName.trim(), ...INSENSITIVE }, lastName: { equals: given.borrowerLastName.trim(), ...INSENSITIVE } },
      select: { id: true },
      take: 2,
    })
    if (same.length === 1) {
      given.borrowerId = same[0].id
      delete given.borrowerFirstName
      delete given.borrowerLastName
    }
  }
  const fields = await resolveNames(userId, normalizeFields(spec, given, manilaToday()))
  const funders = await resolveFunders(userId, rawFunders)
  // "How long?" comes before any date check, or the Admin is asked about a due date they never gave.
  if (typeof said === 'string' && (spec.name === 'create_loan' || spec.name === 'create_request') && !fields.pendingId && !LENGTH_SAID.test(said)) {
    return { error: 'The Admin did not say how long the loan runs. Ask (for example "4 weeks" or a due date).' }
  }
  const checked = checkProposal(spec, fields, funders)
  if (!checked.ok) return { error: checked.error }
  // The app only offers "Remove photo" when there is one; removing a photo
  // that is not there fails in storage after Confirm. Say so now instead.
  if (spec.name === 'clear_borrower_photo' && !(await borrowerPhotoUrls(userId)).has(checked.fields.borrowerId)) {
    return { error: 'That borrower has no photo to remove.' }
  }
  const proposal = await describeProposal(userId, spec, checked.fields, checked.funders)
  // Every id must point at a real record of this account, funders included,
  // or the card would ask the Admin to approve "not found".
  const unknown = proposal.lines
    .filter((line) => line.value === 'not found' || line.label.includes('not found'))
    .map((line) => line.label)
  if (unknown.length > 0) return { error: `Not found: ${unknown.join(', ')}. Look the ids up with find_borrower, list_lenders or get_loan.` }
  const ungrounded = typeof said === 'string' ? await notSaidByAdmin(userId, spec.name, checked.fields, checked.funders, said, unchanged) : null
  if (ungrounded) return { error: ungrounded }
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
