// Gets the demo account ready for one scenario so its chat turns can run somewhere else
// (the testing link, on Groq). Resets the demo data, runs the scenario's exact setup steps
// through the local app, and prints the scenario with real dates. Demo account only.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { db } from '../../../src/server/db.ts'
import { demoSession } from './client.mjs'
import { DEPS, realDates, runSetups } from './setups.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const id = process.argv[2]
const PNG = { name: 'proof.png', mimeType: 'image/png', buffer: readFileSync(`${REPO}/ai/evals/runner/proof.png`) }

const demo = await db.user.findFirst({ where: { username: 'demo' }, select: { isDemo: true } })
if (!demo?.isDemo) throw new Error('SAFETY STOP: demo user missing or not isDemo')

type Scenario = { id: string; category: string; turns: string[]; makes_change: boolean; expected: string; pass: string }
const all: Scenario[] = JSON.parse(readFileSync(`${REPO}/ai/evals/chat-scenarios.json`, 'utf8'))
const s = all.find((x) => x.id === id)
if (!s) throw new Error(`no scenario ${id}`)

execSync('npm run db:seed', { cwd: REPO, stdio: 'pipe', timeout: 180000 })
let setup: string[] = []
if (DEPS[s.id]) {
  const session = await demoSession()
  try { setup = await runSetups(s.id, session.act, PNG) } finally { await session.browser.close() }
}
await db.$disconnect()

// Exact setups replace the scenario's own "(setup)" chat turns.
const turns = s.turns.map((t) => t.trim()).filter((t) => !(DEPS[s.id] && /^\(setup\)/i.test(t))).map((t) => realDates(t))
const wantsConfirm = s.makes_change && /(after|on|tap|tapping|then) confirm|confirm(ing)? it|once confirmed|when confirmed/i.test(`${s.expected} ${s.pass}`)
console.log(JSON.stringify({ id: s.id, category: s.category, turns, wantsConfirm, setup, expected: s.expected, pass: s.pass }))
process.exit(0)
