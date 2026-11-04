// Everything on the Lenders pages, asked loosely, through the server alone (no AI).
// Demo account only, read only: nothing is changed.
// node --env-file=.env --experimental-strip-types ai/evals/runner/regress-lender-page.ts
import { db } from '../../../src/server/db.ts'
import { ask } from '../../../src/server/assistant/chat.ts'

const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true, isDemo: true } }))!
if (!demo.isDemo) throw new Error('SAFETY STOP')
const U = demo.id

const CASES: [string, RegExp][] = [
  // The lender statement, any wording
  ['give me a report for lender statement all time for John Ross', /earned by John Ross Santos in all\. This is the lender statement/],
  ['lender statement for Maria', /earned by Maria Cruz in all\. This is the lender statement/],
  ["Maria's statement this month", /earned by Maria Cruz this month\. This is the lender statement/],
  ['show me the statment of jun for october', /earned by Jun Reyes in October( 2026)?\. This is the lender statement/],
  ['pull up john ross report last month', /earned by John Ross Santos (last month|in October)/],
  ['my statement this month', /earned by Demo Admin this month/],
  ['tell me about Maria', /Maria Cruz.*lender statement/],
  ['summary of marias pot', /Maria Cruz in all\. This is the lender statement/],
  ['kumusta pot ni Jun', /Jun Reyes in all/],
  ['lender statement please', /^Which lender\?/],
  ['Can I see a lender report?', /^Which lender\?/],
  // Where the money is
  ["where is Maria's money?", /in Maria Cruz's pot in all[\s\S]*Ready to lend[\s\S]*Overdue/],
  ['breakdown of my pot', /in Demo Admin's pot in all[\s\S]*Cut coming/],
  ['saan napunta pera ni Jun', /in Jun Reyes's pot in all/],
  ['John Ross pot total', /in John Ross Santos's pot in all/],
  // Who has the money (Out with)
  ["who has Maria's money?", /out with Maria Cruz's money|None of Maria Cruz's money/],
  ["Maria's loans", /out with Maria Cruz's money|None of Maria Cruz's money/],
  ['which loans does jun fund', /out with Jun Reyes's money|None of Jun Reyes's money/],
  ["show John Ross's overdue loans", /overdue out with John Ross Santos's money|No loan of John Ross Santos's money is overdue/],
  ['sino may hawak ng pera ni maria', /Maria Cruz's money/],
  ['loans from my pot', /Demo Admin's money/],
  // Paid back
  ["Maria's repaid loans", /repaid, earning Maria Cruz|No loan funded by Maria Cruz's money was repaid/],
  ['loans jun funded that were paid back', /Jun Reyes/],
  ['John Ross track record', /John Ross Santos/],
  // Rate
  ['what rate does Maria earn?', /a week on Maria Cruz's loans|Maria Cruz's (money has no loans|loans all charge)/],
  ["jun's interest rate", /Jun Reyes/],
  ['ano patong ni john ross', /John Ross Santos/],
  // Starting capital history
  ["Maria's starting capital history", /starting capital for Maria Cruz now|No starting capital is set for Maria Cruz/],
  ['when did my capital change', /Demo Admin/],
  // Admin cut sources
  ['where does my cut come from?', /cut still coming/],
  ['admin cut breakdown', /cut still coming/],
  // The Lenders list
  ['show my lenders', /floating across \d+ lenders/],
  ['who are my lenders?', /floating across \d+ lenders/],
  ['lenders', /floating across \d+ lenders/],
  ['list of investors', /floating across \d+ lenders/],
  // Money history filters on a lender
  ["Maria's lent out history", /lent out for Maria Cruz|Nothing lent out for Maria Cruz/],
  ['paid back history for jun this month', /paid back for Jun Reyes|Nothing paid back for Jun Reyes/],
  // Figures already answered must stay the same
  ['how much did Maria earn this month?', /earned by Maria Cruz this month/],
  ['how much does Maria have?', /floating in Maria Cruz's pot|Maria Cruz/],
  ['how much is floating in each pot?', /floating across \d+ (lenders|pots)/],
  ['who owes the most?', /the most of any borrower|owe/],
  ["Rico's loans", /Rico Mendoza/],
  ['which loans are due next week?', /due next week/],
  ['how many loans did Maria fund?', /funded by Maria Cruz/],
  ['how much did we lend this month?', /this month/],
  ["Maria's deposits this month", /Maria Cruz/],
  ['how much will Maria have by end of the month?', /floating in Maria Cruz's pot by/],
  ['is Dan a good borrower?', /Dan Aquino/],
  ['how much is my cut this month?', /Admin's cut collected this month/],
  ['how many lenders do I have?', /lenders\*\*, the Admin's pot included/],
]

type Reply = { model: string; answer: string }
const results: [string, string | null][] = []
for (const [text, want] of CASES) {
  const r = (await ask(U, [{ role: 'user', text }], undefined, { serverOnly: true })) as unknown as Reply
  const why = r.model !== 'server' ? `went to ${r.model}` : want.test(r.answer) ? null : `said: ${r.answer.replace(/\n/g, ' / ').slice(0, 140)}`
  results.push([text, why])
  console.log(why ? 'FAIL' : 'PASS', text, why ? `→ ${why}` : '')
}
await db.$disconnect()
const failed = results.filter((x) => x[1])
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 1
