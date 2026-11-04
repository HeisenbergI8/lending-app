/**
 * Reading the details out of what the Admin typed, with rules (no AI):
 * amounts, dates, lengths, week numbers, rates, labels, and the "which loan /
 * which entry / which note" references that a follow-up button adds.
 *
 * Tolerant on purpose: "10k", "₱10,000", "10 thousand" and "10 libo" are the
 * same amount; "today", "ngayon" and "2026-11-04" the same day; "3 weeks",
 * "3 wks" and "3 linggo" the same length. What it cannot read it leaves out,
 * and the server asks for it, so nothing is ever guessed onto a card.
 *
 * Pure: every rule here is tested without a database.
 */

import { amountsSaid } from '../../server/assistant/names.ts'

/** "2026-11-04". */
export type Day = string

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = `(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, isang: 1, isa: 1, two: 2, dalawang: 2, three: 3, tatlong: 3, four: 4, apat: 4, five: 5, limang: 5, six: 6, anim: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const asDate = (day: Day) => new Date(`${day}T00:00:00Z`)
export const addDays = (day: Day, n: number): Day => iso(new Date(asDate(day).getTime() + n * 86_400_000))

/** Lower case, curly quotes made plain, spaces tidied. */
export function clean(text: string): string {
  return text.toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
}

/**
 * After a day number: not more digits, and not a count of something. "Jun 30" is a date,
 * but "from Jun 1 week" is the lender Jun and one week, and "kay Jun 2k" is Jun and ₱2,000.
 */
const DAY_END = '(?!\\d|[.,]\\d)(?!\\s*-?\\s*(?:k|thousand|libo|weeks?|wks?|weaks?|linggo|days?|araw|months?|buwan)\\b)'
/** The references a follow-up button adds; their dates say which record, not when something happened. */
const REFS = /\(the [^)]*\)/g

/** A date written in a reference ("from October 18, 2026") or by itself. */
const DATE_TEXT = new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?${DAY_END}(?:,?\\s+\\d{4})?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?\\b`, 'g')

