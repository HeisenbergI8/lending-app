import { db } from '../db.ts'
import { listBorrowerNames, listBorrowers } from '../borrowers/queries.ts'
import { borrowerReport, lenderReport } from '../reports/queries.ts'
import { BELONGS_TO, countCondition, lenderTopic, type Metric, type Question, readQuestion } from '../../lib/command/question.ts'
import { getLender, listLenderNames, listLenders } from '../lenders/queries.ts'
import { spellDate } from '../../lib/dates.ts'
import { toDateInput } from '../../lib/money/weeks.ts'
import { type Intent, intentByRules, isQuestion } from '../../lib/command/intents.ts'
import {
  amountsIn, clean, daySaid, readDate, entryRef, labelSaid, lengthSaid, loanRef, newNameSaid, noteBodySaid, noteRef, pesos, rateSaid,
  periodSaid, requestRef, SPLIT_EVENLY, weekNumberSaid,
} from '../../lib/command/read.ts'
import { closestNames, distance, maybeNames, tokensOf, wordNames, type Named } from './names.ts'
import { meaningOf } from './meaning.ts'
import { type Proposal } from './proposal.ts'
import { manilaToday } from './today.ts'
import { adminCut, borrowerStatement, floatingOn, lenderEarnings, moneyHistory, periodSummary, proposeAction, runTool } from './tools.ts'

/**
 * Server-made cards: common changes turned into a Confirm card by the server
 * itself, with no big AI. Free, instant, and working even when the AI is used up.
 *
 *   1. Work out the action: rules first (word lists, Taglish, typos), then the
 *      small meaning-matcher (meaning.ts) when no rule fits.
 *   2. Read the details: people against the real borrower and lender lists,
 *      amounts, dates, lengths (lib/command/read.ts).
 *   3. Anything missing or unclear: ask, with buttons. A button sends the whole
 *      sentence again with the missing part added, so what is agreed is always
 *      on screen in the Admin's chat.
 *   4. Build the card through proposeAction, the same checks an AI-made card
 *      goes through. Nothing is saved until the Admin taps Confirm on it.
 *
 * Whatever this cannot do with confidence returns null, and the big AI answers
 * as before. A wrong guess here would cost more than a few tokens there.
 */

export type Choice = { label: string; send: string }
export type ServerReply =
  | { kind: 'card'; answer: string; proposal: Proposal }
  | { kind: 'ask'; answer: string; choices: Choice[] }
  | { kind: 'answer'; answer: string }
type Say = (text: string, state?: 'done' | 'missed') => void

type Person = Named & { isSelf?: boolean }
type Ctx = { userId: string; text: string; today: string; say: Say; names?: string[] }

const CARD = 'Here is the change. Check it, then tap Confirm.'

/**
 * The period in the question, with people's names hidden first: "ni Jun" is the lender Jun, not June,
 * and "how much did Jun earn" asks about all time. The names are loaded once per message.
 */
function periodIn(ctx: Ctx) {
  const names = new Set(ctx.names ?? [])
  const text = ctx.text.replace(/[\p{L}']+/gu, (w) => (names.has(w.toLowerCase().replace(/'s$/, '')) ? 'someone' : w))
  return periodSaid(text, ctx.today)
}
const ask = (answer: string, choices: Choice[] = []): ServerReply => ({ kind: 'ask', answer, choices })
const tell = (answer: string): ServerReply => ({ kind: 'answer', answer })
const full = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`
/** The sentence again with a detail added, for a button. */
const plus = (text: string, extra: string) => `${text.trim().replace(/[.!]+$/, '')}${extra.startsWith(',') ? '' : ' '}${extra}`

const TITLES: Partial<Record<Intent, string>> = {
  create_loan: 'a new loan', create_request: 'a pending request', fund_request: 'turning a request into a loan', mark_paid: 'marking a loan paid',
  mark_week_paid: 'marking a week paid', paid_unclear: 'a payment', undo_payment: 'undoing a payment', undo_week_paid: 'undoing a paid week',
  deposit: 'money into a pot', withdraw: 'money out of a pot', record_advance: 'an advance', set_starting_capital: 'starting capital',
  set_label: "a borrower's label", create_borrower: 'a new borrower', create_lender: 'a new lender', rename: 'a new name',
  extend_loan: 'extending a loan', convert_to_weekly: 'weekly interest', add_note: 'a note', delete_note: 'deleting a note',
  add_loan_proof: 'proof the loan was sent', delete: 'deleting', restore: 'restoring', update_money: 'fixing a money entry',
  update_loan: 'fixing a loan', clear_borrower_photo: 'removing a photo', delete_request: 'removing a request',
}

// ---------------------------------------------------------------- people

/** Name words that are also ordinary words in a request, never read as a name on their own. */
const NOT_NAMES = new Set(['to', 'from', 'the', 'and', 'for', 'week', 'paid', 'loan', 'money', 'pot', 'admin', 'note', 'new', 'all', 'her', 'his', 'today', 'kay', 'ni', 'sa', 'na', 'ang', 'good', 'bad', 'okay'])
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const wordsOf = (s: string) => norm(s).split(/[^a-z]+/).filter(Boolean)

/**
 * People named in the text, in groups: one person per group when the name is
 * clear, several when it fits more than one ("Angel" for two Angels). A fuller
 * name wins over a shorter one ("Angel Dela Cruz" is not also Angel Arellano).
 */
function mentions<T extends Person>(text: string, people: T[]): T[][] {
  const said = tokensOf(text)
  const hits = people
    .map((p) => {
      const parts = wordsOf(full(p)).filter((x) => x.length > 1 && !NOT_NAMES.has(x))
      const at = new Set<number>()
      let score = 0
      for (const part of parts) {
        const i = said.findIndex((_, k) => !at.has(k) && wordNames(said, k, part))
        if (i >= 0) {
          at.add(i)
          // The exact name beats a one-letter-off one on the same word: "Mary" is Mary, not also Mark.
          score += said[i].word === part ? 1 : 0.5
        }
      }
      return { p, at, score }
    })
    .filter((h) => h.score > 0)
  const kept = hits.filter((h) => !hits.some((o) => o.score > h.score && [...h.at].every((i) => o.at.has(i))))
  const groups: { at: Set<number>; people: T[] }[] = []
  for (const h of kept.sort((a, b) => Math.min(...a.at) - Math.min(...b.at))) {
    const g = groups.find((x) => [...h.at].some((i) => x.at.has(i)))
    if (g) {
      g.people.push(h.p)
      h.at.forEach((i) => g.at.add(i))
    } else groups.push({ at: new Set(h.at), people: [h.p] })
  }
  return groups.map((g) => g.people)
}

/** How many parts of a person's name the text says: "Maria Cruz" says 2 of Maria Cruz, 1 of Angel Dela Cruz. */
function nameParts(text: string, p: { firstName: string; lastName: string }): number {
  const said = tokensOf(text)
  return wordsOf(full(p)).filter((x) => x.length > 1 && !NOT_NAMES.has(x) && said.some((_, k) => wordNames(said, k, x))).length
}

/** "Which Angel?" with a button per person; the button sends the sentence with the full name in. */
function whichPerson(text: string, people: Person[], role: string): ServerReply {
  const said = wordsOf(text)
  const shared = said.find((w) => people.every((p) => wordsOf(full(p)).some((x) => x === w || (x.length >= 4 && distance(w, x) <= 1)))) ?? ''
  const re = new RegExp(`\\b${shared}\\b`, 'i')
  return ask(
    `Which ${role} do you mean?`,
    people.map((p) => ({ label: full(p), send: shared ? text.replace(re, full(p)) : plus(text, `(${full(p)})`) })),
  )
}

/** Close names for words that matched nobody, as "did you mean" buttons. Null when nothing is close. */
function didYouMean(text: string, people: Person[], role: string): ServerReply | null {
  for (const w of maybeNames(text).filter((x) => !NOT_NAMES.has(x))) {
    const close = closestNames(w, people)
    if (close.length > 0) {
      const re = new RegExp(`\\b${w}\\b`, 'i')
      return ask(`I couldn't find a ${role} called "${w}". Did you mean:`, close.map((p) => ({ label: full(p), send: text.replace(re, full(p)) })))
    }
  }
  return null
}

const ADMIN_WORDS = /\b(admin|my pot|my money|own money|own pot|from me|sarili|akin|from my)\b/i

/** Exactly one person for a role, or the question to ask, or null when nobody is named (the AI takes it). */
function onePerson<T extends Person>(ctx: Ctx, part: string, people: T[], role: string): T | ServerReply | null {
  const groups = mentions(part, people)
  if (groups.length === 0) return didYouMean(part, people, role)
  if (groups[0].length > 1) return whichPerson(ctx.text, groups[0], role)
  ctx.say(`Found ${full(groups[0][0])}`)
  return groups[0][0]
}
const isReply = (x: unknown): x is ServerReply => !!x && typeof x === 'object' && 'kind' in x

/** The part naming who the money comes from ("from Maria and Jun"), and the rest. */
function splitFrom(text: string): { before: string; after: string } {
  const m = /\b(from|galing (?:kay|sa)|out of|sa pot ni|sa pera ni|funded by|using)\b/i.exec(text)
  return m ? { before: text.slice(0, m.index), after: text.slice(m.index) } : { before: text, after: '' }
}

// ---------------------------------------------------------------- loans and entries

type LoanRow = { id: string; capitalCentavos: number; startOn: Date; dueOn: Date; status: string; interestCollection: string; termDays: number }
const LOAN_SELECT = { id: true, capitalCentavos: true, startOn: true, dueOn: true, status: true, interestCollection: true, termDays: true } as const
const day = (d: Date) => d.toISOString().slice(0, 10)
const describeLoan = (l: LoanRow) => `the ${pesos(l.capitalCentavos / 100)} loan from ${spellDate(day(l.startOn))}`

/**
 * The one loan meant, among a borrower's loans that fit. A reference added by
 * a button decides; otherwise one loan is that loan, and several are a question.
 */
function pickLoan(ctx: Ctx, who: Person, loans: LoanRow[], none: string): LoanRow | ServerReply {
  const ref = loanRef(ctx.text)
  if (ref) {
    const hit = loans.find((l) => l.capitalCentavos === Math.round(ref.capital * 100) && spellDate(day(l.startOn)).toLowerCase() === ref.start.toLowerCase())
    if (hit) return hit
  }
  if (loans.length === 0) return tell(none)
  if (loans.length === 1) return loans[0]
  return ask(
    `${who.firstName} has ${loans.length} loans. Which one?`,
    loans.map((l) => ({ label: `${pesos(l.capitalCentavos / 100)} · due ${spellDate(day(l.dueOn))}`, send: plus(ctx.text, `(${describeLoan(l)})`) })),
  )
}

async function loansOf(userId: string, borrowerId: string, where: Record<string, unknown> = { deletedAt: null, status: 'ACTIVE' }) {
  return (await db.loan.findMany({ where: { userId, borrowerId, ...where }, orderBy: { startOn: 'desc' }, select: LOAN_SELECT })) as LoanRow[]
}

async function paidWeeks(userId: string, loanId: string): Promise<number[]> {
  const rows = await db.payment.findMany({ where: { userId, loanId, deletedAt: null, weekNumber: { not: null } }, select: { weekNumber: true } })
  return rows.map((r) => r.weekNumber!).sort((a, b) => a - b)
}

// ---------------------------------------------------------------- the card

/** The card, through the same checks as an AI-made card; or the question its check raises, in plain words. */
async function card(ctx: Ctx, action: string, fields: Record<string, unknown>, funders?: { lenderId: string; amount: string }[]): Promise<ServerReply | null> {
  const r = (await proposeAction(ctx.userId, { action, fields, ...(funders ? { funders } : {}), _said: ctx.text })) as { proposal?: Proposal; error?: string }
  if (r.proposal) {
    ctx.say('Change ready for you to check')
    return { kind: 'card', answer: CARD, proposal: r.proposal }
  }
  const error = r.error ?? ''
  ctx.say('A detail needs checking', 'missed')
  if (/how long the loan runs/.test(error)) return askLength(ctx)
  const tryDates = /Try (\w+ \d{1,2}, \d{4})(?: or (\w+ \d{1,2}, \d{4}))?/.exec(error)
  if (tryDates) {
    const base = ctx.text.replace(/\b((for|in|within|sa loob ng)\s+)?\d+\s*(days?|araw)\b|\b(due|until|hanggang|by)\s+.*$/i, '').trim()
    const spelled = (d: string) => { const iso = readDate(d, ctx.today); return iso ? spellDate(iso) : d }
    return ask(`${error.replace(/\s*Try .*$/, '')} Loans run in whole weeks. Which due date?`, [tryDates[1], tryDates[2]].filter(Boolean).map((d) => ({ label: spelled(d), send: plus(base, `until ${d}`) })))
  }
  if (/how much from each lender/.test(error)) return tell('How much is from each lender? For example: "6k from Maria and 4k from Jun", or say "split evenly".')
  if (/did not say \w+/.test(error)) return tell('How much? Please say the amount, for example "5k" or "₱5,000".')
  // Ids, names or fields the server could not settle: the big AI takes it from here.
  if (/Missing:|must be one of|Not found|did not name|No action/.test(error)) return null
  const why = error.replace(/\s*Ask\b[^.]*\.?/g, '').trim()
  return tell(`I can't make that card: ${why.charAt(0).toLowerCase()}${why.slice(1)}`)
}

