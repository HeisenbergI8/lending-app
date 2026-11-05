/**
 * Dex-E's memory of questions the AI translated.
 *
 * When the server cannot read a message, a small AI call translates it into a
 * sentence the server does read (translate.ts). That pairing is kept here as a
 * pattern: the Admin's words with names, dates and amounts as slots, and the
 * server's sentence with the same slots.
 *
 *   "magkano tubo ni maria nung october"  →  "how much did {p1} earn {d1}"
 *   pattern: "magkano tubo ni {p1} nung {d1}"
 *
 * The next message with the same pattern, or one that means the same (the small
 * meaning model, very close only), is filled in with ITS names and dates and
 * answered by the server alone: no AI, no tokens. So Dex-E learns from real use.
 *
 * Nothing is kept unless every name, date and amount in the server's sentence
 * came from a slot, so a remembered sentence can never carry an old name or
 * amount into a new answer.
 */

import { db } from '../db.ts'
import { clean } from '../../lib/command/read.ts'
import { closeness, embed } from './meaning.ts'

type Person = { firstName: string; lastName: string }
export type Slots = { p: string[]; d: string[]; n: string[] }
export type Shape = { pattern: string; slots: Slots }

// "may" is left out: in Tagalog it is "has" far more often than the month.
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DAY = `${MONTH}\\.? \\d{1,2}(?:,? \\d{4})?`
const DATE = new RegExp(
  [
    `from ${DAY} (?:to|until|-) (?:${MONTH}\\.? )?\\d{1,2}(?:,? \\d{4})?`,
    '(?:this|last|next|previous|ngayong|nakaraang|susunod na) (?:whole |entire |full )?(?:week|month|year|linggo|buwan|taon)',
    '(?:the )?(?:whole|entire|full) (?:month|year)',
    'buong buwan',
    'today|yesterday|tomorrow|ngayon|kahapon|bukas|all time',
    `(?:the whole of )?${MONTH}(?:\\.? \\d{1,2})?(?:,? \\d{4})?`,
  ].map((p) => `\\b(?:${p})\\b`).join('|'),
  'g',
)
const AMOUNT = /₱?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|thousand|libo))?\b/g

const fullName = (p: Person) => `${p.firstName} ${p.lastName}`
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where each person is said: the full name, or a first name only one person has. */
function nameSpots(t: string, people: Person[]): { start: number; end: number; value: string }[] {
  const firsts = new Map<string, number>()
  for (const p of people) firsts.set(p.firstName.toLowerCase(), (firsts.get(p.firstName.toLowerCase()) ?? 0) + 1)
  const said = people.flatMap((p) => [
    { words: fullName(p).toLowerCase(), value: fullName(p) },
    ...(firsts.get(p.firstName.toLowerCase()) === 1 ? [{ words: p.firstName.toLowerCase(), value: fullName(p) }] : []),
  ])
  const spots: { start: number; end: number; value: string }[] = []
  for (const s of said.sort((a, b) => b.words.length - a.words.length)) {
    for (const m of t.matchAll(new RegExp(`\\b${escape(s.words)}\\b`, 'g'))) {
      const start = m.index!
      if (!spots.some((x) => start < x.end && start + s.words.length > x.start)) spots.push({ start, end: start + s.words.length, value: s.value })
    }
  }
  return spots
}

/** The message as a pattern: names, dates and amounts as numbered slots, in the order said. */
export function shapeOf(text: string, people: Person[]): Shape {
  const t = clean(text).replace(/[?.!]+$/, '')
  type Spot = { start: number; end: number; kind: 'p' | 'd' | 'n'; value: string }
  const spots: Spot[] = nameSpots(t, people).map((s) => ({ ...s, kind: 'p' }))
  const free = (start: number, end: number) => !spots.some((x) => start < x.end && end > x.start)
  for (const m of t.matchAll(DATE)) if (free(m.index!, m.index! + m[0].length)) spots.push({ start: m.index!, end: m.index! + m[0].length, kind: 'd', value: m[0] })
  for (const m of t.matchAll(AMOUNT)) if (free(m.index!, m.index! + m[0].length)) spots.push({ start: m.index!, end: m.index! + m[0].length, kind: 'n', value: m[0] })
  spots.sort((a, b) => a.start - b.start)
  const slots: Slots = { p: [], d: [], n: [] }
  let pattern = ''
  let at = 0
  for (const s of spots) {
    slots[s.kind].push(s.value)
    pattern += `${t.slice(at, s.start)}{${s.kind}${slots[s.kind].length}}`
    at = s.end
  }
  // "In October", "nung October" and "last month" are the same slot: the small word before a date is dropped.
  const tidy = (pattern + t.slice(at)).replace(/\b(in|for|during|of|on|sa|nung|noong|ngayong)\s+(\{d\d+\})/g, '$2')
  return { pattern: tidy.replace(/\s+/g, ' ').trim(), slots }
}

