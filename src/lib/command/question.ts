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
  // "Money out on loan" is out on loan, not money out of a pot: checked before deposits and withdrawals.
  if (/\b(out on loan|lent out|deployed|in (the )?borrowers'? hands|nasa labas|naka-?pautang)\b/.test(t)) return 'outOnLoan'
  if (/\b(deposits?|deposit|deposited|money in|cash in|put in|nilagay|naglagay|topped up|top ups?)\b/.test(t)) return 'deposits'
  if (/\b(withdrawals?|withdraw|withdrew|withdrawn|took out|taken out|cash out|cashed out|kinuha|money out)\b/.test(t)) return 'withdrawals'
  if (/\b(overdue|late|delayed|behind|lagpas|atrasado)\b/.test(t)) return 'overdue'
  if (/\b(paid|pay|pays|payments?|bayad|binayaran|nagbayad|repaid|paid back|returned|hulog|naghulog|naibalik|ibinalik|binalik)\b/.test(t)) return 'paid'
  if (/\b(borrow|borrowed|borrowing|hiram|hiniram|loaned)\b/.test(t)) return 'borrowed'
  if (/\b(owe|owes|owed|owing|utang|balance|balances|remaining|unpaid|still due)\b/.test(t)) return 'owes'
  if (/\b(floating|available|free|ready to lend|idle|cash on hand|natitira|left in|hawak|holding|holds|pots?)\b/.test(t)) return 'floating'
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
  const rank = /\b(most|highest|biggest|largest|top|richest|pinakamalaki\w*|pinakamarami\w*)\b/.test(t)
    ? 'most'
    : /\b(least|lowest|smallest|pinakamaliit\w*|pinakakaunti\w*)\b/.test(t)
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
    // The Admin speaking of themself: "I", "me", "my", "ko", "akin" ("how much interest will I still get?").
    admin: /\b(admin|i|me|my|mine|akin|ko)\b/.test(t),
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

/**
 * What a question asks about one lender's page, beyond a single figure:
 *
 *   statement   "lender statement for John Ross", "Maria's report", "tell me about Maria's pot"
 *   breakdown   "where is Maria's money", "breakdown of my pot", "Maria's pot total"
 *   loans       "who has Maria's money", "Maria's loans", "which loans does Maria fund"
 *   repaid      "Maria's repaid loans", "loans Maria funded that were paid back"
 *   rate        "what rate does Maria earn", "Maria's interest rate"
 *   capital     "Maria's starting capital history", "when did my capital change"
 *   cut         "where does my cut come from", "Admin cut breakdown"
 *   list        "show my lenders", "who are my lenders", "list of pots"
 *
 * Typos and Taglish are part of the words. Null for anything else, so plain
 * figures ("how much did Maria earn") stay with readQuestion.
 */
export type LenderTopic = 'statement' | 'breakdown' | 'loans' | 'repaid' | 'rate' | 'capital' | 'cut' | 'list'

export function lenderTopic(text: string): LenderTopic | null {
  const t = clean(text).replace(/[?.!]+$/, '')
  // "How many loans did Maria fund" is a count.
  if (/\b(how many|ilan)\b/.test(t)) return null
  if (/^(show|list|see|give me|view)?\s*(me\s+)?(all\s+|my\s+|the\s+)*(lenders|pots|investors|funders)(\s+list)?$|\b(who are|sino( ang| yung)?) (my |the |mga )*(lenders|investors|funders|nagpautang)\b|\b(list|lista) (of )?(my |the |mga )*(lenders|pots|investors)\b/.test(t)) return 'list'
  if (/\b(cut|commission|komisyon)\b.*\b(come from|comes from|from where|where|which loans|sources?|breakdown|break down|galing)\b|\bwhere\b.*\b(cut|commission)\b/.test(t)) return 'cut'
  if (/\b(starting capital|initial capital|capital|puhunan)\b.*\b(history|changes?|changed|versions?|past|before|when|kailan)\b|\b(history|changes) (of|sa) .*\b(capital|puhunan)\b/.test(t)) return 'capital'
  if (/\b(statement|statment|statemnt|staement|report|reprot|repot|summary|overview|profile|rundown|run down|full details|details|detail|info|information|everything about|all about|tell me about|kumusta|kamusta)\b/.test(t)) return 'statement'
  if (/\b(breakdown|break down|broken down|pot total|total pot|whole pot|split|parts)\b|\bwhere\b.*\b(money|pera|pot|capital|funds)\b|\b(saan|nasaan)\b.*\b(pera|money|pot)\b/.test(t)) return 'breakdown'
  if (/\b(interest rate|rates?|percent|percentage|patong)\b|%/.test(t)) return 'rate'
  if (/\b(paid back|repaid|settled|finished|completed|returned|natapos|tapos na|bayad na)\b.*\bloans?\b|\bloans?\b.*\b(paid back|repaid|settled|finished|completed|returned|natapos|bayad na)\b|\btrack record\b/.test(t)) return 'repaid'
  if (/\b(loans?|fundings?|funds|funding|funded|financ\w*|out with|pinautang|napautang)\b|\bwho\b.*\b(has|have|is using|are using|using|borrowed|is holding|holds)\b|\bsino\b.*\b(may hawak|gumagamit|humiram|nangutang)\b/.test(t)) return 'loans'
  return null
}
