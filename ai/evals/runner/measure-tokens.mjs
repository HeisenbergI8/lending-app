// Tokens per question for a fixed set of questions, through the real chat on the demo account.
// Run against the local model to compare code versions without spending Groq's allowance.
import { demoSession } from './client.mjs'
const QUESTIONS = [
  'How much is out on loan right now?',
  'Who is overdue right now?',
  'is dan bad?',
  'how much does Angel owe?',
  'lend Rico 10k from Maria for 3 weeks starting today',
  'mark Lyn as good',
]
const s = await demoSession()
let total = 0
for (const q of QUESTIONS) {
  const r = await s.ask([{ role: 'user', text: q }])
  total += r.tokens ?? 0
  console.log(String(r.tokens ?? 'n/a').padStart(6), (r.tools ?? []).join(',').padEnd(40), q)
}
console.log(String(total).padStart(6), 'TOTAL')
await s.browser.close()
