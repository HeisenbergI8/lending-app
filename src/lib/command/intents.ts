/**
 * What the Admin wants to do, recognised two ways, both without the big AI:
 *
 * 1. Rules: word lists for each action, Taglish and common typos included
 *    ("pahiram", "hulog", "kend" for lend). Exact and predictable.
 * 2. Meaning: example sentences for each action, compared with what was typed
 *    by a small free model on the server (see server/assistant/meaning.ts), so
 *    "can you front Rico 10k" is a new loan though no rule says "front".
 *
 * Rules are tried first. Meaning is used only when no rule fits, and only when
 * it is clearly sure. Anything else goes to the big AI, as before.
 *
 * Pure: the rules and examples are tested without a model or a database.
 */

import { fixChangeVerb } from '../../server/assistant/names.ts'
import { clean } from './read.ts'

export type Intent =
  | 'create_loan'
  | 'create_request'
  | 'fund_request'
  | 'mark_paid'
  | 'mark_week_paid'
  | 'paid_unclear'
  | 'undo_payment'
  | 'undo_week_paid'
  | 'deposit'
  | 'withdraw'
  | 'record_advance'
  | 'set_starting_capital'
  | 'set_label'
  | 'create_borrower'
  | 'create_lender'
  | 'rename'
  | 'extend_loan'
  | 'convert_to_weekly'
  | 'add_note'
  | 'delete_note'
  | 'add_loan_proof'
  | 'delete'
  | 'restore'
  | 'update_money'
  | 'update_loan'
  | 'clear_borrower_photo'
  | 'delete_request'
  | 'question'

/** Words with a slipped letter read as the word meant: "kend" is lend, "mrak" is mark. */
export function typoFixed(text: string): string {
  return clean(text).replace(/[a-z]+/g, (w) => fixChangeVerb(w))
}

const PAID = '(paid|payed|pay|pays|payment|bayad|nagbayad|binayaran|bumayad|hulog|naghulog|nag-hulog|settled|settle|cleared|remit|remitted|sent (his|her|their|the) payment)'
const LEND = '(lend|lent|loan|pahiram\\w*|ipahiram|pautang\\w*|front|fund|bigyan|give)'
const DEPOSIT = '(deposit\\w*|top(ped)?[ -]?up|added|add|put|dagdag\\w*|nagdagdag|invest(ed)?|cash(ed)? in|hulog sa pot|capital in)'
const WITHDRAW = '(withdr\\w*|took out|take out|taken out|pull(ed)? out|cash(ed)? out|kinuha|kumuha|bawi\\w*|get back|got back|encash)'

/**
 * The rules, tried in order; the first that fits wins. Order matters: "undo
 * Lyn's week 2 payment" must be an undo before it is a payment.
 */