function askLength(ctx: Ctx): ServerReply {
  return ask('How long is the loan?', [1, 2, 3, 4].map((n) => ({ label: `${n} week${n > 1 ? 's' : ''}`, send: plus(ctx.text, `for ${n} week${n > 1 ? 's' : ''}`) })))
}

// ---------------------------------------------------------------- per action

/** Lenders named in the "from ..." part, the Admin's own pot included, or the question. */
/** A month right after "starting", "until" or "due" is a date, not a person: "starting Jun 30" is not the lender Jun. */
const DATED_MONTH = /\b(starting|start|starts|on|until|due|by|hanggang|simula)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi

async function lendersFor(ctx: Ctx, part: string, all: Person[]): Promise<Person[] | ServerReply> {
  // A borrower named where the lenders go is said back, never quietly dropped.
  const lenderWords = new Set(all.flatMap((l) => wordsOf(full(l))))
  const borrowerThere = mentions(part.replace(DATED_MONTH, ' '), await listBorrowerNames(ctx.userId)).flat().find((b) => !wordsOf(full(b)).some((w) => lenderWords.has(w)))
  if (borrowerThere) return tell(`${full(borrowerThere)} is a borrower, not a lender, so they can't fund a loan. Which lenders is it from?`)
  const groups = mentions(part.replace(DATED_MONTH, ' '), all.filter((l) => !l.isSelf))
  const ambiguous = groups.find((g) => g.length > 1)
  if (ambiguous) return whichPerson(ctx.text, ambiguous, 'lender')
  const picked = groups.map((g) => g[0])
  const self = all.find((l) => l.isSelf)
  if (self && ADMIN_WORDS.test(part)) picked.unshift(self)
  if (picked.length === 0) {
    const pots = await listLenders(ctx.userId)
    return ask(
      'Which lender is the money from?',
      pots.map((l) => ({ label: `${full(l)} · ${pesos(l.position.floating / 100)} floating`, send: plus(ctx.text, `from ${l.isSelf ? 'my pot' : full(l)}`) })),
    )
  }
  picked.forEach((l) => ctx.say(`Found ${full(l)} (lender)`))
  return picked
}

/** A lender asked for more than they have floating: said now, before a card that Confirm would refuse. */
async function notEnough(userId: string, funders: { lenderId: string; amount: string }[], verb = 'lend'): Promise<ServerReply | null> {
  const pots = await listLenders(userId)
  for (const f of funders) {
    const pot = pots.find((l) => full(l).toLowerCase() === f.lenderId.toLowerCase())
    if (pot && Number(f.amount) * 100 > pot.position.floating) {
      return tell(`${pot.isSelf ? 'Your pot' : pot.firstName} only has ${pesos(pot.position.floating / 100)} floating, so ${pot.isSelf ? 'you' : pot.firstName} can't ${verb} ${pesos(Number(f.amount))}.`)
    }
  }
  return null
}

const AMOUNT = '₱?\\s?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:k|thousand|libo)?'

/** How much each lender gives: "6k from Maria and 4k from Jun", "Maria 6k", "5k each", "split evenly". */
function shares(text: string, lenders: Person[], capital: number | null): { lenderId: string; amount: string }[] | null {
  const t = clean(text)
  if (lenders.length === 1) return capital ? [{ lenderId: full(lenders[0]), amount: String(capital) }] : null
  const own = lenders.map((l) => {
    const names = wordsOf(full(l)).filter((x) => x.length > 1).join('|')
    const word = l.isSelf ? '(?:my pot|my money|admin|me)' : `(?:${names})`
    const m = new RegExp(`(${AMOUNT})\\s+(?:from|galing kay|kay)?\\s*${word}\\b|\\b${word}(?:'s)?\\s*(?:pot)?\\s*(?:=|:|,)?\\s*(${AMOUNT})`).exec(t)
    const v = m ? amountsInOne(m[1] ?? m[2]) : null
    return v
  })
  if (own.every((v) => v !== null)) return lenders.map((l, i) => ({ lenderId: full(l), amount: String(own[i]) }))
  if (SPLIT_EVENLY.test(t) && capital) {
    const each = /\beach\b|\btig-?\w*/.test(t) && !/\b(half|evenly|equally|hati)\b/.test(t) ? capital : capital / lenders.length
    if (Math.round(each * 100) === each * 100) return lenders.map((l) => ({ lenderId: full(l), amount: String(each) }))
  }
  return null
}
/** 12000 → "12k" for an example sentence. */
const amountWords = (n: number) => (n % 1000 === 0 ? `${n / 1000}k` : String(n))
const amountsInOne = (s: string) => amountsIn(s.replace(/₱\s?/, '₱'))[0] ?? null

/** The text with one person's name words blanked out, so they are not read again as someone else. */
function withoutName(text: string, p: Person): string {
  const parts = wordsOf(full(p)).filter((x) => x.length > 1 && !NOT_NAMES.has(x))
  const tokens = tokensOf(text)
  let k = -1
  return text.replace(/[\p{L}']+/gu, (w) => {
    if (!/[A-Za-z]/.test(norm(w))) return w
    k++
    return parts.some((x) => wordNames(tokens, k, x)) ? ' ' : w
  })
}

/** Where the borrower comes after "from": "from Maria to Rico", "galing kay Maria para kay Rico". "galing kay" is the lender's. */
const TO_BORROWER = /\b(?<!galing\s)(to|kay|para kay|para sa|para)\s+/gi

/**
 * The borrower, and the part of the sentence that names the lenders. Usually the
 * borrower comes before "from" ("lend Rico 5k from Maria"). Said the other way
 * round ("from Maria's pot 5k to Rico", or with no "to" at all: "from Maria, Rico
 * 5k"), the borrower is found after it, with the lenders' own names set aside first.
 */
function borrowerAndLenders(ctx: Ctx, borrowers: Person[], lenders: Person[]): { borrower: Person | ServerReply | null; lenderPart: string } {
  const { before, after } = splitFrom(ctx.text)
  const asBefore = (borrower: Person | ServerReply | null) => ({
    borrower,
    lenderPart: after || (borrower && !isReply(borrower) ? ctx.text.replace(new RegExp(`\\b${borrower.firstName}\\b`, 'i'), '') : ctx.text),
  })
  if (!after || mentions(before, borrowers).length > 0) return asBefore(onePerson(ctx, before, borrowers, 'borrower'))
  for (const m of after.matchAll(TO_BORROWER)) {
    const rest = after.slice(m.index + m[0].length)
    if (mentions(rest, borrowers).length === 0) continue
    const borrower = onePerson(ctx, rest, borrowers, 'borrower')
    if (!borrower || isReply(borrower)) return { borrower, lenderPart: after }
    return { borrower, lenderPart: `${after.slice(0, m.index)} ${withoutName(rest, borrower)}` }
  }
  const rest = mentions(after, lenders).flat().reduce(withoutName, after)
  if (mentions(rest, borrowers).length === 1) {
    const borrower = onePerson(ctx, rest, borrowers, 'borrower')
    if (!borrower || isReply(borrower)) return { borrower, lenderPart: after }
    return { borrower, lenderPart: withoutName(after, borrower) }
  }
  return asBefore(onePerson(ctx, before, borrowers, 'borrower'))
}

async function newLoan(ctx: Ctx): Promise<ServerReply | null> {
  const lenderNames = await listLenderNames(ctx.userId)
  const { borrower, lenderPart } = borrowerAndLenders(ctx, await listBorrowerNames(ctx.userId), lenderNames)
  if (!borrower || isReply(borrower)) return borrower
  const lenders = await lendersFor(ctx, lenderPart, lenderNames)
  if (isReply(lenders)) return lenders
  const amounts = amountsIn(ctx.text)
  const length = lengthSaid(ctx.text, ctx.today)
  if (amounts.length === 0) return tell(`How much is the loan to ${borrower.firstName}? For example "10k".`)
  if (!length) return askLength(ctx)
  if (length.months) return ask('How many weeks is that?', [4, 8, 12].map((n) => ({ label: `${n} weeks`, send: ctx.text.replace(/\b\S+\s*(months?|buwan)\b/i, `${n} weeks`) })))
  // The total is the one amount said by itself; with per-lender amounts it is their sum.
  const each = /\beach\b|\btig-?\w*/.test(clean(ctx.text))
  const funders = shares(ctx.text, lenders, each ? amounts[0] : (amounts.length === 1 || lenders.length === 1 ? amounts[0] : null))
  if (!funders) {
    const total = amounts.length === 1 ? amounts[0] : null
    return ask(
      `How much is from each lender?${total ? ` The loan is ${pesos(total)}.` : ''} Say it like "6k from ${lenders[0].firstName} and 4k from ${lenders[1]?.firstName ?? 'Jun'}".`,
      total && Math.round((total / lenders.length) * 100) === (total / lenders.length) * 100 ? [{ label: `Split evenly (${pesos(total / lenders.length)} each)`, send: plus(ctx.text, ', split evenly') }] : [],
    )
  }
  const short = await notEnough(ctx.userId, funders)
  if (short) return short
  const capital = funders.reduce((s, f) => s + Number(f.amount), 0)
  const start = daySaid(splitDue(ctx.text), ctx.today, 'future') ?? ctx.today
  const rate = rateSaid(ctx.text)
  return card(ctx, 'create_loan', {
    borrowerId: full(borrower),
    capital: String(capital),
    startOn: start,
    ...(length.weeks ? { weeks: String(length.weeks) } : {}),
    ...(length.days ? { days: String(length.days) } : {}),
    ...(length.dueOn ? { dueOn: length.dueOn } : {}),
    ...(rate !== null ? { borrowerRate: String(rate) } : {}),
  }, funders)
}
/** The text without its "due ..." part, so a due date is never read as the start. */
const splitDue = (text: string) => text.replace(/\b(due|until|hanggang|by|ending|ends?)\b.*$/i, '')

async function newRequest(ctx: Ctx): Promise<ServerReply | null> {
  const borrower = onePerson(ctx, ctx.text, await listBorrowerNames(ctx.userId), 'borrower')
  if (!borrower || isReply(borrower)) return borrower
  const [amount] = amountsIn(ctx.text)
  if (!amount) return tell(`How much does ${borrower.firstName} want to borrow?`)
  const length = lengthSaid(ctx.text, ctx.today)
  if (!length || length.months) return askLength(ctx)
  const start = daySaid(splitDue(ctx.text), ctx.today, 'future') ?? ctx.today
  const rate = rateSaid(ctx.text)
  const custom = length.days || length.dueOn
  return card(ctx, 'create_request', {
    borrowerId: full(borrower),
    capital: String(amount),
    termChoice: custom ? 'custom' : 'weeks',
    ...(custom ? { startOn: start, dueOn: length.dueOn ?? addDaysTo(start, length.days!) } : { weeks: String(length.weeks) }),
    ...(rate !== null ? { borrowerRate: String(rate) } : {}),
  })
}
const addDaysTo = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

async function fundRequest(ctx: Ctx): Promise<ServerReply | null> {
  const requests = await db.pendingLoan.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: 'asc' }, select: { id: true, firstName: true, lastName: true, capitalCentavos: true } })
  const { before, after } = splitFrom(ctx.text)
  const groups = mentions(before, requests.map((r) => ({ ...r, id: r.id })))
  if (groups.length === 0) return requests.length === 0 ? tell('There are no pending requests.') : null
  let rows = groups[0]
  const ref = requestRef(ctx.text)
  if (ref) rows = rows.filter((r) => r.capitalCentavos === Math.round(ref.capital * 100))
  if (rows.length > 1) {
    return ask('Which request?', rows.map((r) => ({ label: `${full(r)} · ${pesos(r.capitalCentavos / 100)}`, send: plus(ctx.text, `(the ${pesos(r.capitalCentavos / 100)} request)`) })))
  }
  const request = rows[0]
  ctx.say(`Found ${full(request)}'s request`)
  const lenders = await lendersFor(ctx, after || ctx.text, await listLenderNames(ctx.userId))
  if (isReply(lenders)) return lenders
  const funders = shares(ctx.text, lenders, request.capitalCentavos / 100)
  const short = funders ? await notEnough(ctx.userId, funders) : null
  if (short) return short
  if (!funders) return ask(`How much is from each lender? The request is ${pesos(request.capitalCentavos / 100)}.`, [{ label: 'Split evenly', send: plus(ctx.text, ', split evenly') }])
  return card(ctx, 'create_loan', { pendingId: request.id }, funders)
}

