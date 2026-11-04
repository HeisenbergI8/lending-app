import { db } from '../../../src/server/db.ts'
import { demoSession } from './client.mjs'
const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true, isDemo: true } }))!
if (!demo.isDemo) throw new Error('SAFETY STOP')
const lyn = (await db.borrower.findFirst({ where: { userId: demo.id, firstName: 'Lyn' } }))!
const jun = (await db.lender.findFirst({ where: { userId: demo.id, firstName: 'Jun' } }))!
const s = await demoSession(); const p = s.page
const res: [string, boolean, string][] = []
const ok = (n: string, pass: boolean, d = '') => res.push([n, pass, d])
const section = () => p.locator('section[aria-label="Dex-E"]')
let next: any = null
await p.route('**/api/assistant', async (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ json: { status: 'ready', inUse: 'openai/gpt-oss-120b', questionsLeft: 50, coolUntil: null, models: [] } })
  return route.fulfill({ json: { ok: true, answer: 'Here is the change. Check it, then tap Confirm.', tools: [], model: 'x', tokens: 0, usage: { status: 'ready', inUse: 'openai/gpt-oss-120b', questionsLeft: 50, coolUntil: null, models: [] }, proposal: next } })
})
const askFor = async (proposal: any) => { next = proposal; await p.fill('#ask-pondex-input', 'x'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500) }
await p.getByRole('button', { name: /Open Dex-E/ }).click(); await p.waitForTimeout(1500)

// CARD-03: the app's own refusal shows on the card.
await askFor({ action: 'create_loan', title: 'Make a new loan', fields: { borrowerId: lyn.id, capital: '30000', startOn: '2026-11-04', dueOn: '2026-12-02' }, funders: [{ lenderId: jun.id, amount: '30000' }], files: { required: true, label: 'Screenshot of the money being sent' }, lines: [{ label: 'Amount', value: '₱30,000.00' }] })
await p.locator('section[aria-label="Dex-E"] input[type=file]').last().setInputFiles({ name: 'sent.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fe0dc8a1d70000000049454e44ae426082', 'hex') })
await p.getByRole('button', { name: 'Confirm' }).last().click(); await p.waitForTimeout(4000)
const refusal = await section().getByText(/Not enough floating funds/).count()
ok('CARD-03 app refusal shown on the card, Not saved', refusal > 0 && (await section().getByText('Not saved', { exact: true }).count()) > 0)

// CARD-09: a text file named .png is refused by the app, nothing saved.
await askFor({ action: 'add_loan_proof', title: 'Add proof the loan money was sent', fields: { loanId: (await db.loan.findFirst({ where: { userId: demo.id, borrowerId: lyn.id, status: 'ACTIVE' } }))!.id }, funders: [], files: { required: true, label: 'Screenshot' }, lines: [{ label: 'Loan', value: 'Lyn' }] })
const before = await db.loanProof.count({ where: { userId: demo.id } })
await p.locator('section[aria-label="Dex-E"] input[type=file]').last().setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') })
await p.getByRole('button', { name: 'Confirm' }).last().click(); await p.waitForTimeout(4000)
const after = await db.loanProof.count({ where: { userId: demo.id } })
const lastCard = await section().locator('div.animate-ask-rise').last().innerText()
ok('CARD-09 fake image: no file saved', after === before, `proofs ${before}->${after}; card: ${lastCard.slice(-160).replace(/\n/g, ' ')}`)

// CARD-04: a successful Confirm shows Saved.
await askFor({ action: 'create_borrower', title: 'Add a borrower', fields: { firstName: 'Card', lastName: 'Success' }, funders: [], files: null, lines: [{ label: 'First name', value: 'Card' }] })
await p.getByRole('button', { name: 'Confirm' }).last().click(); await p.waitForTimeout(4000)
ok('CARD-04 success shows Saved', (await section().getByText('Saved', { exact: true }).count()) > 0 && (await db.borrower.count({ where: { userId: demo.id, firstName: 'Card', lastName: 'Success' } })) === 1)

// CARD-07: no network on Confirm.
await askFor({ action: 'create_borrower', title: 'Add a borrower', fields: { firstName: 'Offline', lastName: 'Test' }, funders: [], files: null, lines: [{ label: 'First name', value: 'Offline' }] })
await p.context().setOffline(true)
await p.getByRole('button', { name: 'Confirm' }).last().click(); await p.waitForTimeout(2500)
ok('CARD-07 offline Confirm: says nothing was saved', (await section().getByText(/Could not reach Pondex\. Nothing was saved\./).count()) > 0 && (await db.borrower.count({ where: { userId: demo.id, firstName: 'Offline' } })) === 0)
// LIM-06: no network on a question.
await p.unroute('**/api/assistant')
await p.fill('#ask-pondex-input', 'how much is out on loan?'); await p.keyboard.press('Enter'); await p.waitForTimeout(3000)
ok('LIM-06 offline question: clear message', (await section().getByText(/Could not reach Pondex/).count()) > 1)
await p.context().setOffline(false)

// LIM-07: a question longer than 600 characters, with the real ask at the end.
const long = 'Context: '.padEnd(640, 'blah ') + ' How much is out on loan right now?'
const r: any = await s.ask([{ role: 'user', text: long }])
ok('LIM-07 long question: answered without error', r.ok === true, `answer: ${(r.answer ?? r.error ?? '').slice(0, 140)} (the last part of a 675-character message is cut at 600)`)

await s.browser.close(); await db.$disconnect()
for (const [n, pass, d] of res) console.log(pass ? 'PASS' : 'FAIL', n.padEnd(52), d)
