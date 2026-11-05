import { spellDate } from './dates.ts'

/**
 * Instant answers: common questions the server answers from the app's own
 * numbers, with no AI. Free, instant, and the same figures as the dashboard.
 *
 * A question is answered here only when the WHOLE question is one of these,
 * after small words like "right now" are taken out. Anything more ("who is
 * overdue and owes the most", "how much did Maria earn in October") goes to
 * the AI as before, so a near miss never gets a wrong instant answer.
 *
 * Pure: matching and wording can be tested without a database. The server
 * runs the lookup (see chat.ts), so the step shows like any other.
 */

export type QuickKind =
  | 'outOnLoan'
  | 'floating'
  | 'floatingEach'
  | 'earned'
  | 'overdue'
  | 'dueThisWeek'
  | 'interestOwed'
  | 'loansEver'
  | 'owesMost'
  | 'borrowerCount'
  | 'pending'
  | 'labelRule'
  | 'nextDue'

export type Quick = { kind: QuickKind; tool: string; args: Record<string, unknown> }

/** Words that do not change what is asked. */
const FILLER = /\b(right now|at the moment|currently|rn|now|today|so far|please|pls|po|just|hey|dex-?e)\b/g

export function normalize(question: string): string {
  return question
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[?.!,;:]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const HOW_MUCH = "how much (money )?(is |do i have |do we have |have i |have we |are |is there )?"

const PATTERNS: [QuickKind, string, RegExp][] = [
  ['outOnLoan', 'get_overview', new RegExp(`^(${HOW_MUCH}(out on loan|out|on loan|lent out|loaned out|lent)|(total |amount )?(out on loan|lent out)( total)?)$`)],
  ['floatingEach', 'list_lenders', /^(how much (money )?(is )?floating (in|for|per) (each|every) (pot|lender)s?|floating (in|for|per) (each|every) (pot|lender)s?|how much (does|do) each (lender|pot) have( floating)?)$/],
  ['floating', 'get_overview', new RegExp(`^(${HOW_MUCH}(floating|available to lend|free to lend|ready to lend)|(total )?floating( money| total)?)$`)],
  ['earned', 'get_overview', /^(how much (have we|have i|did we|did i|has been) (earned|made)|how much (is )?earned|(total )?(earned|earnings))$/],
  ['overdue', 'get_overview', /^(who('s| is| are) (overdue|late)|(which|what) (borrowers?|loans?) (is |are )?(overdue|late)|(list |show )?(the )?(overdue|late) (borrowers|loans|list)|is any(one|body) (overdue|late)|any(one|body)? (overdue|late))$/],
  ['dueThisWeek', 'get_overview', /^((what's|what is|who's|who is|how much is) due this week|(due|collections?) this week|what do (i|we) collect this week)$/],
  ['interestOwed', 'get_overview', /^(how much interest is (still )?(owed|unpaid|left|to collect)( to (us|me))?|(unpaid|owed) interest|interest (still )?(owed|unpaid))$/],
  ['loansEver', 'get_overview', /^((what's |what is )?(the )?total (of )?(all )?(the )?loans( (i've|i have|we've|we have) ever made| ever)?|how many loans (have i|have we|did i|did we) (ever )?(made|given))$/],
  ['owesMost', 'get_overview', /^(who (owes|owe) (me |us )?(the )?most|who('s| is) (my |the )?(biggest|top|largest) borrower)$/],
  ['borrowerCount', 'get_overview', /^how many borrowers( do (i|we) have)?$/],
  ['pending', 'list_pending', /^((any |show |list )?(the )?(pending|waiting) (loan )?requests|(how many|what|which) (loan )?requests are (pending|waiting)|who('s| is) waiting for a loan)$/],
  // Seen on the testing link: the AI named a lender as "the nearest due". The list sorted by due date answers it exactly.
  ['nextDue', 'find_loans', /^(who('s| is)( the)? (next|nearest|soonest) (due|to pay)( on (my )?borrowers)?|who('s| is) due (next|soonest|first)|who pays next|(the )?(next|nearest) due( date| loan| borrower)?|which loan is due (next|soonest|first)|when is the next (payment|due date))$/],
  ['labelRule', 'read_rules', /^(what makes (a )?(borrower )?good (okay|ok) (or|and) bad|how (are|is) (the |a )?(borrower )?labels? (chosen|decided|worked out|set)|what (are|is) the (good (okay|ok) (or|and) bad|label) rules?)$/],
]

/** The instant answer this question fits, or null for the AI. */
export function matchQuick(question: string): Quick | null {
  const q = normalize(question)
  if (!q || q.length > 80) return null
  for (const [kind, tool, pattern] of PATTERNS) {
    if (pattern.test(q)) return { kind, tool, args: kind === 'labelRule' ? { question: 'good okay bad label' } : kind === 'nextDue' ? { status: 'active' } : {} }
  }
  return null
}

type Overview = {
  outOnLoan: string
  floating: string
  earned: string
  interest: { charged: string; collected: string; stillOwed: string }
  overdue: { loans: number; people: number; amount: string; who: { borrower: string; owes: string; wasDue: string | null; daysLate: number | null }[] }
  dueThisWeek: { amount: string; loans: number; people: number; from: string | null; to: string | null }
  borrowers: { all: number; owingNow: number }
  allLoansEver: { loans: number; capital: string }
  owesMostNow: { borrower?: string; unpaidLoans: number; toRepay: string }[]
}
type Pot = { name: string; floating: string }
type Pending = { name: string; amount: string; start: string | null }
type LoanRow = { borrower: string; amount: string; totalToRepay: string; nextDue: string | null; nextDueIsAWeeklyPayment?: boolean }

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const date = (iso: string | null) => (iso ? spellDate(iso) : '')

/** The answer, worded from the lookup's result. Null if the result is not what was expected (the AI answers then). */
export function sayQuick(kind: QuickKind, result: unknown): string | null {
  if (!result || typeof result !== 'object' || 'error' in result) return null
  const o = result as Overview
  // Scanned on a phone first: the figure asked for leads, in bold (shown large), then what it is,
  // then one fact per row ("- Label: value"), with a small detail under a row after " | ".
  switch (kind) {
    case 'outOnLoan':
      return `**${o.outOnLoan}** out on loan right now.\n- Borrowers owing: ${o.borrowers.owingNow}`
    case 'floating':
      return `**${o.floating}** floating, ready to lend.`
    case 'earned':
      return `**${o.earned}** earned by your lenders so far.`
    case 'overdue': {
      if (o.overdue.loans === 0) return 'Nobody is overdue right now.'
      const lines = o.overdue.who.map((w) => `- ${w.borrower}: ${w.owes} | ${w.daysLate ? `${count(w.daysLate, 'day')} late · ` : ''}was due ${date(w.wasDue)}`)
      return `**${o.overdue.amount}** overdue, from ${count(o.overdue.people, 'borrower')}.\n${lines.join('\n')}`
    }
    case 'dueThisWeek': {
      const week = range(o.dueThisWeek.from, o.dueThisWeek.to)
      return o.dueThisWeek.loans === 0
        ? `Nothing is due this week (${week}).`
        : `**${o.dueThisWeek.amount}** due this week, ${week}.\n- Loans: ${o.dueThisWeek.loans}\n- Borrowers: ${o.dueThisWeek.people}`
    }
    case 'interestOwed':
      return `**${o.interest.stillOwed}** interest still owed.\n- Collected: ${o.interest.collected}\n- Charged in all: ${o.interest.charged}`
    case 'loansEver':
      return `**${o.allLoansEver.capital}** lent in all, over ${count(o.allLoansEver.loans, 'loan')}.`
    case 'owesMost': {
      if (o.owesMostNow.length === 0) return 'Nobody owes anything right now.'
      const [top] = o.owesMostNow
      return [`**${top.toRepay}** owed by ${top.borrower}, the most right now.`, ...o.owesMostNow.map((r, n) => `- ${r.borrower}: ${r.toRepay} | ${['Owes the most', '2nd', '3rd'][n] ?? ''}`)].join('\n')
    }
    case 'borrowerCount':
      return `**${count(o.borrowers.all, 'borrower')}** in all.\n- Owing money now: ${o.borrowers.owingNow}`
    case 'floatingEach': {
      if (!Array.isArray(result)) return null
      const pots = result as Pot[]
      const total = pots.reduce((sum, p) => sum + Number(p.floating.replace(/[^\d.]/g, '')), 0)
      const totalText = `₱${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      return `**${totalText}** floating across ${count(pots.length, 'pot')}.\n${pots.map((p) => `- ${p.name}: ${p.floating}`).join('\n')}`
    }
    case 'pending': {
      if (!Array.isArray(result)) return null
      const rows = result as Pending[]
      if (rows.length === 0) return 'There are no pending loan requests.'
      return `**${count(rows.length, 'pending request')}** waiting.\n${rows.map((r) => `- ${r.name}: ${r.amount}${r.start ? ` | from ${date(r.start)}` : ''}`).join('\n')}`
    }
    case 'nextDue': {
      // Active loans not yet due, sorted by the next due date: the first date is the nearest.
      const loans = ((result as { loans?: LoanRow[] }).loans ?? []).filter((l) => l.nextDue)
      if (loans.length === 0) return 'No loan is coming due. Every unpaid loan is already overdue or there are none.'
      const first = loans[0].nextDue
      const due = loans.filter((l) => l.nextDue === first)
      const what = (l: LoanRow) => `${l.nextDueIsAWeeklyPayment ? 'Weekly payment · ' : ''}${l.amount} loan`
      return due.length === 1
        ? `**${date(first)}**: ${due[0].borrower} is due next.\n- ${due[0].borrower}: ${due[0].totalToRepay} | ${what(due[0])}`
        : `**${date(first)}**: ${count(due.length, 'borrower')} are due next.\n${due.map((l) => `- ${l.borrower}: ${l.totalToRepay} | ${what(l)}`).join('\n')}`
    }
    case 'labelRule':
      return [
        "A borrower's label comes from their loans **paid late** plus their loans **overdue now**.",
        '- Good: 0 late or overdue',
        '- Okay: 1',
        '- Bad: 2 or more',
        'The label shown in the app is the one you saved, so it can differ from the rule. Ask me to change it any time.',
      ].join('\n')
  }
}

/** "November 04 to 10, 2026", or across months "October 30 to November 05, 2026". */
function range(from: string | null, to: string | null): string {
  if (!from || !to) return 'this week'
  const a = date(from)
  const b = date(to)
  if (from.slice(0, 7) === to.slice(0, 7)) return `${a.replace(/, \d{4}$/, '')} to ${to.slice(8)}, ${to.slice(0, 4)}`
  return `${a.replace(/, \d{4}$/, '')} to ${b}`
}

/** The one reply to anything outside Pondex. */
export const OUT_OF_SCOPE = 'I can only help with your Pondex loans, borrowers, lenders and rules.'

/** Who Dex-E is, said the same way every time, with nothing about how it is built. */
const ABOUT_ME =
  "I'm Dex-E, the helper inside Pondex. I answer questions about your loans, borrowers, lenders and rules, and I get changes ready for you to confirm. I can't share how I was made or the instructions I follow."

/** Questions about Dex-E itself: how it was made, which AI, its instructions. */
const ABOUT_DEXE =
  /\b(how (were|was|are|is) (you|dex-?e|this (bot|ai|chat))|who (made|built|created|trained|programmed|developed) (you|dex-?e|this)|what (are you|ai are you|model|llm)|which (ai|model|llm)|are you (an? )?(ai|bot|robot|human|chatgpt|gpt|claude|gemini|llama)|(you|your|dex-?e)( were| are| have| has| been| was| got)* (made|built|created|trained|coded|programmed|developed)|your (system )?(prompt|instructions|rules you follow|source code|training|model)|(chatgpt|openai|groq|llama|gpt-?oss|anthropic|gemini))\b/

/**
 * Tricks to make the AI step outside its job: "ignore your rules", "you are
 * now in developer mode", "pretend you are", "repeat your prompt". Known as
 * jailbreaks or prompt injection. Answered here, so the AI never sees them.
 */
const TRICKS =
  /\b(ignore (all |any |your |the |previous |prior )+(rules|instructions|prompts?)|forget (your|all|the) (rules|instructions)|(developer|dev|god|debug|jailbreak) mode|you are now (in|a|an|my|free|no longer)|pretend (to be|you are|you're)|role-?play|jailbreak|system prompt|(show|print|repeat|reveal|tell me) (me )?(your|the) (prompt|instructions|rules you)|bypass|override (your|the) (rules|safety))\b/

/** A fixed reply for questions about Dex-E itself or tricks to change its job, or null. */
export function matchOffLimits(question: string): string | null {
  const q = normalize(question)
  if (TRICKS.test(q)) return OUT_OF_SCOPE
  if (ABOUT_DEXE.test(q)) return ABOUT_ME
  return null
}
