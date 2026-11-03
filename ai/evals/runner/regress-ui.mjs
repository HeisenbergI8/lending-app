import { demoSession } from './client.mjs'
const out = process.argv[2]
const s = await demoSession()
const p = s.page
const res = []
const ok = (name, pass, detail = '') => res.push([name, pass, detail])
const header = () => p.locator('section[aria-label="Ask Pondex"] header').innerText()

// 1. Local counter (real endpoint, local model).
await p.goto('http://localhost:3456/'); await p.waitForTimeout(1500)
await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(2000)
ok('local counter text', (await header()).includes("Running on this Mac's AI"), await header())
await p.getByRole('button', { name: 'Close chat' }).click()

// 2. Groq counter and countdown (faked server answers).
let usage = { questionsLeft: 87, coolUntil: null, models: [] }
let n = 0
const card = (amount) => ({ action: 'create_loan', title: 'Make a new loan', fields: {}, funders: [], files: { required: true, label: 'Screenshot of the money being sent' }, lines: [{ label: 'Amount', value: amount }] })
await p.route('**/api/assistant', async (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ json: usage })
  n++
  return route.fulfill({ json: { ok: true, answer: 'Here is the change. Check it, then tap Confirm.', tools: [], model: 'x', tokens: 0, usage, proposal: card(n === 1 ? '₱5,000.00' : '₱6,000.00') } })
})
await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(1500)
ok('groq counter text', (await header()).includes('About 87 questions left today'), await header())

// 3. A newer card retires the older one.
await p.fill('#ask-pondex-input', 'Lend 5k to Rico'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
await p.fill('#ask-pondex-input', 'actually make it 6k'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
const badges = await p.locator('section[aria-label="Ask Pondex"]').getByText(/Replaced by a newer card|Not saved yet/).allInnerTexts()
ok('older card replaced, newest still open', badges.join('|') === 'Replaced by a newer card|Not saved yet', badges.join('|'))
const confirmButtons = await p.getByRole('button', { name: /Confirm|Attach the file first/ }).count()
ok('only one card can be confirmed', confirmButtons === 1, String(confirmButtons))
await p.screenshot({ path: `${out}/ui-replaced.png` })

// 4. Countdown when every model is resting.
usage = { questionsLeft: 0, coolUntil: new Date(Date.now() + 65_000).toISOString(), models: [] }
await p.getByRole('button', { name: 'Close chat' }).click(); await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(2000)
const h1 = await header()
ok('countdown shown', /Resting · back in 1:0\d/.test(h1), h1)
ok('input locked while resting', await p.locator('#ask-pondex-input').isDisabled())
await p.waitForTimeout(3000)
const h2 = await header()
ok('countdown ticks', h1 !== h2, `${h1} -> ${h2}`)
await p.screenshot({ path: `${out}/ui-resting.png` })

// 5. When the countdown ends, the chat asks again and unlocks.
usage = { questionsLeft: 40, coolUntil: new Date(Date.now() + 2_000).toISOString(), models: [] }
await p.getByRole('button', { name: 'Close chat' }).click(); await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(800)
usage = { questionsLeft: 40, coolUntil: null, models: [] }
await p.waitForTimeout(3500)
ok('unlocks after countdown', !(await p.locator('#ask-pondex-input').isDisabled()) && (await header()).includes('About 40'), await header())

await s.browser.close()
for (const [name, pass, d] of res) console.log(pass ? 'PASS' : 'FAIL', name.padEnd(40), pass ? '' : d)
console.log(`\n${res.filter((r) => r[1]).length}/${res.length} passed`)