const RULES: [Intent, RegExp][] = [
  // An undo is an undo wherever its word sits: "Dan did not really pay, reverse it" must never become a payment.
  ['undo_week_paid', /^(?=.*\b(undo|unmark|reverse|cancel|bawiin|alisin)\b)(?=.*\bweek)/],
  ['undo_payment', new RegExp(`^(?=.*\\b(undo|unmark|reverse|cancel|bawiin)\\b)(?=.*\\b${PAID}\\b)|\\b(not|never|didn'?t|did not|hindi( pa)?)\\b.{0,15}\\b(pay|paid|payed|bayad|nagbayad|magbayad)\\b|\\bmark\\b.*\\bunpaid\\b`)],
  ['restore', /\b(restore|undelete|bring back|ibalik|recover)\b/],
  // A note's own words can say anything ("asked for more time"), so a note is recognised before what it says.
  ['add_note', /\b(add|write|put|leave|save)\b.*\bnote\b|\bnote\b.*:|^(remember|tandaan)\b/],
  ['delete_note', /\b(delete|remove|erase|burahin|tanggalin|alisin)\b.*\bnote\b/],
  ['delete_request', /\b(delete|remove|decline|reject|cancel|burahin|tanggalin)\b.*\brequest\b/],
  ['clear_borrower_photo', /\b(delete|remove|clear|tanggalin|alisin)\b.*\b(photo|picture|pic|larawan)\b/],
  ['update_money', /\b(edit|fix|change|correct|update|ayusin|palitan)\b.*\b(deposit|withdrawal|money in|money out|entry)\b/],
  ['delete', /\b(delete|remove|erase|scratch|void|burahin|tanggalin|alisin)\b/],
  ['rename', /\b(rename|re-name|change\s+\S+\s+name|change (the )?name|correct (the )?spelling|spell(ed)? wrong|misspelled)\b/],
  ['set_starting_capital', /\b(starting|initial|start) (capital|money|amount)\b|\bpuhunan\b/],
  ['extend_loan', /\b(extend\w*|extension|more time|(one|1|another|isa pang) more week|another week|extra week|push (back|out)|move (the )?due|palugit|dagdag na linggo|adjust (the )?due)\b/],
  ['convert_to_weekly', /\b(weekly interest|interest weekly|(collect|pay) (the )?interest (every week|weekly)|interest every week|switch\b.*\bweekly|convert\b.*\bweekly|make\b.*\bweekly)\b/],
  ['add_loan_proof', /\b(attach|add|upload|put)\b.*\b(proof|screenshot|receipt|resibo)\b/],
  ['record_advance', /\badvance\b/],
  ['create_borrower', /\b(add|new|create|register)\b.*\bborrower\b/],
  ['create_lender', /\b(add|new|create|register)\b.*\b(lender|investor|funder)\b/],
  ['mark_week_paid', new RegExp(`\\bweek(ly)?\\b.*\\b${PAID}\\b|\\b${PAID}\\b.*\\b(week|weekly|this week|linggo)\\b|\\binterest (paid|payment)\\b`)],
  ['mark_paid', new RegExp(`\\b(fully paid|full payment|paid (in )?full|paid off|paid (the )?(whole|full|entire|rest)|paid everything|settled|cleared|bayad na lahat|tapos na|fully settled|returned (all|everything|the whole)|(i)?binalik (na )?lahat)\\b|\\bmark\\b.*\\bpaid\\b`)],
  ['paid_unclear', new RegExp(`\\b${PAID}\\b`)],
  ['set_label', /\b(make|mark|set|label|tag|rate|is|as|now|change)\b.*\b(good|okay|ok|bad|masama|mabuti)\b|\b(good|okay|bad) (borrower|payer)\b|\b(clear|remove)\b.*\blabel\b/],
  ['update_loan', /\b(edit|fix|change|correct|update|ayusin|palitan)\b.*\bloan\b/],
  // A loan said with add/give/make is a loan, not money into a pot.
  ['create_loan', /\b(add|new|create|give|make|release)\b.*\bloan\b/],
  ['fund_request', /\b(fund|approve|accept|grant)\b.*\brequest\b/],
  ['create_request', /\b(wants? to (borrow|loan)|request(s|ed)?|pending|gustong (umutang|humiram)|hihiram|uutang)\b/],
  ['withdraw', new RegExp(`\\b${WITHDRAW}\\b`)],
  ['deposit', new RegExp(`\\b${DEPOSIT}\\b`)],
  ['create_loan', new RegExp(`\\b${LEND}\\b|\\b(borrow\\w*|hiram|humiram|umutang|utang)\\b`)],
]

