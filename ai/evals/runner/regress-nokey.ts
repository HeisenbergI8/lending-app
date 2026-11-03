// LIM-09: no Groq key and no local model. Fails before any network call, with a clear sentence.
delete process.env.GROQ_API_KEY
delete process.env.ASSISTANT_LOCAL_MODEL
const realFetch = globalThis.fetch
let calledOut = false
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { calledOut = true; return realFetch(...args) }) as typeof fetch
const { db } = await import('../../../src/server/db.ts')
const { ask } = await import('../../../src/server/assistant/chat.ts')
const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true } }))!
const r: any = await ask(demo.id, [{ role: 'user', text: 'How much is out on loan?' }])
const pass = !r.ok && /GROQ_API_KEY is missing/.test(r.error) && !calledOut
console.log(pass ? 'PASS' : 'FAIL', 'LIM-09 no key: clear setup message, no call to Groq'.padEnd(52), `${r.error} | network call made: ${calledOut}`)
await db.$disconnect()