async function payment(ctx: Ctx, intent: 'mark_paid' | 'mark_week_paid' | 'paid_unclear'): Promise<ServerReply | null> {
  const who = onePerson(ctx, ctx.text, await listBorrowerNames(ctx.userId), 'borrower')
  if (!who || isReply(who)) return who
  const loan = pickLoan(ctx, who, await loansOf(ctx.userId, who.id), `${who.firstName} has no unpaid loan.`)
  if (isReply(loan)) return loan
  const paidOn = daySaid(ctx.text, ctx.today, 'past') ?? ctx.today
  const weekly = loan.interestCollection === 'WEEKLY'
  const weeks = Math.round(loan.termDays / 7)
  const paid = weekly ? await paidWeeks(ctx.userId, loan.id) : []
  const next = (paid.at(-1) ?? 0) + 1
  if (intent === 'paid_unclear') {
    // "Lyn paid": on a weekly loan with weeks still to go, a week or the whole loan are both likely.
    if (weekly && next < weeks) {
      return ask(`Did ${who.firstName} pay week ${next}'s interest, or the whole loan?`, [
        { label: `Week ${next} only`, send: `${who.firstName} paid week ${next} interest (${describeLoan(loan)})` },
        { label: 'The whole loan', send: `${who.firstName} paid in full (${describeLoan(loan)})` },
      ])
    }
    intent = 'mark_paid'
  }
  if (intent === 'mark_week_paid') {
    if (!weekly) {
      return ask(`${who.firstName}'s loan collects interest at the end, not every week. Did ${who.firstName} pay the whole loan?`, [
        { label: 'Yes, paid in full', send: `${who.firstName} paid in full (${describeLoan(loan)})` },
      ])
    }
    const said = weekNumberSaid(ctx.text)
    if (said !== null && paid.includes(said)) return tell(`Week ${said} of ${who.firstName}'s loan is already paid. The next unpaid week is week ${next}.`)
    if (said !== null && said > next) {
      return ask(`Week ${next} comes before week ${said}, and the app marks weeks in order. Mark week ${next} paid?`, [
        { label: `Mark week ${next} paid`, send: `${who.firstName} paid week ${next} (${describeLoan(loan)})` },
      ])
    }
    if (next >= weeks) {
      return ask(`Week ${next} is the last week, so it settles the whole loan. Mark ${who.firstName}'s loan paid in full?`, [
        { label: 'Yes, paid in full', send: `${who.firstName} paid in full (${describeLoan(loan)})` },
      ])
    }
    return card(ctx, 'mark_week_paid', { loanId: loan.id, paidOn })
  }
  return card(ctx, 'mark_paid', { loanId: loan.id, paidOn })
}

async function undoPayment(ctx: Ctx, week: boolean): Promise<ServerReply | null> {
  const who = onePerson(ctx, ctx.text, await listBorrowerNames(ctx.userId), 'borrower')
  if (!who || isReply(who)) return who
  if (!week) {
    const loan = pickLoan(ctx, who, await loansOf(ctx.userId, who.id, { deletedAt: null, status: 'PAID' }), `${who.firstName} has no paid loan to undo.`)
    if (isReply(loan)) return loan
    return card(ctx, 'undo_payment', { loanId: loan.id })
  }
  const weeklyLoans = (await loansOf(ctx.userId, who.id)).filter((l) => l.interestCollection === 'WEEKLY')
  const loan = pickLoan(ctx, who, weeklyLoans, `${who.firstName} has no weekly loan.`)
  if (isReply(loan)) return loan
  const paid = await paidWeeks(ctx.userId, loan.id)
  if (paid.length === 0) return tell(`No week of ${who.firstName}'s loan is marked paid yet.`)
  const said = weekNumberSaid(ctx.text)
  if (said === null) return ask('Which week should I undo?', paid.slice().reverse().map((n) => ({ label: `Week ${n}`, send: plus(ctx.text, `week ${n}`) })))
  if (!paid.includes(said)) return tell(`Week ${said} isn't marked paid. Paid weeks: ${paid.join(', ')}.`)
  return card(ctx, 'undo_week_paid', { loanId: loan.id, weekNumber: String(said) })
}

async function money(ctx: Ctx, type: 'DEPOSIT' | 'WITHDRAWAL'): Promise<ServerReply | null> {
  const all = await listLenderNames(ctx.userId)
  const self = all.find((l) => l.isSelf)
  let lender: Person | ServerReply | null = self && ADMIN_WORDS.test(ctx.text) ? self : onePerson(ctx, ctx.text, all.filter((l) => !l.isSelf), 'lender')
  if (!lender) {
    // A borrower named instead of a lender: this is not money in or out of a pot.
    if (mentions(ctx.text, await listBorrowerNames(ctx.userId)).length > 0) return null
    const pots = await listLenders(ctx.userId)
    return ask(`Whose pot is the ${type === 'DEPOSIT' ? 'deposit into' : 'withdrawal from'}?`, pots.map((l) => ({ label: full(l), send: plus(ctx.text, l.isSelf ? '(my pot)' : `(${full(l)})`) })))
  }
  if (isReply(lender)) return lender
  if (lender === self) ctx.say('Found your own pot')
  const [amount] = amountsIn(ctx.text)
  if (!amount) return tell(`How much did ${lender.isSelf ? 'you' : lender.firstName} ${type === 'DEPOSIT' ? 'put in' : 'take out'}?`)
  const note = noteBodySaid(ctx.text)
  lender = lender as Person
  if (type === 'WITHDRAWAL') {
    const short = await notEnough(ctx.userId, [{ lenderId: full(lender), amount: String(amount) }], 'take out')
    if (short) return short
  }
  return card(ctx, 'record_money', {
    lenderId: full(lender),
    type,
    amount: String(amount),
    occurredOn: daySaid(ctx.text, ctx.today, 'past') ?? ctx.today,
    ...(note ? { note } : {}),
  })
}

async function borrowerLoanAction(ctx: Ctx, action: string, none: string, filter: (l: LoanRow) => boolean = () => true, where?: Record<string, unknown>) {
  const who = onePerson(ctx, ctx.text, await listBorrowerNames(ctx.userId), 'borrower')
  if (!who || isReply(who)) return { reply: who }
  const loan = pickLoan(ctx, who, (await loansOf(ctx.userId, who.id, where)).filter(filter), none.replace('{name}', who.firstName))
  if (isReply(loan)) return { reply: loan }
  return { who, loan }
}

async function extend(ctx: Ctx): Promise<ServerReply | null> {
  const r = await borrowerLoanAction(ctx, 'extend_loan', '{name} has no unpaid loan to extend.')
  if (!r.loan) return r.reply ?? null
  const length = lengthSaid(ctx.text, ctx.today)
  if (!length?.weeks) return ask('Extend by how many weeks?', [1, 2, 3, 4].map((n) => ({ label: `${n} week${n > 1 ? 's' : ''}`, send: `extend ${r.who!.firstName}'s loan by ${n} week${n > 1 ? 's' : ''} (${describeLoan(r.loan!)})` })))
  const paidNow = /\b(paid|bayad|nagbayad)\b.{0,30}\b(now|today|already|na)\b|\binterest (is )?paid\b/i.test(ctx.text)
  return card(ctx, 'extend_loan', { loanId: r.loan.id, weeks: String(length.weeks), ...(paidNow ? { paidNow: 'yes' } : {}) })
}

async function noteAction(ctx: Ctx, add: boolean): Promise<ServerReply | null> {
  const r = await borrowerLoanAction(ctx, add ? 'add_note' : 'delete_note', '{name} has no loan to put a note on.', () => true, { deletedAt: null })
  if (!r.loan) return r.reply ?? null
  if (add) {
    const body = noteBodySaid(ctx.text)
    if (!body) return tell('What should the note say? For example: note on Dan\'s loan: "will pay Friday".')
    return card(ctx, 'add_note', { loanId: r.loan.id, body })
  }
  const notes = await db.loanNote.findMany({ where: { userId: ctx.userId, loanId: r.loan.id }, orderBy: { createdAt: 'desc' }, select: { id: true, body: true } })
  if (notes.length === 0) return tell(`There's no note on ${r.who!.firstName}'s loan.`)
  const ref = noteRef(ctx.text)
  const hit = ref ? notes.find((n) => n.body.toLowerCase().startsWith(ref.toLowerCase())) : notes.length === 1 ? notes[0] : null
  if (!hit) return ask('Which note?', notes.map((n) => ({ label: n.body.slice(0, 50), send: plus(ctx.text, `(the note "${n.body.slice(0, 30)}")`) })))
  return card(ctx, 'delete_note', { noteId: hit.id })
}

/** A lender's money entry: a button's reference, or the one matching an amount or day said, or a question. */
async function pickEntry(ctx: Ctx, lender: Person, deleted: boolean): Promise<{ id: string; type: string; amountCentavos: number; occurredOn: Date; note: string | null } | ServerReply> {
  const rows = await db.lenderTransaction.findMany({
    where: { userId: ctx.userId, lenderId: lender.id, deletedAt: deleted ? { not: null } : null },
    orderBy: { occurredOn: 'desc' },
    take: 8,
    select: { id: true, type: true, amountCentavos: true, occurredOn: true, note: true },
  })
  const label = (t: { type: string; amountCentavos: number; occurredOn: Date }) => `the ${t.type === 'DEPOSIT' ? 'deposit' : 'withdrawal'} of ${pesos(t.amountCentavos / 100)} on ${spellDate(day(t.occurredOn))}`
  // "fix Maria's deposit": only her deposits. The reference a button adds is not read for this.
  const plain = clean(ctx.text.replace(/\(the [^)]*\)/i, ''))
  const kind = /\bdeposit/.test(plain) && !/\bwithdraw/.test(plain) ? 'DEPOSIT' : /\bwithdraw/.test(plain) && !/\bdeposit/.test(plain) ? 'WITHDRAWAL' : null
  if (kind && !entryRef(ctx.text)) rows.splice(0, rows.length, ...rows.filter((t) => t.type === kind))
  const ref = entryRef(ctx.text)
  if (ref) {
    const hit = rows.find((t) => t.type === ref.type && t.amountCentavos === Math.round(ref.amount * 100) && spellDate(day(t.occurredOn)).toLowerCase() === ref.date.toLowerCase())
    if (hit) return hit
  }
  if (rows.length === 0) return tell(`${lender.isSelf ? 'Your pot' : `${lender.firstName}'s pot`} has no ${deleted ? 'deleted ' : ''}money entries.`)
  if (rows.length === 1) return rows[0]
  return ask('Which entry?', rows.map((t) => ({ label: `${t.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} · ${pesos(t.amountCentavos / 100)} · ${spellDate(day(t.occurredOn))}`, send: plus(ctx.text.replace(/\bto\s+₱?[\d,.]+k?\b.*$/i, ''), `(${label(t)})${/\bto\s+₱?[\d,.]+/i.test(ctx.text) ? ' ' + /\bto\s+₱?[\d,.]+\s*k?/i.exec(ctx.text)![0] : ''}`) })))
}

async function updateMoney(ctx: Ctx): Promise<ServerReply | null> {
  const lender = onePerson(ctx, ctx.text, await listLenderNames(ctx.userId), 'lender')
  if (!lender || isReply(lender)) return lender
  const entry = await pickEntry(ctx, lender, false)
  if (isReply(entry)) return entry
  const after = /\bto\s+(.+)$/i.exec(ctx.text.replace(/\(the [^)]*\)/i, ''))
  const amount = after ? amountsIn(after[1])[0] : undefined
  const date = after ? daySaid(after[1], ctx.today, 'past') : null
  const type = /\bto (a )?withdrawal\b/i.test(ctx.text) ? 'WITHDRAWAL' : /\bto (a )?deposit\b/i.test(ctx.text) ? 'DEPOSIT' : entry.type
  if (!amount && !date && type === entry.type) return tell('What should it be changed to? For example "to 6k" or "to yesterday".')
  return card(ctx, 'update_money', {
    transactionId: entry.id,
    type,
    amount: String(amount ?? entry.amountCentavos / 100),
    occurredOn: date ?? day(entry.occurredOn),
    ...(entry.note ? { note: entry.note } : {}),
  })
}

