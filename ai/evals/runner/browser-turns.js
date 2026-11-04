// Runs one prepared scenario's chat turns inside a signed-in browser tab (the testing link, on
// Groq). Paste into the page, then: await runTurns(prepared), where prepared comes from
// prep-scenario.ts. Same history and card handling as run-scenarios.ts. Demo account only.
window.runTurns = async function runTurns(s) {
  const isDemo = async () => (await (await fetch('/', { cache: 'no-store' })).text()).includes('Demo data')
  if (!(await isDemo())) throw new Error('SAFETY STOP: not signed in as the demo account')
  const png = () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0))
    return new File([bytes], 'proof.png', { type: 'image/png' })
  }
  const note = (c) => {
    const what = `I proposed: ${c.proposal.title} (${c.proposal.lines.map((l) => `${l.label} ${l.value}`).join(', ')}).`
    return c.status === 'done' ? `${what} The Admin confirmed it and it was saved.`
      : c.status === 'cancelled' ? `${what} The Admin cancelled it; nothing was saved.`
      : c.status === 'failed' ? `${what} It was not saved: ${c.error}` : `${what} Not confirmed yet.`
  }
  const history = []
  const steps = []
  let card = null
  const confirm = async (why) => {
    if (!card) { steps.push({ step: why, note: 'no card to confirm' }); return }
    if (!(await isDemo())) throw new Error('SAFETY STOP: lost demo session')
    const p = card.proposal
    const body = new FormData()
    body.set('action', p.action)
    body.set('fields', JSON.stringify(p.fields))
    body.set('funders', JSON.stringify(p.funders))
    if (p.files) body.append('proof', png())
    const r = await (await fetch('/api/assistant/act', { method: 'POST', body })).json()
    card.status = r.ok ? 'done' : 'failed'; card.error = r.ok ? null : r.error
    steps.push({ step: why, act: r })
    history[history.length - 1] = { role: 'assistant', text: note(card) }
  }
  for (const turn of s.turns) {
    if (/^\(tap confirm\)$/i.test(turn) || /^\(attach a file, tap confirm/i.test(turn)) { await confirm(turn); continue }
    if (/^\(tap cancel\)$/i.test(turn)) {
      if (card) { card.status = 'cancelled'; history[history.length - 1] = { role: 'assistant', text: note(card) } }
      steps.push({ step: turn }); continue
    }
    const setup = /^\(setup\)\s*/i.test(turn)
    const text = turn.replace(/^\((setup|do not tap anything)\)\s*/i, '')
    history.push({ role: 'user', text })
    const t0 = Date.now()
    const r = await (await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history }) })).json()
    steps.push({ said: text, ok: r.ok, answer: r.answer ?? r.error, tools: r.tools, model: r.model, ms: Date.now() - t0,
      card: r.proposal ? { title: r.proposal.title, lines: r.proposal.lines, file: r.proposal.files } : null })
    if (r.proposal) { card = { proposal: r.proposal, status: 'ready' }; history.push({ role: 'assistant', text: note(card) }) }
    else history.push({ role: 'assistant', text: r.ok ? r.answer : r.error })
    if (setup) await confirm('(setup confirm)')
  }
  if (s.wantsConfirm && card && card.status === 'ready') await confirm('(auto confirm: scenario checks the result after Confirm)')
  return { id: s.id, category: s.category, turns: s.turns, expected: s.expected, pass: s.pass, setup: s.setup, steps }
}
'ready'
