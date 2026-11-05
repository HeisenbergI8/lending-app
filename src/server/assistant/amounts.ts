/**
 * Amounts said as a part of a figure, not as a number: "all the floating of
 * John Ross", "half of what Rico owes", "everything in my pot", "the same as
 * Dan's last loan". The translator never writes such an amount (it never sees
 * the data); it names the lookup, and the server reads the real figure here.
 *
 *   { of: 'floating', who: 'John Ross Rivera', part: 'all' }  →  38358
 *
 * Each lookup is the same figure as the screen that shows it, so a card made
 * from it shows exactly what the Lenders or Borrowers page says.
 */

import { db } from '../db.ts'
import { listLenders } from '../lenders/queries.ts'
import { listBorrowers } from '../borrowers/queries.ts'

export const AMOUNT_OF = ['floating', 'out_on_loan', 'owes', 'overdue', 'last_loan'] as const
export type AmountSpec = { of: (typeof AMOUNT_OF)[number]; who: string; part: number }

/** "all", "half", "a third", 0.25, "25%": the share of the figure, 0 to 1. Null when it is not one. */
export function partOf(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 1
  if (typeof raw === 'number') return raw > 0 && raw <= 1 ? raw : raw > 1 && raw <= 100 ? raw / 100 : null
  const t = String(raw).toLowerCase().trim()
  const words: Record<string, number> = { all: 1, whole: 1, everything: 1, lahat: 1, half: 0.5, kalahati: 0.5, third: 1 / 3, quarter: 0.25 }
  if (t in words) return words[t]
  const pct = /^(\d{1,3}(?:\.\d+)?)\s*%$/.exec(t)
  if (pct) return partOf(Number(pct[1]))
  const n = Number(t)
  return Number.isFinite(n) ? partOf(n) : null
}

/** The translator's amount, checked: a known lookup, a name, and a share. Null for anything else. */
export function readAmountSpec(raw: unknown): AmountSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const of = AMOUNT_OF.find((o) => o === r.of)
  const who = typeof r.who === 'string' ? r.who.trim().slice(0, 80) : ''
  const part = partOf(r.part)
  return of && who && part !== null ? { of, who, part } : null
}

const same = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim()

/** The amount in pesos (two decimals) with what it is, or the reason it could not be read. */
export async function resolveAmount(userId: string, spec: AmountSpec): Promise<{ pesos: number; said: string } | { error: string }> {
  const share = spec.part === 1 ? 'all of' : spec.part === 0.5 ? 'half of' : `${Math.round(spec.part * 100)}% of`
  const pick = (whole: number, what: string) => ({ pesos: Math.round(whole * spec.part) / 100, said: `${share} ${what}` })
  if (spec.of === 'floating' || spec.of === 'out_on_loan') {
    const lenders = await listLenders(userId)
    const mine = /\b(my|admin|me|i)\b/i.test(spec.who)
    const l = lenders.find((x) => (mine ? x.isSelf : same(`${x.firstName} ${x.lastName}`, spec.who) || same(x.firstName, spec.who)))
    if (!l) return { error: `No lender named ${spec.who}.` }
    const name = l.isSelf ? 'your pot' : `${l.firstName} ${l.lastName}`
    const whole = spec.of === 'floating' ? l.position.floating : l.position.outOnLoan
    if (whole <= 0) return { error: `${l.isSelf ? 'Your pot has' : `${name} has`} nothing ${spec.of === 'floating' ? 'floating' : 'out on loan'} right now.` }
    return pick(whole, `${name}'s ${spec.of === 'floating' ? 'floating' : 'money out on loan'}`)
  }
  const { rows } = await listBorrowers(userId, { page: 1, skip: 0, take: 1000 })
  const b = rows.find((x) => same(`${x.firstName} ${x.lastName}`, spec.who) || same(x.firstName, spec.who))
  if (!b) return { error: `No borrower named ${spec.who}.` }
  const name = `${b.firstName} ${b.lastName}`
  if (spec.of === 'last_loan') {
    const last = await db.loan.findFirst({ where: { userId, borrowerId: b.id, deletedAt: null }, orderBy: { startOn: 'desc' }, select: { capitalCentavos: true } })
    if (!last) return { error: `${name} has no loan yet.` }
    return spec.part === 1 ? { pesos: last.capitalCentavos / 100, said: `the same as ${name}'s last loan` } : pick(last.capitalCentavos, `${name}'s last loan`)
  }
  const whole = spec.of === 'owes' ? b.outstanding : b.overdueOutstanding
  if (whole <= 0) return { error: `${name} has nothing ${spec.of === 'owes' ? 'still owed' : 'overdue'}.` }
  return pick(whole, `what ${name} ${spec.of === 'owes' ? 'still owes' : 'has overdue'}`)
}