async function updateLoan(ctx: Ctx): Promise<ServerReply | null> {
  // An unpaid loan is the one being fixed; a paid one only when there is no unpaid one.
  const unpaid = await borrowerLoanAction(ctx, 'update_loan', '', () => true)
  const r = unpaid.loan || (unpaid.reply && unpaid.reply.kind === 'ask') ? unpaid : await borrowerLoanAction(ctx, 'update_loan', '{name} has no loan to fix.', () => true, { deletedAt: null })
  if (!r.loan) return r.reply ?? null
  const after = /\bto\s+(.+)$/i.exec(ctx.text.replace(/\(the [^)]*\)/i, ''))?.[1] ?? ''
  const change: Record<string, unknown> = {}
  const rate = rateSaid(after)
  if (rate !== null) change.borrowerRate = String(rate)
  const length = lengthSaid(after, ctx.today)
  if (length?.weeks) change.weeks = String(length.weeks)
  if (length?.dueOn) change.dueOn = length.dueOn
  const [amount] = amountsIn(after)
  if (amount && rate === null) change.capital = String(amount)
  if (/\bstart/i.test(ctx.text)) {
    const start = daySaid(after, ctx.today, 'past')
    if (start) change.startOn = start
  }
  // Anything this cannot read (a funder change, interest basis) is the big AI's.
  if (Object.keys(change).length === 0) return null
  // A new amount moves the lenders' shares too. With one lender, all of it is theirs; with several, the Admin says how.
  if (change.capital) {
    const funding = await db.loanFunding.findMany({ where: { userId: ctx.userId, loanId: r.loan.id }, select: { lender: { select: { firstName: true, lastName: true, isSelf: true } } } })
    if (funding.length === 1) return card(ctx, 'update_loan', { loanId: r.loan.id, ...change }, [{ lenderId: full(funding[0].lender), amount: String(change.capital) }])
    const named = await lendersFor(ctx, splitFrom(ctx.text).after, await listLenderNames(ctx.userId))
    const funders = !isReply(named) && splitFrom(ctx.text).after ? shares(ctx.text, named, Number(change.capital)) : null
    if (!funders) return tell(`This loan has ${funding.length} lenders. How much from each at ${pesos(Number(change.capital))}? For example: "change ${r.who!.firstName}'s loan to ${amountWords(Number(change.capital))}, 7k from ${funding[0].lender.isSelf ? 'my pot' : funding[0].lender.firstName} and 5k from ${funding[1].lender.isSelf ? 'my pot' : funding[1].lender.firstName}".`)
    return card(ctx, 'update_loan', { loanId: r.loan.id, ...change }, funders)
  }
  return card(ctx, 'update_loan', { loanId: r.loan.id, ...change })
}

async function deleteOrRestore(ctx: Ctx, restore: boolean): Promise<ServerReply | null> {
  const t = clean(ctx.text)
  const deletedOnly = restore ? { not: null } : null
  if (/\b(deposit|withdrawal|entry|money)\b/.test(t)) {
    const lenders = await db.lender.findMany({ where: { userId: ctx.userId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, isSelf: true } })
    const lender = onePerson(ctx, ctx.text, lenders, 'lender')
    if (!lender || isReply(lender)) return lender
    const entry = await pickEntry(ctx, lender, restore)
    if (isReply(entry)) return entry
    return card(ctx, restore ? 'restore_money' : 'delete_money', { transactionId: entry.id })
  }
  if (/\bloan\b/.test(t)) {
    const r = await borrowerLoanAction(ctx, restore ? 'restore_loan' : 'delete_loan', restore ? '{name} has no deleted loan.' : '{name} has no loan to delete.', () => true, { deletedAt: deletedOnly })
    if (!r.loan) return r.reply ?? null
    return card(ctx, restore ? 'restore_loan' : 'delete_loan', { loanId: r.loan.id })
  }
  // A person: a borrower or a lender, whichever list the name is on (deleted ones, to restore).
  const [borrowers, lenders] = await Promise.all([
    db.borrower.findMany({ where: { userId: ctx.userId, deletedAt: deletedOnly }, select: { id: true, firstName: true, lastName: true } }),
    db.lender.findMany({ where: { userId: ctx.userId, deletedAt: deletedOnly, isSelf: false }, select: { id: true, firstName: true, lastName: true } }),
  ])
  const wantsLender = /\b(lender|investor|funder)\b/.test(t)
  const wantsBorrower = /\bborrower\b/.test(t)
  const b = wantsLender ? [] : mentions(ctx.text, borrowers)
  const l = wantsBorrower ? [] : mentions(ctx.text, lenders)
  // The fuller match wins: "Maria Cruz" is the lender Maria Cruz, not the borrower Angel Dela Cruz.
  if (b.length > 0 && l.length > 0) {
    const bs = Math.max(...b.flat().map((p) => nameParts(ctx.text, p)))
    const ls = Math.max(...l.flat().map((p) => nameParts(ctx.text, p)))
    if (bs > ls) l.splice(0)
    else if (ls > bs) b.splice(0)
  }
  if (b.length > 0 && l.length > 0) {
    return ask('Do you mean the borrower or the lender?', [
      { label: `Borrower ${full(b[0][0])}`, send: plus(ctx.text, '(the borrower)') },
      { label: `Lender ${full(l[0][0])}`, send: plus(ctx.text, '(the lender)') },
    ])
  }
  if (b.length > 0) {
    const who = onePerson(ctx, ctx.text, borrowers, 'borrower') as Person | ServerReply
    if (isReply(who)) return who
    if (restore) return card(ctx, 'restore_borrower', { borrowerId: who.id })
    const unpaid = await db.loan.count({ where: { userId: ctx.userId, borrowerId: who.id, deletedAt: null, status: 'ACTIVE' } })
    const choice = /\b(keep|leave)\b.*\bloans?\b/.test(t) ? 'keep' : /\b(and|with|plus|including)\b.*\bloans?\b/.test(t) ? 'unpaid' : unpaid === 0 ? 'keep' : null
    if (!choice) {
      return ask(`${who.firstName} has ${unpaid} unpaid loan${unpaid > 1 ? 's' : ''}. Delete ${unpaid > 1 ? 'them' : 'it'} too?`, [
        { label: 'Keep the loans', send: plus(ctx.text, '(keep the loans)') },
        { label: 'Delete the unpaid loans too', send: plus(ctx.text, '(with the unpaid loans)') },
      ])
    }
    return card(ctx, 'delete_borrower', { borrowerId: who.id, loans: choice })
  }
  if (l.length > 0) {
    const who = onePerson(ctx, ctx.text, lenders, 'lender') as Person | ServerReply
    if (isReply(who)) return who
    return card(ctx, restore ? 'restore_lender' : 'delete_lender', { lenderId: who.id })
  }
  return null
}

