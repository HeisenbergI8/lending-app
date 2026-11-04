import { db } from '../../../src/server/db.ts'
import { demoSession } from './client.mjs'
const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true, isDemo: true } }))!
if (!demo.isDemo) throw new Error('SAFETY STOP')
const s = await demoSession(); const p = s.page
let usage: any = { status: 'ready', inUse: 'openai/gpt-oss-120b', questionsLeft: 50, coolUntil: null, models: [] }
await p.route('**/api/assistant', async (route: any) => {
  if (route.request().method() === 'GET') return route.fulfill({ json: usage })
  return route.fulfill({ json: { ok: true, answer: 'Here is the change.', tools: [], model: 'x', tokens: 0, usage,
    proposal: { action: 'create_borrower', title: 'Add a borrower', fields: { firstName: 'Resting', lastName: 'Confirm' }, funders: [], files: null, lines: [{ label: 'First name', value: 'Resting' }] } } })
})
await p.getByRole('button', { name: /Open Dex-E/ }).click(); await p.waitForTimeout(1500)
await p.fill('#ask-pondex-input', 'x'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
// Now every model rests: the input locks, but the card already on screen does not need the AI.
usage = { status: 'out', inUse: null, questionsLeft: 0, coolUntil: new Date(Date.now() + 10 * 60_000).toISOString(), models: [] }
await p.getByRole('button', { name: 'Close chat' }).click(); await p.getByRole('button', { name: /Open Dex-E/ }).click(); await p.waitForTimeout(2000)
const locked = await p.locator('#ask-pondex-input').isDisabled()
await p.getByRole('button', { name: 'Confirm' }).last().click(); await p.waitForTimeout(4000)
const saved = await db.borrower.count({ where: { userId: demo.id, firstName: 'Resting', lastName: 'Confirm' } })
console.log(locked && saved === 1 ? 'PASS' : 'FAIL', 'LIM-08 Confirm works while the AI rests'.padEnd(52), `input locked: ${locked}, saved: ${saved}`)
await s.browser.close(); await db.$disconnect()
