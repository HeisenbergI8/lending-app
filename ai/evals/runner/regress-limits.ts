import { db } from '../../../src/server/db.ts'
import { recordCall, usageSummary } from '../../../src/server/assistant/usage.ts'
import { demoSession } from './client.mjs'
const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true, isDemo: true } }))!
if (!demo.isDemo) throw new Error('SAFETY STOP')
const res: [string, boolean, string][] = []
const ok = (n: string, pass: boolean, d = '') => res.push([n, pass, d])
const s = await demoSession(); const p = s.page
const section = () => p.locator('section[aria-label="Ask Pondex"]')

// CARD-06: a card whose file is optional can be confirmed without one.
const rico = (await db.loan.findFirst({ where: { userId: demo.id, status: 'ACTIVE', borrower: { firstName: 'Rico' } } }))!
let usage: any = { questionsLeft: 50, coolUntil: null, models: [] }
await p.route('**/api/assistant', async (route: any) => {
  if (route.request().method() === 'GET') return route.fulfill({ json: usage })
  return route.fulfill({ json: { ok: true, answer: 'Here is the change. Check it, then tap Confirm.', tools: [], model: 'x', tokens: 0, usage,
    proposal: { action: 'add_note', title: 'Add a note', fields: { loanId: rico.id, body: 'optional-file check' }, funders: [], files: { required: false, label: 'Proof (optional)' }, lines: [{ label: 'Note', value: 'optional-file check' }] } } })
})
await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(1500)
await p.fill('#ask-pondex-input', 'x'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
const confirm = p.getByRole('button', { name: 'Confirm' }).last()
ok('CARD-06 optional file: Confirm enabled with no file', await confirm.isEnabled(), await confirm.innerText())

// LIM-04: the header shows the count the server sends, and it goes down as questions use tokens.
const A = 'test/limit-model-a'
try {
  const before = (await usageSummary([A])).questionsLeft
  for (let i = 0; i < 3; i++) await recordCall(A, 2500, true)
  const after = (await usageSummary([A])).questionsLeft
  ok('LIM-04 questions left goes down after questions', after < before, `${before} -> ${after}`)
  usage = { questionsLeft: after, coolUntil: null, models: [] }
  await p.getByRole('button', { name: 'Close chat' }).click(); await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(1500)
  const header = await section().locator('header').innerText()
  ok('LIM-04 header shows the new count', header.includes(`About ${after} questions left today`), header.replace(/\n/g, ' '))
} finally {
  await db.assistantUsage.deleteMany({ where: { model: A } })
}
await p.unroute('**/api/assistant')

// LIM-02: several questions at the same moment (local AI): each answers or says clearly why not; nothing crashes.
const qs = ['How much is out on loan right now?', 'Who is overdue right now?', 'How much is floating in each pot?']
const answers: any[] = await Promise.all(qs.map((q) => s.ask([{ role: 'user', text: q }])))
const clear = answers.every((a) => (a.ok && a.answer) || (!a.ok && typeof a.error === 'string' && a.error.length > 0))
ok('LIM-02 three questions at once: all answered or a clear message', clear, answers.map((a) => (a.ok ? 'answered' : a.error)).join(' | '))

await s.browser.close(); await db.$disconnect()
for (const [n, pass, d] of res) console.log(pass ? 'PASS' : 'FAIL', n.padEnd(52), d.slice(0, 140))
