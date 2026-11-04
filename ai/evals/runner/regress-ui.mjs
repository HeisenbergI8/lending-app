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
const MODELS = [{ model: 'openai/gpt-oss-120b', used: 12000, limit: 200000, exact: false, coolUntil: null, requestsLeft: 990, requestLimit: 1000, minuteTokensLeft: 6400 }, { model: 'openai/gpt-oss-20b', used: 0, limit: 200000, exact: false, coolUntil: null, requestsLeft: null, requestLimit: null, minuteTokensLeft: null }]
let usage = { status: 'ready', inUse: 'openai/gpt-oss-120b', questionsLeft: 87, coolUntil: null, models: MODELS }
let n = 0
const card = (amount) => ({ action: 'create_loan', title: 'Make a new loan', fields: {}, funders: [], files: { required: true, label: 'Screenshot of the money being sent' }, lines: [{ label: 'Amount', value: amount }] })
await p.route('**/api/assistant', async (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ json: usage })
  n++
  return route.fulfill({ json: { ok: true, answer: 'Here is the change. Check it, then tap Confirm.', tools: [], model: 'x', tokens: 0, usage, proposal: card(n === 1 ? '₱5,000.00' : '₱6,000.00') } })
})
await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(1500)
ok('groq status text', (await header()).includes('Ready'), await header())
await p.getByRole('button', { name: /^Ready/ }).click(); await p.waitForTimeout(500)
const details = await p.locator('section[aria-label="Ask Pondex"]').innerText()
ok('details in plain words', details.includes('Main AI') && details.includes('In use · about 94% left today') && details.includes('Backup AI') && !details.includes('gpt-oss'), details.slice(0, 300).replace(/\n/g, ' '))
await p.screenshot({ path: `${out}/ui-details.png` })
await p.getByRole('button', { name: /^Ready/ }).click()

// 3. A newer card retires the older one.
await p.fill('#ask-pondex-input', 'Lend 5k to Rico'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
await p.fill('#ask-pondex-input', 'actually make it 6k'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
const badges = await p.locator('section[aria-label="Ask Pondex"]').getByText(/Replaced by a newer card|Not saved yet/).allInnerTexts()
ok('older card replaced, newest still open', badges.join('|') === 'Replaced by a newer card|Not saved yet', badges.join('|'))
const confirmButtons = await p.getByRole('button', { name: /Confirm|Attach the file first/ }).count()
ok('only one card can be confirmed', confirmButtons === 1, String(confirmButtons))
await p.screenshot({ path: `${out}/ui-replaced.png` })

// 4. Countdown when every model is resting.
usage = { status: 'busy', inUse: null, questionsLeft: 0, coolUntil: new Date(Date.now() + 65_000).toISOString(), models: MODELS }
await p.getByRole('button', { name: 'Close chat' }).click(); await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(2000)
const h1 = await header()
ok('countdown shown', /Busy · ready again in 1:0\d/.test(h1), h1)
ok('input locked while resting', await p.locator('#ask-pondex-input').isDisabled())
await p.waitForTimeout(3000)
const h2 = await header()
ok('countdown ticks', h1 !== h2, `${h1} -> ${h2}`)
await p.screenshot({ path: `${out}/ui-resting.png` })

// 5. When the countdown ends, the chat asks again and unlocks.
usage = { status: 'busy', inUse: null, questionsLeft: 40, coolUntil: new Date(Date.now() + 2_000).toISOString(), models: MODELS }
await p.getByRole('button', { name: 'Close chat' }).click(); await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(800)
usage = { status: 'backup', inUse: 'openai/gpt-oss-20b', questionsLeft: 40, coolUntil: null, models: MODELS }
await p.waitForTimeout(3500)
ok('unlocks after countdown', !(await p.locator('#ask-pondex-input').isDisabled()) && (await header()).includes('Ready · using the backup AI'), await header())

// 6. Every model out for the day: the time it comes back, in Manila.
usage = { status: 'out', inUse: null, questionsLeft: 0, coolUntil: new Date(Date.now() + 4 * 3600_000).toISOString(), models: MODELS }
await p.getByRole('button', { name: 'Close chat' }).click(); await p.getByRole('button', { name: /Open Ask Pondex/ }).click(); await p.waitForTimeout(1500)
const h3 = await header()
ok('out for today shows the time back', /Used up for today · back at \d{1,2}:\d{2} (AM|PM)/.test(h3), h3)
await p.screenshot({ path: `${out}/ui-out.png` })

await s.browser.close()
for (const [name, pass, d] of res) console.log(pass ? 'PASS' : 'FAIL', name.padEnd(40), pass ? '' : d)
console.log(`\n${res.filter((r) => r[1]).length}/${res.length} passed`)
