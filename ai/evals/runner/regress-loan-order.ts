// New-loan sentences in any word order and loose grammar, through the server alone (no AI).
// Demo account only, read only: cards are made but never confirmed.
// node --env-file=.env --experimental-strip-types ai/evals/runner/regress-loan-order.ts
import { db } from '../../../src/server/db.ts'
import { ask } from '../../../src/server/assistant/chat.ts'

const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true, isDemo: true } }))!
if (!demo.isDemo) throw new Error('SAFETY STOP')
const U = demo.id

const ADMIN = 'Demo Admin', JR = 'John Ross Santos', JUN = 'Jun Reyes', MARIA = 'Maria Cruz'
const ANGEL = 'Angel Dela Cruz', RICO = 'Rico Mendoza', BEA = 'Bea Villanueva', DAN = 'Dan Aquino', LYN = 'Lyn Bautista'

type Card = { b: string; l: string[]; cap: number }
type Expect = Card | { says: RegExp } | { noCardFor: string[] }
const CASES: [string, Expect][] = [
  // borrower first (the order that already worked)
  ['lend Rico 5k from Maria for 2 weeks', { b: RICO, l: [MARIA], cap: 5000 }],
  ['Lend Bea 3000 from Jun for 1 week', { b: BEA, l: [JUN], cap: 3000 }],
  ['lend dan 10k from john ross 4 weeks', { b: DAN, l: [JR], cap: 10000 }],
  ['pahiram kay Lyn 2k galing kay Maria 2 weeks', { b: LYN, l: [MARIA], cap: 2000 }],
  ['give Angel a loan of 4000 from my pot for 3 weeks', { b: ANGEL, l: [ADMIN], cap: 4000 }],
  ['Lend Angel Dela Cruz 3k from Maria Cruz 2 weeks', { b: ANGEL, l: [MARIA], cap: 3000 }],
  ['front rico 2k from jun 1 week', { b: RICO, l: [JUN], cap: 2000 }],
  // lender first, borrower after "to"
  ['Lend a money from Maria pot 500 pesos to Angel Dela Cruz in 3 days', { b: ANGEL, l: [MARIA], cap: 500 }],
  ['from maria lend 5k to rico 2 weeks', { b: RICO, l: [MARIA], cap: 5000 }],
  ['lend money from Jun pot 1000 to Bea for 1 week', { b: BEA, l: [JUN], cap: 1000 }],
  ['lend from John Ross 8k to Dan, 4 weeks', { b: DAN, l: [JR], cap: 8000 }],
  ['Lend from my pot 2000 to Lyn for 2 weeks', { b: LYN, l: [ADMIN], cap: 2000 }],
  ['lend a money from maria cruz 5k to rico for 2 weeks', { b: RICO, l: [MARIA], cap: 5000 }],
  ['loan from jun reyes 3k to angel dela cruz 3 weeks', { b: ANGEL, l: [JUN], cap: 3000 }],
  ['from Maria Cruz pot lend 6000 to Angel for 2 weeks', { b: ANGEL, l: [MARIA], cap: 6000 }],
  ['lend from maria to angel dela cruz 7k 1 week', { b: ANGEL, l: [MARIA], cap: 7000 }],
  ['release a loan from maria 5k to lyn 3 weeks', { b: LYN, l: [MARIA], cap: 5000 }],
  ['Lend 5k to Rico from Maria for 2 weeks', { b: RICO, l: [MARIA], cap: 5000 }],
  ['lend to rico from maria 5k 2 weeks', { b: RICO, l: [MARIA], cap: 5000 }],
  ['to rico lend 5k from maria 2 weeks', { b: RICO, l: [MARIA], cap: 5000 }],
  // other "from" words, and no "to" at all
  ["out of Jun's pot lend Rico 2500 for 2 weeks", { b: RICO, l: [JUN], cap: 2500 }],
  ['using John Ross money lend Bea 9k 3 weeks', { b: BEA, l: [JR], cap: 9000 }],
  ['funded by Maria, loan to Dan 4k for 2 weeks', { b: DAN, l: [MARIA], cap: 4000 }],
  ['from john ross santos pot, loan 10k for dan aquino 4 weeks', { b: DAN, l: [JR], cap: 10000 }],
  ['kindly lend a 3k money from jun pot into bea account for 1 week', { b: BEA, l: [JUN], cap: 3000 }],
  ['lend... from maria!!! 5k -> rico, 2 weeks', { b: RICO, l: [MARIA], cap: 5000 }],
  ['maria lend rico 4k 2 weeks', { b: RICO, l: [MARIA], cap: 4000 }],
  ['jun will lend dan 2k for 1 week', { b: DAN, l: [JUN], cap: 2000 }],
  // Taglish
  ['pahiram galing kay Maria 3k para kay Lyn 2 weeks', { b: LYN, l: [MARIA], cap: 3000 }],
  ['pautang galing kay Jun 2000 kay Rico 1 week', { b: RICO, l: [JUN], cap: 2000 }],
  ['pahiram from my pot 1500 kay Bea 2 weeks', { b: BEA, l: [ADMIN], cap: 1500 }],
  ['ipahiram sa pera ni John Ross 5k para kay Dan 3 weeks', { b: DAN, l: [JR], cap: 5000 }],
  ['pahiram sa pot ni Maria 2k para sa Angel 1 week', { b: ANGEL, l: [MARIA], cap: 2000 }],
  // loose grammar
  ['lend money from maria 500 pesos to angel in 7 days', { b: ANGEL, l: [MARIA], cap: 500 }],
  ['me lend from jun pot 1k to bea 1 weeks', { b: BEA, l: [JUN], cap: 1000 }],
  ['Lend frm Maria 3k to Lyn 2 weeks', { b: LYN, l: [MARIA], cap: 3000 }],
  ['can you lend from maria 3k to lyn for 2 week', { b: LYN, l: [MARIA], cap: 3000 }],
  ['Lend, from: Jun; amount 1k; to: Bea; 1 week', { b: BEA, l: [JUN], cap: 1000 }],
  ['LEND FROM MARIA 5K TO RICO 2 WEEKS', { b: RICO, l: [MARIA], cap: 5000 }],
  ['new loan from jun 1500 to bea 1 week', { b: BEA, l: [JUN], cap: 1500 }],
  // amounts written different ways
  ['lend 5,000 to bea from john ross for 2 weeks', { b: BEA, l: [JR], cap: 5000 }],
  ['lend ₱3,000 from Jun to Lyn 1 week', { b: LYN, l: [JUN], cap: 3000 }],
  ['lend 2000 pesos from maria to dan 3 weeks', { b: DAN, l: [MARIA], cap: 2000 }],
  // typos in names
  ['lend from mariaa 3k to rico 2 weeks', { b: RICO, l: [MARIA], cap: 3000 }],
  ['lend from maria 3k to Rikco 2 weeks', { b: RICO, l: [MARIA], cap: 3000 }],
  ['lend from jun 2k to Bea Villanueba 1 week', { b: BEA, l: [JUN], cap: 2000 }],
  ['lend from Jhon Ross 5k to Dan 2 weeks', { b: DAN, l: [JR], cap: 5000 }],
  // last names only, with "Cruz" on both a lender and a borrower
  ['lend from Cruz 2k to Mendoza 2 weeks', { b: RICO, l: [MARIA], cap: 2000 }],
  ['lend from Reyes 1k to Aquino 1 week', { b: DAN, l: [JUN], cap: 1000 }],
  ['lend from Maria Cruz 2k to Dela Cruz 1 week', { b: ANGEL, l: [MARIA], cap: 2000 }],
  // several lenders
  ['lend from Maria and Jun 6k to Rico 2 weeks, split evenly', { b: RICO, l: [MARIA, JUN], cap: 6000 }],
  ['from Maria 3k and Jun 2k lend to Bea 2 weeks', { b: BEA, l: [MARIA, JUN], cap: 5000 }],
  ['lend 4k each from maria and john ross to dan for 4 weeks', { b: DAN, l: [MARIA, JR], cap: 8000 }],
  ['lend to Lyn 6k from my pot and maria, split evenly, 2 weeks', { b: LYN, l: [ADMIN, MARIA], cap: 6000 }],
  // lengths and due dates
  ['lend from maria 5k to rico until Nov 18', { b: RICO, l: [MARIA], cap: 5000 }],
  ['lend from jun 2k to bea due Nov 25', { b: BEA, l: [JUN], cap: 2000 }],
  ['lend from my pot 1000 to angel for 14 days', { b: ANGEL, l: [ADMIN], cap: 1000 }],
  ['lend from john ross 3k to lyn in 3 days', { b: LYN, l: [JR], cap: 3000 }],
  ['lend from maria 2k to dan for 5 days', { b: DAN, l: [MARIA], cap: 2000 }],
  ['lend from jun 1k to rico in 10 days', { b: RICO, l: [JUN], cap: 1000 }],
  // never a card for the wrong person
  ['lend from Rico 5k to Bea 2 weeks', { says: /Rico Mendoza is a borrower, not a lender/ }],
  ['lend from maria 5k to Juan Santos 2 weeks', { noCardFor: [ANGEL, RICO, BEA, DAN, LYN] }],
  ['lend from maria 5k to Bea and Dan 2 weeks', { noCardFor: [BEA, DAN] }],
]

