import { db } from '../../../src/server/db.ts'
import { parseRefusal, recordCall, recordRefusal, usageSummary } from '../../../src/server/assistant/usage.ts'
const A = 'test/regression-model-a', B = 'test/regression-model-b'
const res: [string, boolean, string][] = []
try {
  for (let i = 0; i < 4; i++) await recordCall(A, 2000, true)
  let u = await usageSummary([A, B])
  res.push(['counts questions from tokens', u.questionsLeft === Math.floor((200000 - 8000 + 200000) / 2000), String(u.questionsLeft)])
  await recordRefusal(A, parseRefusal('tokens per day (TPD): Limit 200000, Used 199900, Requested 900. Please try again in 30m0s.', null))
  u = await usageSummary([A, B])
  res.push(['daily refusal: model A has nothing left', u.models[0].coolUntil !== null && u.questionsLeft === Math.floor(200000 / 2500), String(u.questionsLeft)])
  res.push(['one model still free: no countdown', u.coolUntil === null, String(u.coolUntil)])
  await recordRefusal(B, parseRefusal('tokens per minute (TPM). Please try again in 45s.', '45'))
  u = await usageSummary([A, B])
  const wait = u.coolUntil ? Math.round((u.coolUntil.getTime() - Date.now()) / 1000) : -1
  res.push(['both resting: countdown to the first free one', wait > 40 && wait <= 46, `${wait}s`])
} finally {
  await db.assistantUsage.deleteMany({ where: { model: { in: [A, B] } } })
  await db.$disconnect()
}
for (const [n, p, d] of res) console.log(p ? 'PASS' : 'FAIL', n.padEnd(48), d)
