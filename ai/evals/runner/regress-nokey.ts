// LIM-09: no Groq key and no local model. Fails before any network call, with a clear sentence.
delete process.env.GROQ_API_KEY
delete process.env.ASSISTANT_LOCAL_MODEL
const realFetch = globalThis.fetch
let calledOut = false
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { calledOut = true; return realFetch(...args) }) as typeof fetch
const { db } = await import('../../../src/server/db.ts')
const { ask } = await import('../../../src/server/assistant/chat.ts')
const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true } }))!
// A question only the AI can answer (out on loan, and what one person owes, are answered by the server now).
const r: any = await ask(demo.id, [{ role: 'user', text: 'Why does Dan have a Bad label?' }])
const pass = !r.ok && /GROQ_API_KEY is missing/.test(r.error) && !calledOut
console.log(pass ? 'PASS' : 'FAIL', 'LIM-09 no key: clear setup message, no call to Groq'.padEnd(52), `${r.error} | network call made: ${calledOut}`)
// The instant answers need no AI, so they still work with no key at all.
const quick: any = await ask(demo.id, [{ role: 'user', text: 'How much is out on loan?' }])
const quickPass = quick.ok && quick.quick === true && /out on loan/.test(quick.answer) && !calledOut
console.log(quickPass ? 'PASS' : 'FAIL', 'LIM-09 no key: instant answers still work'.padEnd(52), quick.answer ?? quick.error)
// And server-made cards: a common change still gets its card with no AI at all.
const made: any = await ask(demo.id, [{ role: 'user', text: 'Maria deposited 5000 today' }])
const madePass = made.ok && made.proposal?.action === 'record_money' && !calledOut
console.log(madePass ? 'PASS' : 'FAIL', 'LIM-09 no key: server-made cards still work'.padEnd(52), made.proposal?.title ?? made.error)
await db.$disconnect()
