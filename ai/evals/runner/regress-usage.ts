import { db } from '../../../src/server/db.ts'
import { parseRefusal, readGroqHeaders, recordCall, recordHeaders, recordRefusal, usageSummary } from '../../../src/server/assistant/usage.ts'
import { DEFAULT_TOKENS_PER_QUESTION, statusLine } from '../../../src/lib/assistant-status.ts'
const A = 'test/regression-model-a', B = 'test/regression-model-b'
const res: [string, boolean, string][] = []
try {
  for (let i = 0; i < 4; i++) await recordCall(A, 2000, true)
  let u = await usageSummary([A, B])
  res.push(['counts questions from tokens', u.questionsLeft === Math.floor((200000 - 8000 + 200000) / 2000), String(u.questionsLeft)])
  res.push(['main model free: ready', u.status === 'ready' && u.inUse === A, statusLine(u, Date.now())])
  const groq: Record<string, string> = { 'x-ratelimit-remaining-requests': '996', 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-tokens': '5100', 'x-ratelimit-reset-tokens': '20s' }
  await recordHeaders(A, readGroqHeaders((n) => groq[n] ?? null))
  u = await usageSummary([A, B])
  res.push(["Groq's own figures are stored and shown", u.models[0].requestsLeft === 996 && u.models[0].minuteTokensLeft === 5100, `${u.models[0].requestsLeft} req, ${u.models[0].minuteTokensLeft} tok/min`])
  await recordRefusal(A, parseRefusal('tokens per day (TPD): Limit 200000, Used 199900, Requested 900. Please try again in 30m0s.', null))
  u = await usageSummary([A, B])
  res.push(['daily refusal: model A has nothing left', u.models[0].coolUntil !== null && u.questionsLeft === Math.floor(200000 / DEFAULT_TOKENS_PER_QUESTION), String(u.questionsLeft)])
  res.push(['daily refusal: exact figure, backup in use', u.models[0].exact && u.status === 'backup' && u.inUse === B, statusLine(u, Date.now())])
  res.push(['one model still free: no countdown', u.coolUntil === null, String(u.coolUntil)])
  await recordRefusal(B, parseRefusal('tokens per minute (TPM). Please try again in 45s.', '45'))
  u = await usageSummary([A, B])
  const wait = u.coolUntil ? Math.round((u.coolUntil.getTime() - Date.now()) / 1000) : -1
  res.push(['both resting: countdown to the first free one', wait > 40 && wait <= 46, `${wait}s`])
  res.push(['one only resting a minute: busy, not out', u.status === 'busy', statusLine(u, Date.now())])
} finally {
  await db.assistantUsage.deleteMany({ where: { model: { in: [A, B] } } })
  await db.$disconnect()
}
for (const [n, p, d] of res) console.log(p ? 'PASS' : 'FAIL', n.padEnd(48), d)
