/**
 * A question read as parts, so any combination works without a sentence for
 * each one: WHAT figure, about WHOM, and WHEN.
 *
 *   "how much did each lender earn this month"   → earned · each lender · this month
 *   "how much is floating in each pot"           → floating · each lender (a pot is a lender's money)
 *   "who owes the most"                          → owes · each borrower · ranked
 *   "magkano kinita ni Maria nung October"       → earned · Maria · October
 *   "how many borrowers are overdue"             → count of borrowers · overdue
 *
 * Common sense over exact words: "pot", "investor" and "funder" mean a lender;
 * "client" means a borrower; "kita", "income" and "profit" mean earnings; "all"
 * and "everyone" mean each of whichever kind of person the figure belongs to.
 * The names themselves are matched against the account's own lists by the
 * server (server/assistant/read-answers.ts), never here.
 *
 * Pure: every rule here is tested without a database.
 */

import { clean, periodSaid, type Day } from './read.ts'

export type Metric =
  | 'earned'
  | 'floating'
  | 'outOnLoan'
  | 'interestOwed'
  | 'startingCapital'
  | 'deposits'
  | 'withdrawals'
  | 'owes'
  | 'overdue'
  | 'paid'
  | 'borrowed'
  | 'count'

/** Whose figure it is by nature: a lender's pot or a borrower's loans. */
export const BELONGS_TO: Record<Exclude<Metric, 'count'>, 'lender' | 'borrower'> = {
  earned: 'lender',
  floating: 'lender',
  outOnLoan: 'lender',
  interestOwed: 'lender',
  startingCapital: 'lender',
  deposits: 'lender',
  withdrawals: 'lender',
  owes: 'borrower',
  overdue: 'borrower',
  paid: 'borrower',
  borrowed: 'borrower',
}

export type Question = {
  metric: Metric
  /** The kind of person asked about, said or implied. */
  who: 'lender' | 'borrower'
  /** One row per person ("each", "every", "all", "per", "lahat", or a ranking). */
  each: boolean
  /** The Admin's own pot ("my pot", "did I earn", "the admin"). */
  admin: boolean
  rank: 'most' | 'least' | null
  /** For a count: what is counted. */
  countOf: 'loans' | 'borrowers' | 'lenders' | null
  period: { from: Day; to: Day; label: string } | null
}

const LENDER_WORDS = /\b(lenders?|pots?|investors?|funders?|nagpautang|capitalists?)\b/
const BORROWER_WORDS = /\b(borrowers?|clients?|customers?|people who borrowed|nangutang|umutang)\b/
const EACH = /\b(each|every|per|all|lahat|bawat|everyone|everybody|sino-sino|isa-isa)\b/

/** The figure asked about, or null. Order matters: "interest still owed" is not "owes". */
function metricOf(t: string): Metric | null {
  if (/\b(how many|ilan|number of|count of)\b/.test(t)) return 'count'
  if (/\b(starting capital|initial capital|puhunan|started with)\b/.test(t)) return 'startingCapital'
  if (/\binterest\b.*\b(owed|unpaid|pending|to collect|coming|still)\b|\bpending interest\b|\b(owed|unpaid) interest\b/.test(t)) return 'interestOwed'
  if (/\b(earn|earns|earned|earning|earnings|kita|kinita|kumita|income|profit|tubo|made money)\b/.test(t)) return 'earned'
  if (/\b(deposits?|deposited|money in|cash in|put in|nilagay|naglagay|topped up|top ups?)\b/.test(t)) return 'deposits'
  if (/\b(withdrawals?|withdrew|withdrawn|took out|taken out|cash out|cashed out|kinuha|money out)\b/.test(t)) return 'withdrawals'
  if (/\b(overdue|late|delayed|behind|lagpas|atrasado)\b/.test(t)) return 'overdue'
  if (/\b(out on loan|lent out|deployed|in (the )?borrowers'? hands|nasa labas|naka-?pautang)\b/.test(t)) return 'outOnLoan'
  if (/\b(paid|pay|pays|payments?|bayad|binayaran|nagbayad|repaid|hulog|naghulog)\b/.test(t)) return 'paid'
  if (/\b(borrow|borrowed|borrowing|hiram|hiniram|loaned)\b/.test(t)) return 'borrowed'
  if (/\b(owe|owes|owed|owing|utang|balance|balances|remaining|unpaid|still due)\b/.test(t)) return 'owes'
  if (/\b(floating|available|free|ready to lend|idle|cash on hand|natitira|left in|pots?)\b/.test(t)) return 'floating'
  // "How much does each lender have?": what a pot has is its floating money.
  if (/\bhow much\b.*\b(have|has|meron)\b|\bmagkano\b.*\b(meron|mayroon)\b/.test(t)) return 'floating'
  return null
}

/** A question about figures, read as parts; null when it is not one. */
export function readQuestion(text: string, today: Day): Question | null {
  const t = clean(text).replace(/[?.!]+$/, '')
  const metric = metricOf(t)
  if (!metric) return null
  // Two figures joined ("who is overdue and owes the most"): answering one would be half an answer, so the AI takes it.
  const sides = t.split(/\band\b|\bat\b|,/).map(metricOf).filter((m) => m !== null)
  if (new Set(sides).size > 1) return null
  const rank = /\b(most|highest|biggest|largest|top|pinakamalaki|pinakamarami|richest)\b/.test(t)
    ? 'most'
    : /\b(least|lowest|smallest|pinakamaliit|pinakakaunti)\b/.test(t)
      ? 'least'
      : null
  const saysLender = LENDER_WORDS.test(t)
  const saysBorrower = BORROWER_WORDS.test(t)
  const countOf = metric === 'count' ? (/\bloans?\b/.test(t) ? 'loans' : saysLender ? 'lenders' : saysBorrower ? 'borrowers' : null) : null
  const who: 'lender' | 'borrower' =
    metric === 'count' ? (countOf === 'lenders' ? 'lender' : 'borrower') : saysLender && !saysBorrower ? 'lender' : saysBorrower && !saysLender ? 'borrower' : BELONGS_TO[metric]
  return {
    metric,
    who,
    // "who" with a ranking is one row per person too: "who earned the most this month".
    each: EACH.test(t) || rank !== null || /\b(lenders|borrowers|pots|investors|clients)\b/.test(t) || (/^(who|sino)\b/.test(t) && metric !== 'count'),
    admin: /\b(admin|my pot|my money|did i|have i|i earned|my earnings|my cut|akin|ko)\b/.test(t),
    rank,
    countOf,
    period: periodSaid(text, today),
  }
}

/** For a count, the condition counted ("overdue", "paid") if one is said. */
export function countCondition(text: string): 'overdue' | 'paid' | 'owing' | 'made' | null {
  const t = clean(text)
  if (/\b(overdue|late|delayed|behind)\b/.test(t)) return 'overdue'
  if (/\b(paid|repaid|settled|finished|fully paid)\b/.test(t)) return 'paid'
  if (/\b(owe|owing|unpaid|active|running|open|still)\b/.test(t)) return 'owing'
  if (/\b(made|started|new|given|released|lent)\b/.test(t)) return 'made'
  return null
}