async function simplePerson(ctx: Ctx, intent: Intent): Promise<ServerReply | null> {
  const borrowers = await listBorrowerNames(ctx.userId)
  switch (intent) {
    case 'set_label': {
      const label = labelSaid(ctx.text)
      if (label === null) return null
      const who = onePerson(ctx, ctx.text.replace(/\b(good|okay|ok|bad)\b/gi, ' '), borrowers, 'borrower')
      if (!who || isReply(who)) return who
      return card(ctx, 'set_label', { borrowerId: full(who), label })
    }
    case 'clear_borrower_photo': {
      const who = onePerson(ctx, ctx.text, borrowers, 'borrower')
      if (!who || isReply(who)) return who
      const made = await card(ctx, 'clear_borrower_photo', { borrowerId: full(who) })
      // Said with the person's name, not "that borrower".
      return made?.kind === 'answer' && /no photo/i.test(made.answer) ? tell(`${who.firstName} has no photo to remove.`) : made
    }
    case 'create_borrower':
    case 'create_lender': {
      const name = newNameSaid(ctx.text, /\b(borrower|lender|investor|funder)s?\b(\s+(named|called|si))?/i)
      if (!name) return tell(`What is the new ${intent === 'create_borrower' ? 'borrower' : 'lender'}'s first and last name?`)
      ctx.say(`New ${intent === 'create_borrower' ? 'borrower' : 'lender'}: ${full(name)}`)
      return card(ctx, intent, name)
    }
    case 'rename': {
      const to = /\bto\s+([\p{L}' .-]+)$/u.exec(ctx.text)
      const name = to ? newNameSaid(to[0], /\bto\b/i) : null
      if (!name) return tell('What should the new name be? For example: rename Juan to Juan Cruz.')
      const before = ctx.text.slice(0, to!.index)
      const lenders = (await listLenderNames(ctx.userId)).filter((l) => !l.isSelf)
      const b = mentions(before, borrowers)
      const l = mentions(before, lenders)
      const isLender = l.length > 0 && (b.length === 0 || /\blender\b/i.test(ctx.text))
      const who = onePerson(ctx, before, isLender ? lenders : borrowers, isLender ? 'lender' : 'borrower')
      if (!who || isReply(who)) return who
      return card(ctx, isLender ? 'rename_lender' : 'rename_borrower', { [isLender ? 'lenderId' : 'borrowerId']: full(who), ...name })
    }
    case 'set_starting_capital': {
      const who = onePerson(ctx, ctx.text, await listLenderNames(ctx.userId), 'lender')
      if (!who || isReply(who)) return who
      const [amount] = amountsIn(ctx.text)
      if (!amount) return tell(`What is ${who.firstName}'s starting capital?`)
      return card(ctx, 'set_starting_capital', { lenderId: full(who), startingCapital: String(amount) })
    }
    default:
      return null
  }
}

async function deleteRequest(ctx: Ctx): Promise<ServerReply | null> {
  const requests = await db.pendingLoan.findMany({ where: { userId: ctx.userId }, select: { id: true, firstName: true, lastName: true, capitalCentavos: true } })
  const groups = mentions(ctx.text, requests)
  if (groups.length === 0) return requests.length === 0 ? tell('There are no pending requests.') : null
  let rows = groups[0]
  const ref = requestRef(ctx.text)
  if (ref) rows = rows.filter((r) => r.capitalCentavos === Math.round(ref.capital * 100))
  if (rows.length > 1) return ask('Which request?', rows.map((r) => ({ label: `${full(r)} · ${pesos(r.capitalCentavos / 100)}`, send: plus(ctx.text, `(the ${pesos(r.capitalCentavos / 100)} request)`) })))
  ctx.say(`Found ${full(rows[0])}'s request`)
  return card(ctx, 'delete_request', { pendingId: rows[0].id })
}

async function build(ctx: Ctx, intent: Intent): Promise<ServerReply | null> {
  switch (intent) {
    case 'create_loan':
      return newLoan(ctx)
    case 'create_request':
      return newRequest(ctx)
    case 'fund_request':
      return fundRequest(ctx)
    case 'mark_paid':
    case 'mark_week_paid':
    case 'paid_unclear':
      return payment(ctx, intent)
    case 'undo_payment':
      return undoPayment(ctx, false)
    case 'undo_week_paid':
      return undoPayment(ctx, true)
    case 'deposit':
      return money(ctx, 'DEPOSIT')
    case 'withdraw':
      return money(ctx, 'WITHDRAWAL')
    case 'record_advance': {
      const r = await borrowerLoanAction(ctx, 'record_advance', '{name} has no unpaid loan to take an advance on.')
      if (!r.loan) return r.reply ?? null
      const [amount] = amountsIn(ctx.text)
      if (!amount) return tell('How much is the advance?')
      return card(ctx, 'record_advance', { loanId: r.loan.id, amount: String(amount), occurredOn: daySaid(ctx.text, ctx.today, 'past') ?? ctx.today })
    }
    case 'extend_loan':
      return extend(ctx)
    case 'convert_to_weekly': {
      const r = await borrowerLoanAction(ctx, 'convert_to_weekly', "{name} has no loan that collects interest at the end.", (l) => l.interestCollection === 'AT_END')
      if (!r.loan) return r.reply ?? null
      return card(ctx, 'convert_to_weekly', { loanId: r.loan.id })
    }
    case 'add_note':
      return noteAction(ctx, true)
    case 'delete_note':
      return noteAction(ctx, false)
    case 'add_loan_proof': {
      const r = await borrowerLoanAction(ctx, 'add_loan_proof', '{name} has no loan.', () => true, { deletedAt: null })
      if (!r.loan) return r.reply ?? null
      return card(ctx, 'add_loan_proof', { loanId: r.loan.id })
    }
    case 'update_money':
      return updateMoney(ctx)
    case 'update_loan':
      return updateLoan(ctx)
    case 'delete':
      return deleteOrRestore(ctx, false)
    case 'restore':
      return deleteOrRestore(ctx, true)
    case 'delete_request':
      return deleteRequest(ctx)
    case 'question':
      return null
    default:
      return simplePerson(ctx, intent)
  }
}

// ---------------------------------------------------------------- the app's screens, read by the server

/** "this month", "in October 2026", "from November 01, 2026 to November 04, 2026": how a period reads in an answer. */
function whenText(period: { from: string; to: string; label: string }): string {
  if (period.label === 'that time') return `from ${spellDate(period.from)} to ${spellDate(period.to)}`
  return /^(this|last|next|today|yesterday)\b/.test(period.label) ? period.label : `in ${period.label}`
}
const datesRow = (period: { from: string; to: string }) => `- Dates: ${spellDate(period.from)} to ${spellDate(period.to)}`
/** Whether the text names anyone at all: a figure for "everyone" must not be given for one person's question. */
async function namesSomeone(ctx: Ctx): Promise<boolean> {
  const [b, l] = await Promise.all([listBorrowerNames(ctx.userId), listLenderNames(ctx.userId)])
  return mentions(ctx.text, [...b, ...l.filter((x) => !x.isSelf)]).length > 0
}
async function oneBorrower(ctx: Ctx): Promise<Person | ServerReply | null> {
  const groups = mentions(ctx.text, await listBorrowerNames(ctx.userId))
  if (groups.length !== 1) return null
  if (groups[0].length > 1) return whichPerson(ctx.text, groups[0], 'borrower')
  ctx.say(`Found ${full(groups[0][0])}`)
  return groups[0][0]
}

/** Recently Deleted: what can still be restored. */
async function deletedCheck(ctx: Ctx): Promise<ServerReply | null> {
  if (!isQuestion(ctx.text) || !/\b(recently deleted|deleted|trash|basura|restorable)\b/i.test(ctx.text)) return null
  const r = (await runTool(ctx.userId, 'list_deleted', {})) as { borrowers: { name: string }[]; lenders: { name: string }[]; loans: { borrower: string; amount: string }[]; moneyEntries: { lender: string; amount: string }[] }
  ctx.say('Checked Recently Deleted')
  const rows = [
    ...r.borrowers.map((b) => `- ${b.name}: Borrower`),
    ...r.lenders.map((l) => `- ${l.name}: Lender`),
    ...r.loans.map((l) => `- ${l.borrower}: ${l.amount} loan`),
    ...r.moneyEntries.map((m) => `- ${m.lender}: ${m.amount} entry`),
  ]
  if (rows.length === 0) return tell('Recently Deleted is empty.')
  return tell([`**${rows.length} ${rows.length === 1 ? 'item' : 'items'}** in Recently Deleted. Ask me to restore any of them.`, ...rows.slice(0, 10)].join('\n'))
}

/** "Is Dan a good borrower?", "Dan's track record": the saved label beside what the rule gives. */
async function trackRecordCheck(ctx: Ctx): Promise<ServerReply | null> {
  if (!isQuestion(ctx.text) || !/\b(track record|record|history|label|rating|reliable|trustworthy|good|okay|ok|bad)\b/i.test(ctx.text)) return null
  if (EARN.test(ctx.text) || periodIn(ctx)) return null
  const who = await oneBorrower(ctx)
  if (!who || isReply(who)) return who
  const r = (await runTool(ctx.userId, 'find_borrower', { name: full(who) })) as { borrowers?: { name: string; savedLabel: string; ruleWouldGive: string; trackRecord: string }[] }
  const b = r.borrowers?.find((x) => x.name === full(who))
  if (!b) return null
  const word = (l: string) => (l === 'none' ? 'no label' : l.charAt(0) + l.slice(1).toLowerCase())
  const same = b.savedLabel === b.ruleWouldGive
  return tell([
    same ? `${b.name} is **${word(b.savedLabel)}**, and your rule agrees.` : `${b.name} is saved as **${word(b.savedLabel)}**, but your rule gives **${word(b.ruleWouldGive)}**.`,
    `- Saved label: ${word(b.savedLabel)}`,
    `- By your rule: ${word(b.ruleWouldGive)}`,
    `- Record: ${b.trackRecord}`,
  ].join('\n'))
}

/** "How much did Angel pay this month?", "How much did Rico borrow in October?" */
async function borrowerPeriodCheck(ctx: Ctx): Promise<ServerReply | null> {
  if (!isQuestion(ctx.text)) return null
  const pays = /\b(pay|paid|payed|bayad|nagbayad|binayaran|hulog|naghulog)\b/i.test(ctx.text)
  const borrows = /\b(borrow|borrowed|hiram|hiniram|umutang|utang|loaned)\b/i.test(ctx.text)
  const period = periodIn(ctx)
  if ((!pays && !borrows) || !period) return null
  const who = await oneBorrower(ctx)
  if (!who || isReply(who)) return who
  const r = (await borrowerStatement(ctx.userId, full(who), period.from, period.to)) as { found?: boolean; name?: string; borrowed?: string; paid?: string; weeksOfInterestPaid?: number; owesToday?: string }
  if (!r.found) return null
  ctx.say(`Read ${r.name}'s statement`)
  return tell([
    pays ? `**${r.paid}** paid by ${r.name} ${whenText(period)}.` : `**${r.borrowed}** borrowed by ${r.name} ${whenText(period)}.`,
    pays ? `- Borrowed: ${r.borrowed}` : `- Paid: ${r.paid}`,
    ...(r.weeksOfInterestPaid ? [`- Weeks of interest paid: ${r.weeksOfInterestPaid}`] : []),
    `- Owes today: ${r.owesToday}`,
    datesRow(period),
  ].join('\n'))
}

/** "How much is my cut this month?" */
async function adminCutCheck(ctx: Ctx): Promise<ServerReply | null> {
  if (!/\b(cut|commission|komisyon)\b/i.test(ctx.text)) return null
  const period = periodIn(ctx)
  if (!period) return null
  const r = (await adminCut(ctx.userId, period.from, period.to)) as { collected: string; agreedOnLoansStarted: string; stillToComeToday: string; loansStarted: number; loansRepaid: number }
  ctx.say("Added up the Admin's cut")
  return tell([
    `**${r.collected}** Admin's cut collected ${whenText(period)}.`,
    `- Cut on loans made: ${r.agreedOnLoansStarted}`,
    `- Still to come (as of today): ${r.stillToComeToday}`,
    `- Loans started: ${r.loansStarted}`,
    `- Loans repaid: ${r.loansRepaid}`,
    datesRow(period),
  ].join('\n'))
}

/** "How much will be floating by the end of the month?", "How much will Maria have on Nov 30?" */
async function floatingOnCheck(ctx: Ctx): Promise<ServerReply | null> {
  const t = clean(ctx.text)
  if (!/\b(will|by|on|end of)\b/.test(t) || !/\b(floating|have|available|ready to lend|free to lend)\b/.test(t)) return null
  if (!/\b(will|by|end of)\b/.test(t)) return null
  const endOfMonth = /\bend of (the )?month\b/.test(t) ? new Date(Date.UTC(Number(ctx.today.slice(0, 4)), Number(ctx.today.slice(5, 7)), 0)).toISOString().slice(0, 10) : null
  const period = periodIn(ctx)
  const on = endOfMonth ?? readDate(t, ctx.today) ?? (period && period.to > ctx.today ? period.to : null)
  if (!on || on <= ctx.today) return null
  const lenders = await listLenderNames(ctx.userId)
  const self = lenders.find((l) => l.isSelf)
  const groups = self && ADMIN_WORDS.test(ctx.text) ? [[self]] : mentions(ctx.text, lenders.filter((l) => !l.isSelf))
  if (groups.length > 1) return null
  if (groups[0]?.length > 1) return whichPerson(ctx.text, groups[0], 'lender')
  const who = groups[0]?.[0]
  const r = (await floatingOn(ctx.userId, who ? full(who) : '', on)) as { found?: boolean; who?: string; floatingNow?: string; floatingThen?: string; comingBackBy?: string; lateNotCounted?: string; perPot?: { name: string; floatingThen: string }[] }
  if (!r.found) return null
  ctx.say('Worked out what will be floating')
  return tell([
    `**${r.floatingThen}** floating ${who ? `in ${r.who}'s pot ` : ''}by ${spellDate(on)}, if every payment due by then arrives.`,
    `- Floating now: ${r.floatingNow}`,
    `- Coming back by then: ${r.comingBackBy}`,
    ...(r.lateNotCounted && r.lateNotCounted !== '₱0.00' ? [`- Late, not counted: ${r.lateNotCounted}`] : []),
    ...(r.perPot ?? []).map((p) => `- ${p.name}: ${p.floatingThen}`),
  ].join('\n'))
}

/** "Which loans are due next week?", "Who is due in December?" */
async function loansDueCheck(ctx: Ctx): Promise<ServerReply | null> {
  if (!isQuestion(ctx.text) || !/\bdue\b/i.test(ctx.text)) return null
  const period = periodIn(ctx)
  if (!period || (await namesSomeone(ctx))) return null
  const r = (await runTool(ctx.userId, 'find_loans', { status: 'active', due_from: period.from, due_to: period.to })) as { totals?: { matching: number; stillToCollect: string }; loans?: { borrower: string; totalToRepay: string; nextDue: string | null }[] }
  if (!r.totals) return null
  ctx.say(`Found ${r.totals.matching} ${r.totals.matching === 1 ? 'loan' : 'loans'}`)
  if (r.totals.matching === 0) return tell(`No unpaid loan is due ${whenText(period)}.\n${datesRow(period)}`)
  return tell([
    `**${r.totals.matching} ${r.totals.matching === 1 ? 'loan' : 'loans'}** due ${whenText(period)}.`,
    ...(r.loans ?? []).slice(0, 10).map((l) => `- ${l.borrower}: ${l.totalToRepay} | Due ${l.nextDue ? spellDate(l.nextDue) : 'not set'}`),
    datesRow(period),
  ].join('\n'))
}

/** "What came in last week?", "Maria's deposits this month", "withdrawals in October". */
async function moneyHistoryCheck(ctx: Ctx): Promise<ServerReply | null> {
  const t = clean(ctx.text)
  if (!/\b(money in|money out|money history|deposits?|deposited|withdrawals?|withdrew|came in|went out|cash in|cash out|movements?|galaw)\b|\bhistory\b.*\b(lent|paid back|repaid)\b|\b(lent|paid back|repaid)\b.*\bhistory\b/.test(t)) return null
  if (!isQuestion(ctx.text) && !/^(show|list)\b|'s (deposits|withdrawals|money)|\bhistory\b/.test(t)) return null
  if (/\b(each|every|per|all lenders|bawat|most|least|highest|lowest)\b/.test(t)) return null
  const period = periodIn(ctx)
  const lenders = await listLenderNames(ctx.userId)
  const groups = mentions(ctx.text, lenders.filter((l) => !l.isSelf))
  if (groups.length > 1) return null
  if (groups[0]?.length > 1) return whichPerson(ctx.text, groups[0], 'lender')
  const who = groups[0]?.[0]
  if (!period && !who) return null
  // The Money history filters: Money in, Withdrawals, Lent out, Paid back.
  const listed = /\b(history|movements?|entries|galaw)\b/.test(t)
  const kind = /\b(deposits?|deposited)\b/.test(t) ? 'in' : /\b(withdrawals?|withdrew)\b/.test(t) ? 'withdrawals' : listed && /\blent( out)?\b/.test(t) ? 'lent' : listed && /\b(paid back|repaid|came back|repayments?)\b/.test(t) ? 'back' : undefined
  // "What came in" is every peso that arrived (deposits and repayments); "what went out" every peso that left.
  const direction = kind ? undefined : /\b(came in|money in|cash in)\b/.test(t) ? 'in' : /\b(went out|money out|cash out)\b/.test(t) ? 'out' : undefined
  const r = (await moneyHistory(ctx.userId, { ...(who ? { name: full(who) } : {}), ...(period ? { from: period.from, to: period.to } : {}), ...(kind ? { kind } : {}), ...(direction ? { direction } : {}) })) as { found?: boolean; count?: number; moneyIn?: string; moneyOut?: string; entries?: { date: string | null; lender: string; what: string; amount: string; direction: string }[] }
  if (!r.found) return null
  ctx.say(`Read ${r.count} money ${r.count === 1 ? 'entry' : 'entries'}`)
  const scope = `${who ? ` for ${full(who)}` : ''}${period ? ` ${whenText(period)}` : ''}`
  const head = kind === 'lent' ? `**${r.moneyOut}** lent out${scope}.` : kind === 'back' ? `**${r.moneyIn}** paid back${scope}.` : kind === 'in' ? `**${r.moneyIn}** deposited${scope}.` : kind === 'withdrawals' ? `**${r.moneyOut}** withdrawn${scope}.` : direction === 'in' ? `**${r.moneyIn}** came in${scope}.` : direction === 'out' ? `**${r.moneyOut}** went out${scope}.` : `**${r.moneyIn}** in and ${r.moneyOut} out${scope}.`
  if (!r.count) return tell(`${kind === 'lent' ? `Nothing lent out${scope}.` : kind === 'back' ? `Nothing paid back${scope}.` : kind === 'in' ? `No deposits${scope}.` : kind === 'withdrawals' ? `No withdrawals${scope}.` : direction === 'in' ? `Nothing came in${scope}.` : direction === 'out' ? `Nothing went out${scope}.` : `No money moved${scope}.`}${period ? `\n${datesRow(period)}` : ''}`)
  return tell([
    head,
    ...(r.entries ?? []).slice(0, 8).map((e) => `- ${e.lender}: ${e.direction === 'in' ? '' : '−'}${e.amount} | ${e.what} · ${e.date ? spellDate(e.date) : ''}`),
    ...(period ? [datesRow(period)] : []),
    ...(r.count! > 8 ? [`Showing 8 of ${r.count}. The Money history page has them all.`] : []),
  ].join('\n'))
}

/** "How much did we lend this month?", "How much was collected in October?", "How many loans were made last month?" */
async function summaryCheck(ctx: Ctx): Promise<ServerReply | null> {
  const t = clean(ctx.text)
  const period = periodIn(ctx)
  if (!period || !isQuestion(ctx.text) || (await namesSomeone(ctx))) return null
  const lent = /\b(lend|lent|loaned|lent out|released|pinahiram|pautang)\b/.test(t)
  const collected = /\b(collect|collected|received|repaid|paid back|came back|nakolekta|bayad)\b/.test(t)
  const made = /\bhow many loans?\b.*\b(made|started|new|given|released)\b/.test(t)
  const paid = /\bhow many loans?\b.*\b(paid|repaid|settled|finished)\b/.test(t)
  const summary = /\b(summary|report|recap|overview)\b/.test(t)
  if (!lent && !collected && !made && !paid && !summary) return null
  const r = (await periodSummary(ctx.userId, period.from, period.to)) as { lentOut: string; collected: string; adminEarned: string; loansMade: number; loansRepaid: number }
  ctx.say('Added up loans and payments')
  const head = made
    ? `**${r.loansMade} ${r.loansMade === 1 ? 'loan' : 'loans'}** made ${whenText(period)}.`
    : paid
      ? `**${r.loansRepaid} ${r.loansRepaid === 1 ? 'loan' : 'loans'}** repaid ${whenText(period)}.`
      : collected && !lent
        ? `**${r.collected}** collected ${whenText(period)}.`
        : lent
          ? `**${r.lentOut}** lent out ${whenText(period)}.`
          : `Summary ${whenText(period)}:`
  return tell([
    head,
    `- Lent out: ${r.lentOut}`,
    `- Collected: ${r.collected}`,
    `- Admin earned: ${r.adminEarned}`,
    `- Loans made: ${r.loansMade}`,
    `- Loans repaid: ${r.loansRepaid}`,
    datesRow(period),
  ].join('\n'))
}

// ---------------------------------------------------------------- any figure, for anyone, for any time

/** How each figure reads in an answer. "Now" figures are today's, whatever period is asked. */
const FIGURE: Record<Exclude<Metric, 'count'>, { word: string; now: boolean; one: (name: string) => string }> = {
  earned: { word: 'earned', now: false, one: (n) => `earned by ${n}` },
  floating: { word: 'floating', now: true, one: (n) => `floating in ${n}'s pot` },
  outOnLoan: { word: 'out on loan', now: true, one: (n) => `of ${n}'s money out on loan` },
  interestOwed: { word: 'interest still to come', now: true, one: (n) => `interest still to come for ${n}` },
  startingCapital: { word: 'starting capital', now: true, one: (n) => `starting capital for ${n}` },
  deposits: { word: 'deposited', now: false, one: (n) => `deposited by ${n}` },
  withdrawals: { word: 'withdrawn', now: false, one: (n) => `withdrawn by ${n}` },
  owes: { word: 'still owed', now: true, one: (n) => `still owed by ${n}` },
  overdue: { word: 'overdue', now: true, one: (n) => `overdue from ${n}` },
  paid: { word: 'paid', now: false, one: (n) => `paid by ${n}` },
  borrowed: { word: 'borrowed', now: false, one: (n) => `borrowed by ${n}` },
}
/** Names first, for a tie: "Angel and Bea borrowed the most, ₱75,000.00 each". */
const VERB: Record<Exclude<Metric, 'count'>, string> = {
  earned: 'earned', floating: 'have', outOnLoan: 'have out on loan', interestOwed: 'have interest still to come', startingCapital: 'started with',
  deposits: 'deposited', withdrawals: 'withdrew', owes: 'owe', overdue: 'have overdue', paid: 'paid', borrowed: 'borrowed',
}
/** A tie at nothing: "Angel, Dan, Lyn and Rico paid nothing in October 2026." */
const VERB_NONE: Record<Exclude<Metric, 'count'>, string> = {
  earned: 'earned nothing', floating: 'have nothing floating', outOnLoan: 'have nothing out on loan', interestOwed: 'have no interest still to come', startingCapital: 'have no starting capital set',
  deposits: 'deposited nothing', withdrawals: 'withdrew nothing', owes: 'owe nothing', overdue: 'have nothing overdue', paid: 'paid nothing', borrowed: 'borrowed nothing',
}
/** "All time" for a figure over a period: from long before the first loan to today. */
const ALL_TIME = (today: string) => ({ from: '2000-01-01', to: today, label: 'all time' })

/**
 * Any figure the app shows, for one person, each lender (each pot), each
 * borrower, everyone, or the Admin's own pot, now or for any period, ranked
 * when asked. One reader for every combination, so "how much did each lender
 * earn in October" needs no sentence of its own. Each figure comes from the same
 * function as the screen that shows it (the Lenders and Borrowers lists, and the
 * lender and borrower statements on the Reports page).
 */
async function anyFigureCheck(ctx: Ctx): Promise<ServerReply | null> {
  // Reached only for questions, or for sentences no change rule recognised ("earnings of each lender in October").
  // A statement with an amount ("Maria sent another 20k for her pot", "Jun started with 30000") is a change: not here.
  if (!isQuestion(ctx.text) && amountsIn(ctx.text).length > 0) return null
  const q0 = readQuestion(ctx.text, ctx.today)
  if (!q0) return null
  const q = { ...q0, period: periodIn(ctx) }
  if (q.metric === 'count') return countAnswer(ctx, q)
  const kind = BELONGS_TO[q.metric]
  const figure = FIGURE[q.metric]
  const [lenders, borrowerList] = await Promise.all([listLenders(ctx.userId), listBorrowers(ctx.userId, { page: 1, skip: 0, take: 1000 })])
  const borrowers = borrowerList.rows
  // A figure over time with no period said is all time; a "now" figure ignores the period.
  const period = figure.now ? null : (q.period ?? ALL_TIME(ctx.today))
  const range = period ? { from: new Date(`${period.from}T00:00:00`), to: new Date(`${period.to}T00:00:00`) } : null

  const lenderValue = async (l: (typeof lenders)[number]): Promise<number> => {
    switch (q.metric) {
      case 'floating': return l.position.floating
      case 'outOnLoan': return l.position.outOnLoan
      case 'interestOwed': return l.position.pending
      case 'startingCapital': return l.startingCapital
      case 'earned': return range && q.period ? ((await lenderReport(ctx.userId, l.id, range))?.earnedInPeriod ?? 0) : l.position.earned
      case 'deposits': return (await lenderReport(ctx.userId, l.id, range!))?.putIn ?? 0
      case 'withdrawals': return (await lenderReport(ctx.userId, l.id, range!))?.tookOut ?? 0
      default: return 0
    }
  }
  const borrowerValue = async (b: (typeof borrowers)[number]): Promise<number> => {
    switch (q.metric) {
      case 'owes': return b.outstanding
      case 'overdue': return b.overdueOutstanding
      case 'paid': return (await borrowerReport(ctx.userId, b.id, range!, { withProof: false }))?.paidInPeriod ?? 0
      case 'borrowed': return (await borrowerReport(ctx.userId, b.id, range!, { withProof: false }))?.borrowedInPeriod ?? 0
      default: return 0
    }
  }
  const when = period && period.label !== 'all time' ? ` ${whenText(period)}` : period ? ' in all' : ''
  const tail = [...(period && period.label !== 'all time' ? [datesRow(period)] : []), ...(figure.now && q.period ? ['These are as of today.'] : [])]

  // One named person, or the Admin's own pot.
  const people: Person[] = kind === 'lender' ? lenders.filter((l) => !l.isSelf) : borrowers
  const named = mentions(ctx.text, people)
  const self = lenders.find((l) => l.isSelf)
  if (named.length > 1) return null
  if (named.length === 1 || (q.admin && kind === 'lender' && self && !q.each)) {
    if (named[0]?.length > 1) return whichPerson(ctx.text, named[0], kind)
    const person = named[0]?.[0] ?? self!
    ctx.say(`Found ${full(person)}`)
    const value = kind === 'lender' ? await lenderValue(lenders.find((l) => l.id === person.id)!) : await borrowerValue(borrowers.find((b) => b.id === person.id)!)
    if (q.metric === 'overdue' && value === 0) return tell(`${full(person)} has nothing overdue.`)
    // One pot or one borrower: the figures next to it on their own page, for context.
    const pot = kind === 'lender' ? lenders.find((l) => l.id === person.id) : undefined
    const owing = kind === 'borrower' ? borrowers.find((b) => b.id === person.id) : undefined
    const context = pot
      ? [q.metric !== 'floating' ? `- Floating now: ${pesos(pot.position.floating / 100)}` : '', q.metric !== 'outOnLoan' ? `- Out on loan: ${pesos(pot.position.outOnLoan / 100)}` : '', q.metric !== 'earned' ? `- Earned in all: ${pesos(pot.position.earned / 100)}` : ''].filter(Boolean)
      : owing && q.metric !== 'owes'
        ? [`- Still owes: ${pesos(owing.outstanding / 100)}`]
        : owing
          ? await unpaidLoanRows(ctx, full(person))
          : []
    return tell([`**${pesos(value / 100)}** ${figure.one(full(person))}${when}.`, ...context, ...tail].join('\n'))
  }
  // A name of the other kind ("how much did Maria pay", Maria being a lender) is not this figure's: the AI takes it.
  const others: Person[] = kind === 'lender' ? borrowers : lenders.filter((l) => !l.isSelf)
  if (mentions(ctx.text, others).length > 0) return null

  // Each lender (each pot) or each borrower, a total, or a ranking: one row per person.
  ctx.say(`Read every ${kind}`)
  const rows = await Promise.all(
    kind === 'lender'
      ? lenders.map(async (l) => ({ name: full(l), value: await lenderValue(l) }))
      : borrowers.map(async (b) => ({ name: full(b), value: await borrowerValue(b) })),
  )
  const total = rows.reduce((t, r) => t + r.value, 0)
  // Borrowers with nothing in this figure are left out of a list, but not out of "who paid the least": ₱0.00 is the least.
  const shown = rows.filter((r) => kind === 'lender' || r.value !== 0 || q.rank === 'least').sort((a, b) => (q.rank === 'least' ? a.value - b.value : b.value - a.value))
  const one = kind === 'lender' ? 'lender' : 'borrower'
  const tied = q.rank ? shown.filter((r) => r.value === shown[0]?.value) : []
  const together = tied.length > 2 ? `${tied.slice(0, -1).map((r) => r.name).join(', ')} and ${tied.at(-1)!.name}` : tied.map((r) => r.name).join(' and ')
  const head = q.rank && shown.length > 0
    ? tied.length > 1
      ? shown[0].value === 0
        ? `${together} ${VERB_NONE[q.metric]}${when}.`
        : `${together} ${VERB[q.metric]} the ${q.rank}${when}, **${pesos(shown[0].value / 100)}** each.`
      : `**${pesos(shown[0].value / 100)}** ${figure.one(shown[0].name)}${when}, the ${q.rank} of any ${one}.`
    : `**${pesos(total / 100)}** ${figure.word}${when}, ${kind === 'lender' ? 'across' : 'from'} ${shown.length} ${shown.length === 1 ? one : `${one}s`}.`
  if (shown.length === 0) return tell([`Nothing ${figure.word}${when} for any ${kind}.`, ...tail].join('\n'))
  return tell([
    head,
    ...shown.slice(0, 10).map((r) => `- ${r.name}: ${pesos(r.value / 100)}`),
    ...(shown.length > 10 ? [`Showing 10 of ${shown.length}.`] : []),
    ...tail,
  ].join('\n'))
}

/** A borrower's unpaid loans as rows: amount and due date, overdue marked. */
async function unpaidLoanRows(ctx: Ctx, name: string): Promise<string[]> {
  const r = (await runTool(ctx.userId, 'find_borrower', { name })) as { borrowers?: { name: string; loans: { amount: string; due: string | null; state: string }[] }[] }
  const loans = r.borrowers?.find((b) => b.name === name)?.loans.filter((l) => l.state !== 'paid') ?? []
  return loans.map((l) => `- ${l.amount} loan: due ${l.due ? spellDate(l.due) : 'not set'}${l.state === 'overdue' ? ' | Overdue' : ''}`)
}

/** "How many borrowers are overdue?", "How many loans were made in October?", "How many lenders do I have?" */
async function countAnswer(ctx: Ctx, q: Question): Promise<ServerReply | null> {
  const condition = countCondition(ctx.text)
  if (q.countOf === 'lenders') {
    const lenders = await listLenders(ctx.userId)
    return tell([`**${lenders.length} ${lenders.length === 1 ? 'lender' : 'lenders'}**, the Admin's pot included.`, ...lenders.map((l) => `- ${full(l)}: ${pesos(l.position.floating / 100)} | floating`)].join('\n'))
  }
  if (q.countOf === 'borrowers') {
    const { rows } = await listBorrowers(ctx.userId, { page: 1, skip: 0, take: 1000 })
    const picked = condition === 'overdue' ? rows.filter((b) => b.overdueOutstanding > 0) : condition === 'owing' ? rows.filter((b) => b.outstanding > 0) : rows
    const what = condition === 'overdue' ? ' overdue' : condition === 'owing' ? ' owing money' : ''
    const ranked = [...picked].sort((a, b) => (condition === 'overdue' ? b.overdueOutstanding - a.overdueOutstanding : b.outstanding - a.outstanding))
    return tell([`**${picked.length} ${picked.length === 1 ? 'borrower' : 'borrowers'}**${what}.`, ...(condition ? ranked.slice(0, 10).map((b) => `- ${full(b)}: ${pesos((condition === 'overdue' ? b.overdueOutstanding : b.outstanding) / 100)}`) : [])].join('\n'))
  }
  if (q.countOf === 'loans') {
    // "How many loans did Maria fund?", "How many loans has Angel taken?": one person's loans.
    const [lenderNames, borrowerNames] = await Promise.all([listLenderNames(ctx.userId), listBorrowerNames(ctx.userId)])
    const asLender = mentions(ctx.text, lenderNames.filter((l) => !l.isSelf))
    const asBorrower = mentions(ctx.text, borrowerNames)
    const named = asLender.length === 1 && asBorrower.length === 0 ? { kind: 'lender' as const, people: asLender[0] } : asBorrower.length === 1 && asLender.length === 0 ? { kind: 'borrower' as const, people: asBorrower[0] } : null
    if (named) {
      if (named.people.length > 1) return whichPerson(ctx.text, named.people, named.kind)
      const who = named.people[0]
      ctx.say(`Found ${full(who)}`)
      const where = named.kind === 'lender' ? { userId: ctx.userId, deletedAt: null, fundings: { some: { lenderId: who.id } } } : { userId: ctx.userId, deletedAt: null, borrowerId: who.id }
      const [all, unpaid] = await Promise.all([db.loan.count({ where }), db.loan.count({ where: { ...where, status: 'ACTIVE' } })])
      return tell([`**${all} ${all === 1 ? 'loan' : 'loans'}** ${named.kind === 'lender' ? 'funded by' : 'taken by'} ${full(who)}.`, `- Unpaid: ${unpaid}`, `- Fully paid: ${all - unpaid}`].join('\n'))
    }
    if (q.period && (condition === 'made' || condition === 'paid' || condition === null)) {
      const r = (await periodSummary(ctx.userId, q.period.from, q.period.to)) as { loansMade: number; loansRepaid: number }
      const n = condition === 'paid' ? r.loansRepaid : r.loansMade
      return tell([`**${n} ${n === 1 ? 'loan' : 'loans'}** ${condition === 'paid' ? 'repaid' : 'made'} ${whenText(q.period)}.`, datesRow(q.period)].join('\n'))
    }
    const o = (await runTool(ctx.userId, 'get_overview', {})) as { overdue: { loans: number }; allLoansEver: { loans: number } }
    const active = await db.loan.count({ where: { userId: ctx.userId, deletedAt: null, status: 'ACTIVE' } })
    const paidAll = await db.loan.count({ where: { userId: ctx.userId, deletedAt: null, status: 'PAID' } })
    if (condition === 'overdue') {
      const who = (o as unknown as { overdue: { who: { borrower: string; owes: string }[] } }).overdue.who
      return tell([`**${o.overdue.loans} ${o.overdue.loans === 1 ? 'loan' : 'loans'}** overdue right now.`, ...who.map((w) => `- ${w.borrower}: ${w.owes}`)].join('\n'))
    }
    if (condition === 'owing') return tell(`**${active} ${active === 1 ? 'loan' : 'loans'}** still unpaid.`)
    if (condition === 'paid') return tell(`**${paidAll} ${paidAll === 1 ? 'loan' : 'loans'}** fully paid.`)
    return tell([`**${o.allLoansEver.loans} ${o.allLoansEver.loans === 1 ? 'loan' : 'loans'}** in all.`, `- Unpaid: ${active}`, `- Fully paid: ${paidAll}`, `- Overdue now: ${o.overdue.loans}`].join('\n'))
  }
  return null
}

// ---------------------------------------------------------------- per-person checks

const EARN = /\b(earn|earns|earned|earning|earnings|kita|kinita|kumita|income|profit|tubo|made)\b/i

/**
 * "How much did John Ross earn this month?": one lender and a stretch of time,
 * answered with the same figure as their statement on the Reports page.
 * Anything vaguer (no period, several lenders, everyone) is the big AI's.
 */
async function earningsCheck(ctx: Ctx): Promise<ServerReply | null> {
  if (!EARN.test(ctx.text)) return null
  const period = periodIn(ctx)
  if (!period && !isQuestion(ctx.text)) return null
  const lenders = await listLenderNames(ctx.userId)
  const self = lenders.find((l) => l.isSelf)
  // "the admin", "my pot", "I": the Admin's own pot.
  const mine = self && (ADMIN_WORDS.test(ctx.text) || /\b(did i|have i|i earned|my earnings)\b/i.test(ctx.text))
  const groups = mine ? [[self]] : mentions(ctx.text, lenders)
  if (groups.length !== 1) return null
  if (groups[0].length > 1) return whichPerson(ctx.text, groups[0], 'lender')
  const lender = groups[0][0]
  ctx.say(`Found ${full(lender)}`)
  // No period said: everything they have earned, as on their pot.
  if (!period) {
    const pot = (await listLenders(ctx.userId)).find((l) => l.id === lender.id)
    if (!pot) return null
    return tell([`**${pesos(pot.position.earned / 100)}** earned by ${full(lender)} in all.`, `- Floating now: ${pesos(pot.position.floating / 100)}`, `- Out on loan: ${pesos(pot.position.outOnLoan / 100)}`, 'Ask for a month too, like "this month" or "in October".'].join('\n'))
  }
  const r = (await lenderEarnings(ctx.userId, full(lender), period.from, period.to)) as {
    found?: boolean; name?: string; earned?: string; includesAdminCut?: string; loansRepaid?: number; weeksOfInterestCollected?: number
  }
  if (!r.found) return null
  ctx.say(`Added up ${r.name}'s earnings, ${spellDate(period.from)} to ${spellDate(period.to)}`)
  const when = period.label === 'that time' ? `from ${spellDate(period.from)} to ${spellDate(period.to)}` : /^(this|last|today|yesterday)\b/.test(period.label) ? period.label : `in ${period.label}`
  return tell([
    `**${r.earned}** earned by ${r.name} ${when}.`,
    // On the Admin's pot most of it is the cut on other lenders' loans, so that comes first and the loans are "own" ones.
    ...(r.includesAdminCut ? [`- From the Admin's cut: ${r.includesAdminCut}`] : []),
    `- ${r.includesAdminCut ? 'Own loans repaid' : 'Loans repaid'}: ${r.loansRepaid ?? 0}`,
    ...(r.weeksOfInterestCollected ? [`- Weeks of interest collected: ${r.weeksOfInterestCollected}`] : []),
    `- Dates: ${spellDate(period.from)} to ${spellDate(period.to)}`,
  ].join('\n'))
}

const pct = (bps: number) => `${(bps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}%`
const loansWord = (n: number) => `${n} ${n === 1 ? 'loan' : 'loans'}`

/**
 * Everything on a lender's page that is more than one figure, read from the
 * same functions as the page itself (getLender, and lenderReport for the
 * statement): the statement, where the money is, who has it, the loans repaid,
 * the rate, the starting capital history, where the Admin cut comes from, and
 * the Lenders list. The lender is matched by name, typos and all, or "my pot".
 */
async function lenderPageCheck(ctx: Ctx): Promise<ServerReply | null> {
  const t = clean(ctx.text)
  // "Change Maria's rate to 4%" is a change, not a look.
  if (/^(fix|change|edit|update|correct|delete|remove|restore|undo|set|mark|add|record|rename|extend|lend|loan|give(?! me)|deposit|withdraw|pay|move|transfer|fund|approve|release|pahiram|ipahiram)\b/.test(t)) return null
  if (!isQuestion(ctx.text) && amountsIn(ctx.text).length > 0) return null
  const topic = lenderTopic(ctx.text)
  if (!topic) return null
  const [lenderNames, borrowerNames] = await Promise.all([listLenderNames(ctx.userId), listBorrowerNames(ctx.userId)])
  const saysLender = /\b(lenders?|pots?|investors?|funders?|nagpautang|capital|puhunan)\b/.test(t)

  if (topic === 'list') {
    const lenders = await listLenders(ctx.userId)
    ctx.say('Read the Lenders page')
    const floating = lenders.reduce((s, l) => s + l.position.floating, 0)
    return tell([
      `**${pesos(floating / 100)}** floating across ${lenders.length} ${lenders.length === 1 ? 'lender' : 'lenders'}.`,
      ...lenders.map((l) => `- ${full(l)}${l.isSelf ? ' (Admin)' : ''}: ${pesos(l.position.floating / 100)} | out on loan ${pesos(l.position.outOnLoan / 100)} · earned ${pesos(l.position.earned / 100)}`),
    ].join('\n'))
  }

  const self = lenderNames.find((l) => l.isSelf)
  const named = mentions(ctx.text, lenderNames.filter((l) => !l.isSelf))
  // "My statement" is the Admin's pot; "my overdue loans" is every loan, so loans need "my pot" or "admin".
  const mine = self && (ADMIN_WORDS.test(ctx.text) || (topic !== 'loans' && topic !== 'repaid' && /\b(my|i|me|mine)\b/.test(t.replace(/\b(can|may) i see|let me see|i want to see|i'd like to see|i need to see|give me|show me|tell me\b/g, ' '))))
  // A borrower's name ("Rico's loans", "Rico's statement") is the borrower's, unless a lender is plainly meant.
  if (named.length === 0 && !mine) {
    if (mentions(ctx.text, borrowerNames).length > 0) return null
    // "Show me a lender statement": which one, as buttons.
    if (saysLender && (topic === 'statement' || topic === 'breakdown' || topic === 'rate' || topic === 'capital')) {
      return ask('Which lender?', lenderNames.map((l) => ({ label: full(l), send: plus(ctx.text, `for ${full(l)}`) })))
    }
    if (topic === 'cut' && self) return lenderPageAnswer(ctx, topic, self)
    return null
  }
  if (named.length > 1) return null
  if (named.length === 1 && mentions(ctx.text, borrowerNames).some((g) => g.some((b) => named[0].some((l) => full(l) === full(b)))) && !saysLender) return null
  if (named[0]?.length > 1) return whichPerson(ctx.text, named[0], 'lender')
  const lender = named[0]?.[0] ?? self!
  return lenderPageAnswer(ctx, topic, lender)
}

async function lenderPageAnswer(ctx: Ctx, topic: Exclude<ReturnType<typeof lenderTopic>, null | 'list'>, who: Person): Promise<ServerReply | null> {
  const period = periodIn(ctx)
  const range = period ? { from: new Date(`${period.from}T00:00:00`), to: new Date(`${period.to}T00:00:00`) } : undefined
  const lender = await getLender(ctx.userId, who.id, range)
  if (!lender) return null
  const name = full(lender)
  ctx.say(`Found ${name}`)
  const p = lender.position
  const peso = (c: number) => pesos(c / 100)
  const tail = period ? [datesRow(period)] : []

  if (topic === 'statement') {
    const span = period ?? ALL_TIME(ctx.today)
    const report = await lenderReport(ctx.userId, lender.id, { from: new Date(`${span.from}T00:00:00`), to: new Date(`${span.to}T00:00:00`) })
    if (!report) return null
    ctx.say(`Read ${name}'s statement`)
    const when = period ? ` ${whenText(period)}` : ' in all'
    const fundedTotal = report.funded.reduce((s, r) => s + r.principal, 0)
    return tell([
      `**${peso(report.earnedInPeriod)}** earned by ${name}${when}. This is the lender statement.`,
      `- Money put in: ${peso(report.putIn)}`,
      `- Money taken out: ${peso(report.tookOut)}`,
      `- Loans funded: ${peso(fundedTotal)} | ${loansWord(report.funded.length)}`,
      `- Loans repaid: ${report.repaid.length}`,
      ...(report.weeksPaid.length ? [`- Weeks of interest collected: ${report.weeksPaid.length}`] : []),
      ...(lender.isSelf && report.adminCutInPeriod > 0 ? [`- From the Admin's cut: ${peso(report.adminCutInPeriod)}`] : []),
      ...(period ? [`- Interest earned, spread by day: ${peso(lender.rangeInterest)} | as on the lender page`] : []),
      `- Floating now: ${peso(p.floating)}`,
      `- Out on loan now: ${peso(p.outOnLoan)} | ${loansWord(lender.fundings.length)}`,
      `- Interest still coming: ${peso(p.pending - p.adminCutPending)}`,
      ...tail,
      'To preview or print it, open Reports, then Lender statement.',
    ].join('\n'))
  }

  if (topic === 'breakdown') {
    const overdue = lender.fundings.filter((f) => f.state === 'overdue').reduce((s, f) => s + f.principal, 0)
    return tell([
      `**${peso(p.floating + p.outOnLoan + p.pending)}** in ${name}'s pot in all.`,
      `- Ready to lend: ${peso(p.floating)}`,
      `- Out on loan, on time: ${peso(p.outOnLoan - overdue)}`,
      `- Overdue: ${peso(overdue)}`,
      `- Interest coming: ${peso(p.pending - p.adminCutPending)}`,
      ...(lender.isSelf ? [`- Cut coming: ${peso(p.adminCutPending)}`] : []),
      ...(period ? ['These are as of today.'] : []),
    ].join('\n'))
  }

  if (topic === 'loans') {
    const late = /\b(overdue|late|delayed|behind|atrasado|lagpas)\b/i.test(ctx.text)
    const rows = late ? lender.fundings.filter((f) => f.state === 'overdue') : lender.fundings
    if (rows.length === 0) return tell(late ? `No loan of ${name}'s money is overdue.` : `None of ${name}'s money is out on loan right now.`)
    const toCollect = rows.reduce((s, f) => s + f.toCollect, 0)
    return tell([
      `**${loansWord(rows.length)}**${late ? ' overdue' : ''} out with ${name}'s money.`,
      ...rows.slice(0, 10).map((f) => `- ${f.borrowerName}: ${peso(f.principal + f.toCollect)} | ${peso(f.principal)} capital · due ${spellDate(toDateInput(f.dueOn))}${f.state === 'overdue' ? ' · Overdue' : ''}`),
      ...(rows.length > 10 ? [`Showing 10 of ${rows.length}.`] : []),
      `- Interest left to collect: ${peso(toCollect)}`,
    ].join('\n'))
  }

  if (topic === 'repaid') {
    const rows = lender.settled.filter((f) => !period || (f.paidOn && toDateInput(f.paidOn) >= period.from && toDateInput(f.paidOn) <= period.to))
    const when = period ? ` ${whenText(period)}` : ''
    if (rows.length === 0) return tell([`No loan funded by ${name}'s money was repaid${when}.`, ...tail].join('\n'))
    const earned = rows.reduce((s, f) => s + f.earnings, 0)
    return tell([
      `**${loansWord(rows.length)}** repaid${when}, earning ${name} ${peso(earned)}.`,
      ...rows.slice(0, 10).map((f) => `- ${f.borrowerName}: ${peso(f.principal)} | earned ${peso(f.earnings)}${f.paidOn ? ` · paid ${spellDate(toDateInput(f.paidOn))}` : ''}`),
      ...(rows.length > 10 ? [`Showing 10 of ${rows.length}.`] : []),
      ...tail,
    ].join('\n'))
  }

  if (topic === 'rate') {
    const fixed = lender.fixedAmountLoans > 0 ? [`- Loans at a fixed amount, not a rate: ${lender.fixedAmountLoans}`] : []
    if (lender.rates.length === 0) {
      return tell([fixed.length ? `${name}'s loans all charge a fixed amount, not a rate.` : `${name}'s money has no loans yet, so there is no rate. The rate is set on each loan.`, ...fixed].join('\n'))
    }
    const low = lender.rates[0]
    const high = lender.rates.at(-1)!
    return tell([
      `**${low === high ? pct(low) : `${pct(low)} to ${pct(high)}`}** a week on ${name}'s loans.`,
      ...(low === high ? [] : [`- Rates used: ${lender.rates.map(pct).join(', ')}`]),
      ...fixed,
      'The rate is set on each loan, not on the lender.',
    ].join('\n'))
  }

  if (topic === 'capital') {
    const versions = lender.capitalVersions
    if (versions.length === 0) return tell(`No starting capital is set for ${name}.`)
    return tell([
      `**${peso(lender.startingCapital)}** starting capital for ${name} now.`,
      ...versions.slice(0, 10).map((v, i) => `- ${spellDate(toDateInput(v.savedAt))}: ${peso(v.amount)} | ${i === 0 ? 'current' : 'earlier'}${v.note ? ` · ${v.note}` : ''}`),
    ].join('\n'))
  }

  // Where the Admin cut comes from: the Admin pot only.
  if (!lender.isSelf) return tell(`Only the Admin's pot earns a cut. ${name}'s pot pays it on loans it funds.`)
  const running = lender.adminCuts.running
  return tell([
    `**${peso(p.adminCutPending)}** cut still coming, from ${loansWord(running.length)} still running.`,
    ...running.slice(0, 10).map((r) => `- ${r.borrowerName}: ${peso(r.cut)} | ${r.lenderName}'s money · due ${spellDate(toDateInput(r.dueOn))}`),
    ...(running.length > 10 ? [`Showing 10 of ${running.length}.`] : []),
    `- Already earned on repaid loans: ${peso(p.adminCutEarned)}`,
  ].join('\n'))
}

/**
 * Plain checks on one person, answered from the app's own numbers: "how much
 * does Angel owe", "Rico's loans", "how much does Maria have". Only when the
 * whole question is one of these and the name is one person; anything else is
 * the big AI's.
 */
async function personCheck(ctx: Ctx): Promise<ServerReply | null> {
  // The app's read-only screens, each answered from the same figures as the screen itself.
  for (const check of [lenderPageCheck, earningsCheck, deletedCheck, trackRecordCheck, borrowerPeriodCheck, adminCutCheck, floatingOnCheck, loansDueCheck, moneyHistoryCheck, summaryCheck, anyFigureCheck]) {
    const answer = await check(ctx)
    if (answer) return answer
  }
  const t = clean(ctx.text).replace(/[?.!]+$/, '').replace(/\b(right now|now|currently|today|po|please|pls)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const owe = /^(how much (does|do|is|did) (.+?) (still )?(owe|owes|owing|utang)|what does (.+?) (still )?owe|magkano (pa )?(ang )?utang ni (.+)|(.+?)'?s? (balance|utang|debt)|(show|list|check)( me)? (.+?)'?s? loans|(.+?)'?s? loans|how many loans does (.+?) have)$/.exec(t)
  const pot = /^(how much (does|do|is) (.+?) (have|has)( floating| left| in (her|his|their) pot)?|(.+?)'?s? (pot|floating|money)|how much is in (.+?)'?s? pot|how much is floating for (.+?))$/.exec(t)
  if (!owe && !pot) return null
  const name = (owe ? [owe[3], owe[6], owe[10], owe[11], owe[14], owe[15], owe[16]] : [pot![3], pot![7], pot![9], pot![10]]).find(Boolean)?.trim() ?? ''
  if (!name || name.split(' ').length > 3) return null
  if (owe) {
    const people = mentions(name, await listBorrowerNames(ctx.userId))
    if (people.length !== 1 || people[0].length !== 1) return null
    const b = people[0][0]
    ctx.say(`Found ${full(b)}`)
    const r = (await runTool(ctx.userId, 'find_borrower', { name: full(b) })) as { borrowers?: { name: string; stillOwes: string; overdueAmount: string; loans: { amount: string; totalToRepay: string; due: string | null; state: string }[] }[] }
    const row = r.borrowers?.find((x) => x.name === full(b))
    if (!row) return null
    const unpaid = row.loans.filter((l) => l.state !== 'paid')
    // One total (what is still owed), then each unpaid loan by its amount and due date, so no two figures disagree.
    // The amount still owed leads (shown large); each unpaid loan is a row with its due date. No per-loan
    // "to repay" figure: on a weekly loan it is more than what is still owed, and two figures would disagree.
    const lines = unpaid.map((l) => `- ${l.amount} loan: due ${l.due ? spellDate(l.due) : 'not set'}${l.state === 'overdue' ? ' | Overdue' : ''}`)
    return tell(unpaid.length === 0 ? `${row.name} owes nothing right now. ${row.loans.length} loan${row.loans.length === 1 ? '' : 's'}, all paid.` : [`**${row.stillOwes}** still owed by ${row.name}.`, ...lines].join('\n'))
  }
  const people = mentions(name, await listLenderNames(ctx.userId))
  if (people.length !== 1 || people[0].length !== 1) return null
  const l = people[0][0]
  ctx.say(`Found ${full(l)}`)
  const r = (await runTool(ctx.userId, 'get_lender', { name: full(l) })) as { found?: boolean; name?: string; floating?: string; outOnLoan?: string; startingCapital?: string }
  if (!r.found) return null
  // A starting capital of ₱0.00 means none was set; "₱0.00" next to a large first deposit reads as wrong.
  return tell([`**${r.floating}** floating in ${r.name}'s pot, ready to lend.`, `- Out on loan: ${r.outOnLoan}`, ...(r.startingCapital && r.startingCapital !== '₱0.00' ? [`- Starting capital: ${r.startingCapital}`] : [])].join('\n'))
}

/**
 * The server's own answer to one plain question, for the AI (its app_lookup
 * tool): whatever the server can read, the AI can read the same way. Read
 * only: only the checks run, never a change card.
 */
export async function appLookup(userId: string, question: string): Promise<{ found: boolean; answer?: string; choices?: string[] }> {
  const [borrowerNames, lenderNames] = await Promise.all([listBorrowerNames(userId), listLenderNames(userId)])
  const names = [...borrowerNames, ...lenderNames].flatMap((p) => wordsOf(full(p))).filter((w) => w.length > 1)
  const ctx: Ctx = { userId, text: question, today: manilaToday(), say: () => {}, names }
  const reply = await personCheck(ctx)
  if (!reply || reply.kind === 'card') return { found: false }
  return { found: true, answer: reply.answer, ...(reply.kind === 'ask' && reply.choices.length ? { choices: reply.choices.map((c) => c.label) } : {}) }
}

/**
 * Changes the server will not make in one go, said plainly instead of half done:
 * "everyone", "all loans", two changes in one message, a negative amount.
 */
function oneAtATime(text: string): ServerReply | null {
  const t = clean(text)
  // "lahat" alone is "all", but "bayad na lahat" is one person paying everything.
  const allOfThem = /\b(everyone|everybody|all (the )?(loans|borrowers|lenders|of them|payments)|every (loan|borrower|lender))\b/.test(t) || (/\blahat\b/.test(t) && !/\b(bayad|binayaran|binalik|ibinalik|nagbayad)\b/.test(t))
  if (allOfThem) {
    return tell('For safety, I change one thing at a time. Tell me which one, for example "Dan fully paid".')
  }
  if (/(^|\s)-\s?₱?\d/.test(t)) return tell("An amount can't be negative. Say it as a plain amount, like \"5k\".")
  const verbs = t.match(/\b(deposit\w*|withdr\w*|lend|lent|paid|delete|remove|restore|rename|extend)\b/g) ?? []
  if (verbs.length >= 2 && /\b(and|then|also|tapos)\b/.test(t) && new Set(verbs.map((v) => v.slice(0, 4))).size === 1 && amountsIn(text).length >= 2) {
    return tell('That looks like two changes. I make one card at a time, so send them one by one.')
  }
  return null
}

// ---------------------------------------------------------------- entry point

/**
 * The server's own reply to the latest message, or null for the big AI. When
 * the latest message only answers the server's own question ("3 weeks"), it is
 * read together with the message that asked for the change.
 */
export async function serverReply(userId: string, history: { role: 'user' | 'assistant'; text: string }[], say: Say): Promise<ServerReply | null> {
  const latest = [...history].reverse().find((t) => t.role === 'user')?.text ?? ''
  const [borrowerNames, lenderNames] = await Promise.all([listBorrowerNames(userId), listLenderNames(userId)])
  const names = [...borrowerNames, ...lenderNames].flatMap((p) => wordsOf(full(p))).filter((w) => w.length > 1)
  const ctx: Ctx = { userId, text: latest, today: manilaToday(), say, names }
  if (isQuestion(latest)) return personCheck(ctx)

  // A look at a lender's page said without a question ("Maria's starting capital history", "loans Jun funded that were
  // paid back"): no amount, so it cannot be a change. A borrower's name alone leaves it to the change rules.
  if (amountsIn(latest).length === 0) {
    const looked = (await lenderPageCheck(ctx)) ?? (await moneyHistoryCheck(ctx))
    if (looked) return looked
  }
  let intent = intentByRules(latest)
  let how = 'from your words'
  if (!intent) {
    // A short reply to the server's own question: read with the request it answers.
    const n = history.length
    const prevBot = history[n - 2]
    const prevUser = history[n - 3]
    if (prevBot?.role === 'assistant' && /\?|:\s*$|For example/.test(prevBot.text) && prevUser?.role === 'user' && latest.split(/\s+/).length <= 8) {
      const merged = `${prevUser.text} ${latest}`
      const again = intentByRules(merged)
      if (again) {
        ctx.text = merged
        intent = again
      }
    }
  }
  if (!intent) {
    // "Rico's loans", typed without a question mark, is still a check.
    const checked = await personCheck(ctx)
    if (checked) return checked
    // People's names are hidden first: they say who, not what.
    const names = [...(await listBorrowerNames(userId)), ...(await listLenderNames(userId))].flatMap((p) => wordsOf(full(p)))
    const meant = await meaningOf(latest, names)
    if (!meant || meant.intent === 'question') return null
    intent = meant.intent === 'delete_any' ? 'delete' : meant.intent === 'restore_any' ? 'restore' : meant.intent
    how = 'by meaning'
  }
  say(`Understood: ${TITLES[intent] ?? 'a change'} (${how})`)
  const guard = oneAtATime(ctx.text)
  if (guard) return guard
  try {
    return await build(ctx, intent)
  } catch (error) {
    // A slip in the server's own reading must never block the Admin: the big AI takes over.
    console.error('[dex-e server card]', error)
    return null
  }
}
