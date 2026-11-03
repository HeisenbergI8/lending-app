import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { db } from '../../../src/server/db.ts'
import { demoSession } from './client.mjs'
import { DEPS, realDates, runSetups } from './setups.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const OUT = process.argv[2]
const PNG = { name: 'proof.png', mimeType: 'image/png', buffer: readFileSync(process.argv[3]) }
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null

const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { isDemo: true } }))
if (!demo?.isDemo) throw new Error('SAFETY STOP: demo user missing or not isDemo')
await db.$disconnect()

type Scenario = { id: string; category: string; turns: string[]; makes_change: boolean; needs_file: boolean; expected: string; pass: string }
const all: Scenario[] = JSON.parse(readFileSync(`${REPO}/ai/evals/chat-scenarios.json`, 'utf8'))
const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : [])

// UI-only scenarios: clicking in the chat window, covered by the UI regression script.
const UI_ONLY = new Set(['CARD-01', 'CARD-02', 'CARD-03', 'CARD-04', 'CARD-05', 'CARD-06', 'CARD-07', 'CARD-08', 'CARD-09', 'LIM-01', 'LIM-02', 'LIM-03', 'LIM-04', 'LIM-06', 'LIM-07', 'LIM-08', 'LIM-09'])
const wantsConfirm = (s: Scenario) => /(after|on|tap|tapping|then) confirm|confirm(ing)? it|once confirmed|when confirmed/i.test(`${s.expected} ${s.pass}`)

const seed = () => execSync('npm run db:seed', { cwd: REPO, stdio: 'pipe', timeout: 180000 })
const queue = all.filter((s) => !done.has(s.id) && (!only || only.has(s.id)))
const reads = queue.filter((s) => !s.makes_change && !DEPS[s.id])
const changes = queue.filter((s) => s.makes_change || DEPS[s.id])

let session = await demoSession()
const record = (row: object) => appendFileSync(OUT, JSON.stringify(row) + '\n')

type Card = { proposal: any; status: string; error?: string | null }
const note = (c: Card) => {
  const what = `I proposed: ${c.proposal.title} (${c.proposal.lines.map((l: any) => `${l.label} ${l.value}`).join(', ')}).`
  return c.status === 'done' ? `${what} The Admin confirmed it and it was saved.`
    : c.status === 'cancelled' ? `${what} The Admin cancelled it; nothing was saved.`
    : c.status === 'failed' ? `${what} It was not saved: ${c.error}` : `${what} Not confirmed yet.`
}

async function runOne(s: Scenario) {
  const started = Date.now()
  const setup = await runSetups(s.id, session.act, PNG)
  const history: { role: 'user' | 'assistant'; text: string }[] = []
  const steps: any[] = []
  let card: Card | null = null
  const confirm = async (why: string) => {
    if (!card) { steps.push({ step: why, note: 'no card to confirm' }); return }
    const p = card.proposal
    const r = await session.act(p.action, p.fields, p.funders, p.files ? PNG : null)
    card.status = r.ok ? 'done' : 'failed'; card.error = r.ok ? null : r.error
    steps.push({ step: why, act: r })
    history[history.length - 1] = { role: 'assistant', text: note(card) }
  }
  for (const raw of s.turns) {
    const turn = raw.trim()
    // Exact setups replace a scenario's own "(setup)" chat turns.
    if (DEPS[s.id] && /^\(setup\)/i.test(turn)) continue
    if (/^\(tap confirm\)$/i.test(turn) || /^\(attach a file, tap confirm/i.test(turn)) { await confirm(turn); continue }
    if (/^\(tap cancel\)$/i.test(turn)) {
      if (card) { card.status = 'cancelled'; history[history.length - 1] = { role: 'assistant', text: note(card) } }
      steps.push({ step: turn }); continue
    }
    const setup = /^\(setup\)\s*/i.test(turn)
    const text = realDates(turn.replace(/^\((setup|do not tap anything)\)\s*/i, ''))
    history.push({ role: 'user', text })
    const t0 = Date.now()
    const r: any = await session.ask(history)
    const reply = { said: text, ok: r.ok, answer: r.answer ?? r.error, tools: r.tools, model: r.model, ms: Date.now() - t0,
      card: r.proposal ? { title: r.proposal.title, lines: r.proposal.lines, file: r.proposal.files } : null }
    steps.push(reply)
    if (r.proposal) {
      // A newer card retires the older one, as in the chat window.
      card = { proposal: r.proposal, status: 'ready' }
      history.push({ role: 'assistant', text: note(card) })
    } else history.push({ role: 'assistant', text: r.ok ? r.answer : r.error })
    if (setup) await confirm('(setup confirm)')
  }
  if (s.makes_change && card && card.status === 'ready' && wantsConfirm(s)) await confirm('(auto confirm: scenario checks the result after Confirm)')
  record({ id: s.id, category: s.category, turns: s.turns, expected: s.expected, pass: s.pass, setup, steps, seconds: Math.round((Date.now() - started) / 1000) })
}

const ordered: [Scenario, boolean][] = [...reads.map((s) => [s, false] as [Scenario, boolean]), ...changes.map((s) => [s, true] as [Scenario, boolean])]
console.log(`to run: ${ordered.length} (${reads.length} reads, ${changes.length} changes)`)
if (reads.length > 0) seed()
let i = 0
for (const [s, isChange] of ordered) {
  i++
  if (UI_ONLY.has(s.id)) { record({ id: s.id, category: s.category, turns: s.turns, expected: s.expected, pass: s.pass, steps: [], skipped: 'UI-only: covered by the chat-window regression script' }); continue }
  try {
    if (isChange) { await session.browser.close(); seed(); session = await demoSession() }
    await runOne(s)
    console.log(`${i}/${ordered.length} ${s.id} done`)
  } catch (e) {
    record({ id: s.id, category: s.category, turns: s.turns, expected: s.expected, pass: s.pass, steps: [], error: String(e).slice(0, 300) })
    console.log(`${i}/${ordered.length} ${s.id} ERROR ${String(e).slice(0, 120)}`)
    try { await session.browser.close() } catch {}
    session = await demoSession()
  }
}
await session.browser.close()
seed()
console.log('ALL DONE')