/**
 * The server's sentence with this message's slots taken out, or null when it
 * says a name, date or amount that is not one of them (then it is not kept).
 */
export function sentenceShape(says: string, slots: Slots, people: Person[]): string | null {
  let s = clean(says).replace(/[?.!]+$/, '')
  const swap = (value: string, slot: string): boolean => {
    const at = s.indexOf(value.toLowerCase())
    if (at < 0) return false
    s = `${s.slice(0, at)}{${slot}}${s.slice(at + value.length)}`
    return true
  }
  for (const [i, name] of slots.p.entries()) {
    const person = people.find((p) => fullName(p) === name)
    if (!swap(name, `p${i + 1}`) && !(person && swap(person.firstName, `p${i + 1}`))) return null
  }
  for (const [i, d] of slots.d.entries()) if (!swap(d, `d${i + 1}`)) return null
  for (const [i, n] of slots.n.entries()) if (!swap(n, `n${i + 1}`)) return null
  // Anything left that names someone, or any number, did not come from this message.
  const rest = s.replace(/\{[pdn]\d+\}/g, ' ')
  // Nor a date: "so far" read as "this whole month" would be remembered wrong for every later message.
  if (/\d/.test(rest) || nameSpots(rest, people).length > 0 || new RegExp(DATE.source).test(rest)) return null
  return s
}

/** A pattern's slots filled from a message's own. */
export function fill(says: string, slots: Slots): string {
  return says.replace(/\{([pdn])(\d+)\}/g, (_, kind: 'p' | 'd' | 'n', i: string) => slots[kind][Number(i) - 1] ?? '')
}

const kinds = (pattern: string) => (pattern.match(/\{[pdn]\d+\}/g) ?? []).sort().join()
/** The pattern in words for the meaning model: slots read as plain words. */
const meaningText = (pattern: string) => pattern.replace(/\{p\d+\}/g, 'someone').replace(/\{d\d+\}/g, 'then').replace(/\{n\d+\}/g, 'some amount')

/** How close a remembered pattern must mean to this one. High: a wrong reuse costs more than one AI call. */
export const SAME_MEANING = 0.93

/** The server's sentence for this message from memory, or null. */
export async function recall(userId: string, text: string, people: Person[]): Promise<{ id: string; says: string } | null> {
  const shape = shapeOf(text, people)
  const exact = await db.assistantMemory.findUnique({ where: { userId_pattern: { userId, pattern: shape.pattern } }, select: { id: true, says: true } })
  if (exact) return { id: exact.id, says: fill(exact.says, shape.slots) }
  const rows = await db.assistantMemory.findMany({ where: { userId }, select: { id: true, pattern: true, says: true, vector: true }, orderBy: { uses: 'desc' }, take: 500 })
  // Only patterns with the same slots: a name or date never goes unfilled or left over.
  const same = rows.filter((r) => kinds(r.pattern) === kinds(shape.pattern) && r.vector.length > 0)
  if (same.length === 0) return null
  const vector = await embed(meaningText(shape.pattern), 3000)
  if (!vector) return null
  let best: (typeof same)[number] | null = null
  let score = 0
  for (const r of same) {
    const c = closeness(vector, r.vector)
    if (c > score) [best, score] = [r, c]
  }
  return best && score >= SAME_MEANING ? { id: best.id, says: fill(best.says, shape.slots) } : null
}

/** Keeps a translation the server answered, so the next one like it needs no AI. */
export async function remember(userId: string, text: string, says: string, people: Person[]): Promise<boolean> {
  const shape = shapeOf(text, people)
  const sentence = sentenceShape(says, shape.slots, people)
  // A message that is all slots ("November") says nothing to remember.
  if (!sentence || shape.pattern.replace(/\{[pdn]\d+\}/g, '').trim().split(/\s+/).length < 2) return false
  const vector = (await embed(meaningText(shape.pattern), 3000)) ?? []
  await db.assistantMemory.upsert({
    where: { userId_pattern: { userId, pattern: shape.pattern } },
    create: { userId, pattern: shape.pattern, says: sentence, vector },
    update: { says: sentence, vector },
  })
  return true
}

export async function used(id: string): Promise<void> {
  await db.assistantMemory.update({ where: { id }, data: { uses: { increment: 1 } } })
}
