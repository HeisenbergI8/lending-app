/**
 * The AI as a translator only. When the server cannot read a message, one
 * small AI call turns it into a sentence the server does read. The AI never
 * sees the data and never writes the answer: the server looks everything up
 * and answers from the same figures as the screens.
 *
 * About 900 tokens a call (the instructions, the account's names, one short
 * reply), against several thousand for the full AI with its tools and data. A
 * small model is enough for it, so it uses its own free allowance, not the main
 * model's. Anything it cannot turn into the app's words goes to the full AI.
 */

import { type AmountSpec, readAmountSpec } from './amounts.ts'
import { manilaToday } from './today.ts'
import { recordCall, recordHeaders, recordRefusal, parseRefusal, readGroqHeaders } from './usage.ts'

export type Translation = {
  kind: 'ask' | 'change' | 'unclear' | 'other'
  say: string
  options: string[]
  understood: string
  /** An amount said as part of a figure ("all of John Ross's floating"): the lookup, read by the server. */
  amount: AmountSpec | null
  model: string
  tokens: number
}

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const LOCAL_ENDPOINT = 'http://localhost:11434/v1/chat/completions'

/** Small, fast models first; ASSISTANT_TRANSLATE_MODELS changes them. On the Mac, the local model when set. */
export function translateModels(): string[] {
  const local = process.env.VERCEL ? null : process.env.ASSISTANT_LOCAL_MODEL?.trim()
  if (local) return [local]
  const list = (process.env.ASSISTANT_TRANSLATE_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean)
  // llama-3.1-8b-instant was the first choice; Groq answers 404 for it now (seen 2026-11-05).
  return list.length > 0 ? list : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']
}

/** The sentences the server reads, one line per kind. <dates> is any of: this month, this whole month, last month, October, Oct 1 to Oct 15, this week, today, all time. */
const APP_WORDS = `how much did <lender> earn <dates> | how much will <lender> earn <dates> | how much did each lender earn <dates> | who earned the most <dates>
how much does <lender> have | how much is floating in each pot | how much is out on loan for <lender> | <lender>'s interest still to collect | <lender>'s starting capital history
lender statement for <lender> <dates> | where is <lender>'s money | who has <lender>'s money | <lender>'s overdue loans | <lender>'s repaid loans | what rate does <lender> earn | where does my cut come from | show my lenders
how much does <borrower> owe | who owes the most | who is overdue | how much did <borrower> pay <dates> | how much did each borrower pay <dates> | how much did <borrower> borrow <dates> | is <borrower> a good borrower
how many borrowers are overdue | how many loans were made <dates> | how many loans did <lender> fund <dates> | how many loans did <borrower> take <dates> | which loans are due <dates> | which of <lender>'s loans are due <dates> (also "to be collected", "on <lender>'s account") | who is due next
<lender>'s deposits <dates> | withdrawals <dates> | what came in <dates> | <lender>'s lent out history | how much did we lend <dates> | how much was collected <dates>
how much is my cut <dates> | compare how much <person> earned <dates> and <dates> | compare <person> and <person> <figure> <dates> | <figure> this month vs last month | <figure> for the last 3 months by month | did we lend more <dates> than <dates>
 how much will be floating by <date> | what is in recently deleted | any pending requests | which pending requests can <lender> and <lender> fund (also "suitable borrowers to lend")
Changes: lend <borrower> <amount> from <lender> for <n> weeks | lend <borrower> all of <lender>'s floating for <n> weeks | <borrower> wants to borrow <amount> for <n> weeks | fund <borrower>'s request from <lender> | <borrower> fully paid | <borrower> paid week <n> | undo <borrower>'s payment | deposit <amount> to <lender>'s pot | withdraw <amount> from <lender>'s pot | extend <borrower>'s loan by <n> weeks | add a note to <borrower>'s loan: <text> | rename <person> to <new name> | label <borrower> good / okay / bad | delete <thing> | restore <thing> | set <lender>'s starting capital to <amount> | add borrower <name> | add lender <name>`

