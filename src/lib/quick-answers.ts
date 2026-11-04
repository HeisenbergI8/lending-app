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
  ['overdue', 'get_overview', /^(who('s| is| are) (overdue|late)|(which|what) (borrowers?|loans?) (is |are )?(overdue|late)|(list |show )?(the )?(overdue|late) (borrowers|loans|list)|how many (borrowers |loans |people )?(are )?(overdue|late)|is any(one|body) (overdue|late)|any(one|body)? (overdue|late))$/],
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
  // A one-line answer first, the key figure in bold, then one fact per line ("- Label: value").
  switch (kind) {
    case 'outOnLoan':
      return `**${o.outOnLoan}** is out on loan right now.\n- Borrowers owing: ${o.borrowers.owingNow}`
    case 'floating':
      return `**${o.floating}** is floating, ready to lend.`
    case 'earned':
      return `Your lenders have earned **${o.earned}** so far.`
    case 'overdue': {
      if (o.overdue.loans === 0) return 'Nobody is overdue right now.'
      const lines = o.overdue.who.map((w) => `- ${w.borrower}: ${w.owes}, was due ${date(w.wasDue)}${w.daysLate ? ` (${count(w.daysLate, 'day')} late)` : ''}`)
      return `${count(o.overdue.people, 'borrower is', 'borrowers are')} overdue, **${o.overdue.amount}** in all.\n${lines.join('\n')}`
    }
    case 'dueThisWeek': {
      const week = `- Week: ${date(o.dueThisWeek.from)} to ${date(o.dueThisWeek.to)}`
      return o.dueThisWeek.loans === 0
        ? `Nothing is due this week.\n${week}`
        : `**${o.dueThisWeek.amount}** is due this week.\n${week}\n- Loans: ${o.dueThisWeek.loans}\n- Borrowers: ${o.dueThisWeek.people}`
    }
    case 'interestOwed':
      return `**${o.interest.stillOwed}** of interest is still owed.\n- Collected: ${o.interest.collected}\n- Charged in all: ${o.interest.charged}`
    case 'loansEver':
      return `You have made **${count(o.allLoansEver.loans, 'loan')}** in all.\n- Total lent: ${o.allLoansEver.capital}`
    case 'owesMost': {
      if (o.owesMostNow.length === 0) return 'Nobody owes anything right now.'
      const [top, ...rest] = o.owesMostNow
      return [`**${top.borrower}** owes the most right now: ${top.toRepay}.`, ...rest.map((r) => `- Next: ${r.borrower}, ${r.toRepay}`)].join('\n')
    }
    case 'borrowerCount':
      return `You have **${count(o.borrowers.all, 'borrower')}**.\n- Owing money now: ${o.borrowers.owingNow}`
    case 'floatingEach': {
      if (!Array.isArray(result)) return null
      const pots = result as Pot[]
      return `Floating in each pot:\n${pots.map((p) => `- ${p.name}: ${p.floating}`).join('\n')}`
    }
    case 'pending': {
      if (!Array.isArray(result)) return null
      const rows = result as Pending[]
      if (rows.length === 0) return 'There are no pending loan requests.'
      return `**${count(rows.length, 'pending request')}**:\n${rows.map((r) => `- ${r.name}: ${r.amount}${r.start ? `, from ${date(r.start)}` : ''}`).join('\n')}`
    }
    case 'nextDue': {
      // Active loans not yet due, sorted by the next due date: the first date is the nearest.
      const loans = ((result as { loans?: LoanRow[] }).loans ?? []).filter((l) => l.nextDue)
      if (loans.length === 0) return 'No loan is coming due. Every unpaid loan is already overdue or there are none.'
      const first = loans[0].nextDue
      const due = loans.filter((l) => l.nextDue === first)
      const what = (l: LoanRow) => `${l.nextDueIsAWeeklyPayment ? 'weekly payment on a ' : ''}${l.amount} loan, ${l.totalToRepay} to repay`
      return due.length === 1
        ? `**${due[0].borrower}** is due next, on ${date(first)}.\n- Loan: ${what(due[0])}`
        : `**${count(due.length, 'borrower')}** are due next, on ${date(first)}.\n${due.map((l) => `- ${l.borrower}: ${what(l)}`).join('\n')}`
    }
    case 'labelRule':
      return [
        "A borrower's label comes from their record: count their loans **paid late** plus their loans **overdue now**.",
        '- Good: none',
        '- Okay: 1',
        '- Bad: 2 or more',
        'The label shown in the app is the one you saved, so it can differ from what the rule gives. Ask me to change it any time.',
      ].join('\n')
  }
}