/** One written date as a day, or null. A month-day with no year is this year (daySaid moves a long-past start to next year). */
export function readDate(text: string, today: Day): Day | null {
  const t = clean(text)
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  const year = Number(today.slice(0, 4))
  const md = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${DAY_END}(?:,?\\s+(\\d{4}))?\\b`).exec(t)
  if (md) {
    const month = MONTHS.indexOf(md[1].slice(0, 3)) + 1
    return `${md[3] ?? year}-${pad(month)}-${pad(Number(md[2]))}`
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t)
  if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : year
    return `${y}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`
  }
  return null
}

/**
 * The day something happened or starts, from the Admin's words. "past" (a
 * payment, money in or out) reads a weekday as the latest one up to today;
 * "future" (a loan starting) as the next one from today. Null when no day is said.
 */
export function daySaid(text: string, today: Day, when: 'past' | 'future'): Day | null {
  const t = clean(text).replace(REFS, ' ')
  if (/\b(today|ngayon|now|kanina)\b/.test(t)) return today
  if (/\b(yesterday|kahapon)\b/.test(t)) return addDays(today, -1)
  if (/\b(tomorrow|bukas)\b/.test(t)) return addDays(today, 1)
  const written = readDate(t.replace(/\b(due|until|hanggang|by|ending|ends?)\s+\S+(\s+\d{1,2}(st|nd|rd|th)?)?(,?\s+\d{4})?/g, ' '), today)
  // A start with no year that is long past ("starting Jun 30" in November) means next year.
  if (written && when === 'future' && !/\b\d{4}\b/.test(t) && written < addDays(today, -60)) return `${Number(written.slice(0, 4)) + 1}${written.slice(4)}`
  if (written) return written
  const wd = /\b(?:last|this|next|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t)
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1])
    const now = asDate(today).getUTCDay()
    const back = (now - target + 7) % 7
    const ahead = (target - now + 7) % 7
    return when === 'past' ? addDays(today, -back) : addDays(today, ahead)
  }
  return null
}

/** How long a loan runs: weeks, days, or a due date. A month is not a fixed length here, so it is left for the Admin to say in weeks. */
export function lengthSaid(text: string, today: Day): { weeks?: number; days?: number; dueOn?: Day; months?: number } | null {
  const t = clean(text).replace(REFS, ' ')
  if (/\b(another|extra|isa pang)\s+(week|linggo)\b/.test(t)) return { weeks: 1 }
  const count = (word: string) => (/^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? NaN))
  const weeks = /\b(\d+|a|an|one|isang|isa|two|dalawang|three|tatlong|four|apat|five|limang|six|anim|seven|eight|nine|ten|twelve)\s*-?\s*(?:more\s+|extra\s+|pang\s+)?(weeks?|wks?|weaks?|linggo)\b/.exec(t)
  if (weeks && count(weeks[1]) > 0) return { weeks: count(weeks[1]) }
  const days = /\b(\d+|a|one|two|three|four|five|six|seven|ten)\s*-?\s*(days?|araw)\b/.exec(t)
  if (days && count(days[1]) > 0) return { days: count(days[1]) }
  const due = /\b(?:due|until|hanggang|by|ending|ends?)\s+(?:on\s+)?(.{3,25})/.exec(t)
  if (due) {
    const day = readDate(due[1], today) ?? daySaid(due[1], today, 'future')
    if (day) return { dueOn: day }
  }
  const months = /\b(\d+|a|one|two|three)\s*(months?|buwan)\b/.exec(t)
  if (months) return { months: count(months[1]) }
  return null
}

/** "week 2", "2nd week", "week two", "ika-2 linggo". */
export function weekNumberSaid(text: string): number | null {
  const t = clean(text)
  const m = /\bweek\s*#?\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+week\b|\bika-?\s*(\d+)\s*(?:na\s+)?linggo\b|\bweek\s+(one|two|three|four|five|six)\b/.exec(t)
  if (!m) return null
  return m[4] ? NUMBER_WORDS[m[4]] : Number(m[1] ?? m[2] ?? m[3])
}

/** "8%", "8 percent", "8% a week". */
export function rateSaid(text: string): number | null {
  const m = /\b(\d+(?:\.\d+)?)\s*(%|percent|porsyento)/.exec(clean(text))
  return m ? Number(m[1]) : null
}

/** Good, Okay or Bad, or '' to clear, or null when no label is said. */
export function labelSaid(text: string): 'GOOD' | 'OKAY' | 'BAD' | '' | null {
  const t = clean(text)
  if (/\b(clear|remove|unset|no)\b.*\blabel\b|\bunlabel\b/.test(t)) return ''
  if (/\b(bad|masama|pangit|delikado)\b/.test(t)) return 'BAD'
  if (/\b(okay|ok|okey|average|so-so|pwede na)\b/.test(t)) return 'OKAY'
  if (/\b(good|mabuti|maayos|reliable|great|trustworthy|trusted|mapagkakatiwalaan)\b/.test(t)) return 'GOOD'
  return null
}

/**
 * Parts of the text that are not the amount of the change: references a
 * follow-up button added ("the ₱8,000.00 loan from October 18, 2026"), dates,
 * lengths, week numbers and rates. Masked before reading amounts, so a date's
 * "18" or a reference's "₱8,000.00" is never read as how much.
 */
function withoutNonAmounts(text: string): string {
  return clean(text)
    .replace(/\(?\s*the\s+[^()]*?\b(loan|entry|note|request)\b[^()]*\)?/g, ' ')
    .replace(DATE_TEXT, ' ')
    .replace(/\b\d+\s*-?\s*(weeks?|wks?|weaks?|linggo|days?|araw|months?|buwan)\b/g, ' ')
    .replace(/\bweek\s*#?\s*\d+\b|\b\d+(st|nd|rd|th)\s+week\b|\bika-?\s*\d+/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(%|percent|porsyento)/g, ' ')
}

/**
 * Peso amounts the Admin said, in order. "10k", "₱10,000.00", "10,000",
 * "10 thousand", "10 libo". A bare small number ("2") is not an amount; it is
 * usually a week or a count, so it is left out rather than guessed.
 */
export function amountsIn(text: string): number[] {
  const masked = withoutNonAmounts(text).replace(/₱|\bphp\b|\bp(?=\d)/g, ' ')
  const out: number[] = []
  for (const m of masked.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand\b|libo\b)?/g)) {
    const value = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)
    if (Number.isFinite(value) && (m[2] || value >= 100 || m[1].includes(','))) out.push(value)
  }
  // "twenty thousand" and the like, read the same way the card check reads them.
  for (const v of amountsSaid(masked.replace(/\d[\d,]*(\.\d+)?\s*(k|thousand|libo)?/g, ' '))) if (v >= 100) out.push(v)
  return out
}

/** "₱10,000.00" for a card or a question. */
export function pesos(value: number): string {
  return `₱${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** References a follow-up button puts in the text, read back exactly. */
export function loanRef(text: string): { capital: number; start: string } | null {
  const m = /the\s+₱([\d,]+(?:\.\d+)?)\s+loan\s+from\s+([a-z]+\s+\d{1,2},\s+\d{4})/i.exec(text)
  return m ? { capital: Number(m[1].replace(/,/g, '')), start: m[2] } : null
}
export function entryRef(text: string): { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; date: string } | null {
  const m = /the\s+(deposit|withdrawal)\s+of\s+₱([\d,]+(?:\.\d+)?)\s+on\s+([a-z]+\s+\d{1,2},\s+\d{4})/i.exec(text)
  return m ? { type: m[1].toUpperCase() as 'DEPOSIT' | 'WITHDRAWAL', amount: Number(m[2].replace(/,/g, '')), date: m[3] } : null
}
export function noteRef(text: string): string | null {
  return /the\s+note\s+"([^"]+)"/i.exec(text)?.[1] ?? null
}
export function requestRef(text: string): { capital: number } | null {
  const m = /the\s+₱([\d,]+(?:\.\d+)?)\s+request\b/i.exec(text)
  return m ? { capital: Number(m[1].replace(/,/g, '')) } : null
}