type Reply = { model: string; answer: string; choices?: { label: string; send: string }[]; proposal?: { action: string; lines: { label: string; value: string }[] } | null }
const send = async (text: string) => (await ask(U, [{ role: 'user', text }], undefined, { serverOnly: true })) as unknown as Reply

function checkCard(r: Reply, e: Card): string | null {
  const p = r.proposal
  if (!p || p.action !== 'create_loan') return `no loan card (${r.model}: ${r.answer.slice(0, 90)})`
  const line = (label: string) => p.lines.find((l) => l.label === label)?.value
  if (line('Borrower') !== e.b) return `borrower ${line('Borrower')}, wanted ${e.b}`
  const from = p.lines.filter((l) => l.label.startsWith('From ')).map((l) => l.label.slice(5)).sort()
  if (from.join() !== [...e.l].sort().join()) return `lenders ${from.join(' + ')}, wanted ${e.l.join(' + ')}`
  const amount = Number(line('Amount')?.replace(/[₱,]/g, ''))
  if (amount !== e.cap) return `amount ${amount}, wanted ${e.cap}`
  return null
}

const results: [string, string | null][] = []
for (const [text, e] of CASES) {
  let r = await send(text)
  let why: string | null
  // A borrower the server cannot place may go to the AI; it must just never be a card for someone else.
  if ('noCardFor' in e) {
    const b = r.proposal?.lines.find((l) => l.label === 'Borrower')?.value
    why = b && e.noCardFor.includes(b) ? `made a card for ${b}` : null
  } else if (r.model !== 'server') why = `went to ${r.model}`
  else if ('says' in e) why = e.says.test(r.answer) ? null : `said: ${r.answer.slice(0, 100)}`
  else {
    // A due-date question (a loan under a week, or not whole weeks): tap its first button, as the Admin would.
    if (!r.proposal && r.choices?.length) {
      const first = r.choices[0]
      const tapped = await send(first.send)
      if (tapped.model !== 'server') why = `button "${first.label}" went to ${tapped.model}`
      else r = tapped
    }
    why ??= checkCard(r, e)
  }
  results.push([text, why])
  console.log(why ? 'FAIL' : 'PASS', text, why ? `→ ${why}` : '')
}
await db.$disconnect()
const failed = results.filter((x) => x[1])
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 1
