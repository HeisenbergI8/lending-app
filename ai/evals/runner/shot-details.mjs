// Screenshot of the chat's limits view in a given state (faked server answers). Demo account only.
import { demoSession } from './client.mjs'
const s = await demoSession(); const p = s.page
const h = (n) => new Date(Date.now() + n * 3600_000).toISOString()
const usage = { status: 'backup', inUse: 'qwen/qwen3.8-27b', questionsLeft: 30, coolUntil: null, models: [
  { model: 'openai/gpt-oss-120b', used: 62766, limit: 200000, exact: false, coolUntil: h(3.2), requestsLeft: null, requestLimit: null, minuteTokensLeft: null },
  { model: 'openai/gpt-oss-20b', used: 53124, limit: 200000, exact: false, coolUntil: h(0.2), requestsLeft: null, requestLimit: null, minuteTokensLeft: null },
  { model: 'qwen/qwen3.8-27b', used: 42515, limit: 200000, exact: false, coolUntil: null, requestsLeft: null, requestLimit: null, minuteTokensLeft: null },
] }
await p.route('**/api/assistant', (route) => route.fulfill({ json: usage }))
await p.setViewportSize({ width: 1280, height: 760 })
await p.getByRole('button', { name: /Open Dex-E/ }).click(); await p.waitForTimeout(1500)
await p.getByRole('button', { name: /^Ready/ }).click(); await p.waitForTimeout(600)
await p.locator('section[aria-label="Dex-E"]').screenshot({ path: process.argv[2] })
await s.browser.close()