/** A plain question rather than a request: it is asked, not told. */
export function isQuestion(text: string): boolean {
  const t = clean(text)
  // "Pwede ba..." is "can you...": a request, like "can you lend Rico 5k".
  if (/^(can|could|would|will) you\b|^(please|pls|paki)\b|^(pwede|puwede|pede|pwd) (ba|bang|mo|nyo|niyo)\b/.test(t)) return false
  // "Ba" is how Tagalog asks: "may utang ba si Rico" is "does Rico owe?", not a loan to make (seen 2026-11-04).
  if (/\b(ba|bang)\b/.test(t)) return true
  // "Maria's deposits this month" asks to see something, the same as "show Maria's deposits".
  // "Total money out on loan per pot", "each lender's earnings": asking for a figure, said without a question.
  if (/^(total|sum|overall|all|each|every|per|lahat|bawat)\b/.test(t) && !/\d/.test(t)) return true
  // "Give me Maria's statement", "pull up the report for John Ross": asking to see, with no amount to change.
  if (/^(give me|get me|pull up|bring up|let me see|can i see|may i see|i want to see|i'd like to see|i need to see|pakita|patingin|ipakita)\b/.test(t) && !/\d/.test(t)) return true
  // Unless it starts with a change word: "fix Maria's money entry to 6k" is a change.
  if (!/^(fix|change|edit|update|correct|delete|remove|restore|undo|set|mark|add|record|rename|extend)\b/.test(t) && /\b\w+'s (deposits|withdrawals|money( history)?|earnings|loans|balance|track record|record|history|statement|cut)\b/.test(t)) return true
  return /\?\s*$/.test(t) || /^(how|who|what|when|which|why|where|is|are|does|do|did|was|were|has|have|show|list|check|tell me|magkano|sino|ano|kailan|ilan|ilang|saan|bakit|paano|meron( bang?)?)\b/.test(t)
}

/** The action the rules see, or null. Questions are never actions. */
export function intentByRules(text: string): Intent | null {
  if (isQuestion(text)) return null
  const t = typoFixed(text)
  for (const [intent, pattern] of RULES) if (pattern.test(t)) return intent
  return null
}

/**
 * Example sentences for the meaning-matcher, a handful per action, in the ways
 * people really say them. "question" examples keep plain questions from being
 * read as changes.
 */
export const EXAMPLES: Record<Exclude<Intent, 'delete' | 'restore' | 'paid_unclear'> | 'delete_any' | 'restore_any', string[]> = {
  create_loan: ['lend Rico 10k from Maria for 3 weeks', 'give Rico a loan of 5000', 'new loan for Lyn from Jun', 'can you front Rico 8k for two weeks', 'Rico will borrow 10k from Maria', 'release a loan to Angel'],
  create_request: ['Rico wants to borrow 10k', 'add a pending request for Lyn 5000 for 4 weeks', 'put Angel on the waiting list for 8k', 'Dan is asking for a loan of 6k'],
  fund_request: ["fund Rico's request from Maria", "approve Lyn's pending request", 'turn the request into a loan'],
  mark_paid: ['Angel returned all the money', 'Dan fully paid his loan', 'mark Angel loan as paid in full', 'Rico settled everything', 'Dan cleared his whole balance', 'Lyn returned all the money'],
  mark_week_paid: ['Lyn paid week 2', 'Lyn paid her interest this week', 'mark this week paid for Angel', 'Rico sent his weekly payment', 'Dan gave this week interest'],
  undo_payment: ['undo Dan payment', 'Dan did not really pay, reverse it', 'mark Angel loan as unpaid again'],
  undo_week_paid: ["undo Lyn's week 2", 'week 3 was marked paid by mistake', 'unmark the weekly payment for Rico'],
  deposit: ['Maria sent another 20k for her pot', 'Maria deposited 5000', 'add 5k to Maria pot', 'Jun topped up 10k', 'put 3000 into the Admin pot', 'Maria invested another 20k'],
  withdraw: ['Jun needs his 3k back', 'Jun withdrew 2000', 'take 2k out of Jun pot', 'Maria cashed out 3000', 'Jun pulled out 1500 from his money', 'Maria got back 5k of her money'],
  record_advance: ["take an advance of 3k against Rico's loan", 'draw 2000 early from Angel loan'],
  set_starting_capital: ["set Maria's starting capital to 50k", 'Jun started with 30000', 'change the starting capital of Maria'],
  set_label: ['make Angel Bad', 'set Lyn label to Good', 'Rico is Okay now', 'Angel is a bad payer now', 'Dan is reliable, mark him good', 'clear Lyn label'],
  create_borrower: ['add borrower Juan Dela Cruz', 'new borrower Ana Santos', 'register a borrower named Mark Reyes'],
  create_lender: ['add lender Ana Santos', 'new investor Paolo Cruz', 'Ben Reyes is a new lender'],
  rename: ['rename Juan to Juan Cruz', "fix the spelling of Rico's name", 'change Angel last name to Arellano'],
  extend_loan: ["extend Rico's loan 2 weeks", 'give Lyn one more week', 'push back Angel due date by a week', 'Rico asked for one more week', 'Lyn needs more time to pay'],
  convert_to_weekly: ["switch Rico's loan to weekly interest", 'Angel will pay interest every week now'],
  add_note: ["note on Dan's loan: will pay Friday", 'write a note for Rico: asked for more time', 'remember that Lyn pays on Saturdays'],
  delete_note: ["delete the note on Dan's loan", 'remove that note from Rico loan'],
  add_loan_proof: ["attach the screenshot for Rico's loan", 'add proof that the money was sent to Lyn'],
  update_money: ["fix Maria's deposit to 6k", "change Jun's withdrawal yesterday to 2500", 'the deposit amount was wrong'],
  update_loan: ["change Rico's loan to 12k", "fix the rate on Angel's loan to 8%", 'the loan amount for Lyn is wrong'],
  clear_borrower_photo: ["remove Angel's photo", 'delete the picture of Rico'],
  delete_request: ["remove Rico's pending request", 'decline the request from Lyn'],
  delete_any: ["delete Dan's loan", 'remove Maria deposit yesterday', 'delete borrower Juan'],
  restore_any: ["restore Dan's loan", 'bring back the deleted borrower Juan', 'undo the delete of Maria deposit'],
  question: ['how much does Angel owe', 'who is overdue', "show me Rico's loans", 'how much is floating', 'when is Lyn due', 'what are the rules for labels', 'is Dan a good borrower', 'how much did Maria earn'],
}