function instructions(lenders: string[], borrowers: string[]): string {
  return `You turn the Admin's message to Pondex, a private lending tracker, into ONE sentence in the app's words below. Never answer it. Reply with JSON only:
{"kind":"ask|change|unclear|other","say":"","options":[],"understood":""}
- ask: a question about figures or lists. change: add, edit, pay, delete or restore something (the app shows a card to confirm). unclear: two or three readings fit; put each as a full sentence in options. other: why, advice, comparing people, chat, or not about Pondex.
- say: one line of the app's words. Full names from the lists. Copy the Admin's date and amount words exactly ("this month" stays "this month", "so far" stays "so far", "Oct 1 to Oct 15", "5k"); say "this whole month" only when the Admin says whole, entire, potential or will. Never add an amount, date or name the Admin did not say.
- understood: under 8 words, like "Interest earned · John Ross Santos · this whole month".
- An amount given as part of a figure ("all the floating of X", "everything in my pot", "half of what Rico owes", "same as Dan's last loan"): write {amount} in say and add "amount":{"of":"floating|out_on_loan|owes|overdue|last_loan","who":"<full name or my pot>","part":"all|half|<0 to 1>"}. Example: "lend rico half of maria's floating 2 weeks" → {"kind":"change","say":"lend Rico Mendoza {amount} from Maria Cruz for 2 weeks","amount":{"of":"floating","who":"Maria Cruz","part":"half"},"understood":"New loan · Rico · half of Maria's floating"}
Today: ${manilaToday()}. The Admin's own pot is "my pot".
Lenders: ${lenders.join(', ') || 'none'}
Borrowers: ${borrowers.join(', ') || 'none'}
The app's words:
${APP_WORDS}`
}

function options(model: string): Record<string, unknown> {
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low' }
  if (model.startsWith('qwen/')) return { reasoning_format: 'hidden' }
  return {}
}

/** The reply as a Translation, or null when it is not one. */
export function readTranslation(raw: string): Omit<Translation, 'model' | 'tokens'> | null {
  try {
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, unknown>
    const kind = json.kind
    if (kind !== 'ask' && kind !== 'change' && kind !== 'unclear' && kind !== 'other') return null
    const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : '')
    const say = text(json.say)
    const opts = Array.isArray(json.options) ? json.options.map(text).filter(Boolean).slice(0, 3) : []
    if ((kind === 'ask' || kind === 'change') && !say) return null
    // {amount} without a readable lookup is a sentence the server cannot use: not a translation.
    const amount = readAmountSpec(json.amount)
    if (say.includes('{amount}') && !amount) return null
    return { kind, say, options: opts, understood: text(json.understood).slice(0, 80), amount }
  } catch {
    return null
  }
}

/**
 * The latest message in the app's words, with the turn before it for context.
 * Null when no translator model is free or the reply was not usable: the full AI takes over.
 */
export async function translate(history: { role: 'user' | 'assistant'; text: string }[], lenders: string[], borrowers: string[]): Promise<Translation | null> {
  const recent = history.slice(-3).map((t) => ({ role: t.role, content: t.text.slice(0, t.role === 'user' ? 400 : 200) }))
  const messages = [{ role: 'system', content: instructions(lenders, borrowers) }, ...recent]
  const key = process.env.GROQ_API_KEY
  for (const model of translateModels()) {
    const local = model === process.env.ASSISTANT_LOCAL_MODEL?.trim() && !process.env.VERCEL
    if (!local && !key) return null
    try {
      const response = await fetch(local ? LOCAL_ENDPOINT : ENDPOINT, {
        method: 'POST',
        headers: local ? { 'Content-Type': 'application/json' } : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0, max_completion_tokens: 300, response_format: { type: 'json_object' }, ...options(model) }),
      })
      if (response.status === 429) {
        await recordRefusal(model, parseRefusal(await response.text(), response.headers.get('retry-after')))
        continue
      }
      if (!response.ok) {
        const why = await response.text()
        // Seen 2026-11-05: a 400 when the model's JSON was not quite valid. Groq sends what it wrote as
        // failed_generation; read that instead of spending a second model's allowance on the same message.
        const wrote = /"failed_generation"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(why)
        const salvaged = wrote ? readTranslation(JSON.parse(wrote[1]) as string) : null
        console.warn('[dex-e translate] model refused', { model, status: response.status, why: why.slice(0, 160), salvaged: !!salvaged })
        if (salvaged) return { ...salvaged, model, tokens: 0 }
        continue
      }
      if (!local) await recordHeaders(model, readGroqHeaders((name) => response.headers.get(name)))
      const data = (await response.json()) as { choices: { message: { content: string | null } }[]; usage?: { total_tokens?: number } }
      const tokens = data.usage?.total_tokens ?? 0
      if (!local) await recordCall(model, tokens, true)
      const read = readTranslation(data.choices[0]?.message.content ?? '')
      console.info('[dex-e translate]', { model, tokens, kind: read?.kind ?? 'unreadable' })
      if (read) return { ...read, model, tokens }
    } catch (error) {
      console.warn('[dex-e translate] failed', { model, error: String(error).slice(0, 200) })
    }
  }
  return null
}