/** A note's words: after a colon, in quotes, or after "that" / "saying". */
export function noteBodySaid(text: string): string | null {
  const t = text.trim()
  const quoted = /"([^"]{2,})"|'([^']{2,})'/.exec(t.replace(/the\s+note\s+"[^"]+"/i, ''))
  if (quoted) return (quoted[1] ?? quoted[2]).trim()
  const colon = /:\s*(.{2,})$/.exec(t)
  if (colon) return colon[1].trim()
  const remember = /^(?:remember|tandaan)(?:\s+that)?\s+(.{2,})$/i.exec(t)
  if (remember) return remember[1].trim()
  const that = /\b(?:that|saying|says)\s+(.{2,})$/i.exec(t)
  return that ? that[1].trim() : null
}

/** A new person's name: the capitalised words after "borrower", "lender", "named" or "to". */
export function newNameSaid(text: string, after: RegExp): { firstName: string; lastName: string } | null {
  const m = after.exec(text)
  if (!m) return null
  const words = text.slice(m.index + m[0].length).trim().replace(/[.,!?]+$/, '').split(/\s+/).filter(Boolean)
  if (words.length < 2) return null
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
  // Filipino surnames often start with a particle: "Juan Dela Cruz" is Juan + Dela Cruz, "Ana De los Santos" is Ana + De los Santos.
  let split = words.length - 1
  while (split > 1 && /^(dela|de|del|delos|los|las|la|san|santa|sta|dos|da|di|van|von|mac|mc)$/i.test(words[split - 1])) split--
  return { firstName: words.slice(0, split).map(cap).join(' '), lastName: words.slice(split).map(cap).join(' ') }
}

/** Whether the words say each lender gives the same share. */
export const SPLIT_EVENLY = /\b(each|half|halves|evenly|equally|hati|tig-?\w*|same amount)\b/

/**
 * A stretch of time in the Admin's words, for questions like "how much did John
 * Ross earn this month": today, yesterday, this or last week (Monday to Sunday),
 * this or last month, a month by name ("October", "Oct 2026"), this or last year,
 * or "from Oct 1 to Oct 15". Null when no period is said.
 * "This month" ends today (so far); "next week" and "next month" look ahead, for what is coming due.
 */
export function periodSaid(text: string, today: Day): { from: Day; to: Day; label: string } | null {
  const t = clean(text).replace(REFS, ' ')
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const cap = (d: Day) => (d > today ? today : d)
  const monthEnd = (year: number, month: number) => iso(new Date(Date.UTC(year, month, 0)))
  const monthName = (month: number) => new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const span = /\b(?:from|between)\s+(.+?)\s+(?:to|until|and|-)\s+(.+)$/.exec(t)
  if (span) {
    const a = readDate(span[1], today)
    const b = readDate(span[2], today)
    if (a && b) return a <= b ? { from: a, to: b, label: 'that time' } : { from: b, to: a, label: 'that time' }
  }
  if (/\b(today|ngayon)\b/.test(t)) return { from: today, to: today, label: 'today' }
  if (/\b(yesterday|kahapon)\b/.test(t)) return { from: addDays(today, -1), to: addDays(today, -1), label: 'yesterday' }
  const monday = addDays(today, -((asDate(today).getUTCDay() + 6) % 7))
  if (/\b(this week|ngayong linggo)\b/.test(t)) return { from: monday, to: today, label: 'this week' }
  if (/\b(last week|nakaraang linggo)\b/.test(t)) return { from: addDays(monday, -7), to: addDays(monday, -1), label: 'last week' }
  if (/\b(next week|susunod na linggo)\b/.test(t)) return { from: addDays(monday, 7), to: addDays(monday, 13), label: 'next week' }
  if (/\b(next month|susunod na buwan)\b/.test(t)) {
    const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1]
    return { from: `${ny}-${pad(nm)}-01`, to: monthEnd(ny, nm), label: `${monthName(nm)} ${ny}` }
  }
  if (/\b(this month|ngayong buwan|so far this month|month alone|the month)\b/.test(t)) return { from: `${today.slice(0, 7)}-01`, to: today, label: 'this month' }
  if (/\b(last month|nakaraang buwan|previous month)\b/.test(t)) {
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1]
    return { from: `${py}-${pad(pm)}-01`, to: monthEnd(py, pm), label: `${monthName(pm)} ${py}` }
  }
  if (/\b(this year|ngayong taon)\b/.test(t)) return { from: `${y}-01-01`, to: today, label: `${y} so far` }
  if (/\b(last year)\b/.test(t)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` }
  // A month by name, with no day after it: "in October", "for Oct 2026". A later month with no year is last year's.
  const named = new RegExp(`\\b${MONTH}\\b(?!\\.?\\s*\\d{1,2}\\b(?!\\d{2}))(?:\\s+(\\d{4}))?`).exec(t)
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3)) + 1
    const year = named[2] ? Number(named[2]) : month > m ? y - 1 : y
    return { from: `${year}-${pad(month)}-01`, to: cap(monthEnd(year, month)), label: `${monthName(month)} ${year}` }
  }
  return null
}
