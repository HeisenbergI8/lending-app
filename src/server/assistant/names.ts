/**
 * "Did you mean": the people whose names are close to what was typed.
 *
 * The lookups match exactly (every typed word must appear in the name), which
 * is right for answering questions but wrong for a typo: "Ricco Mendosa" finds
 * nobody, and the chat would then offer to add a brand new borrower, a
 * duplicate of Rico Mendoza. So when the exact match finds nobody, these are
 * the names to ask about instead, and a "new" person who looks like an
 * existing one is flagged on the Confirm card.
 *
 * Plain edit distance over each typed word against each part of the name. No
 * phonetics, no AI: it has to be predictable, and it has to be testable.
 */

export type Named = { id: string; firstName: string; lastName: string }

/** Letters only, lower case, accents dropped. */
function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
}

/**
 * Edits to turn one word into the other. Two swapped letters count as one
 * edit ("Angle" for "Angel"), the most common typo on a phone keyboard.
 */
export function distance(a: string, b: string): number {
  if (a === b) return 0
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** How close one typed word is to a name part: 1 is the same, 0 is nothing alike. */
function wordScore(typed: string, part: string): number {
  if (part.startsWith(typed) && typed.length >= 2) return 0.95
  const longest = Math.max(typed.length, part.length)
  return longest === 0 ? 0 : 1 - distance(typed, part) / longest
}

/** How well the typed words match a person, averaged over the words typed. */
export function nameScore(typed: string, person: Named): number {
  const words = norm(typed).split(/\s+/).filter((w) => w.length > 0)
  const parts = norm(`${person.firstName} ${person.lastName}`).split(/\s+/).filter(Boolean)
  if (words.length === 0 || parts.length === 0) return 0
  const total = words.reduce((sum, word) => sum + Math.max(...parts.map((part) => wordScore(word, part))), 0)
  return total / words.length
}

/** Close enough to ask "did you mean": about one wrong letter in five. */
export const SIMILAR = 0.75

/** The few people closest to what was typed, best first, above the threshold. */
export function closestNames<T extends Named>(typed: string, people: T[], limit = 3): T[] {
  return people
    .map((person) => ({ person, score: nameScore(typed, person) }))
    .filter((x) => x.score >= SIMILAR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.person)
}

const SMALL: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

/**
 * Every peso amount in what the Admin typed: "20k", "20,000", "₱20000.50",
 * "twenty thousand", "15 thousand". Used to check that an amount on a card is
 * one the Admin actually said, not one the model filled in.
 */
export function amountsSaid(text: string): number[] {
  const found: number[] = []
  for (const m of text.toLowerCase().matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand|libo)?/g)) {
    const value = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(value)) found.push(m[2] ? value * 1000 : value)
  }
  // Only number words may sit before "thousand": "lend bea twenty thousand" is 20,000, not "bea twenty".
  const word = Object.keys(SMALL).join('|')
  for (const m of text.toLowerCase().matchAll(new RegExp(`\\b(?:(${word})[\\s-])?(${word})\\s+thousand\\b`, 'g'))) {
    found.push([m[1], m[2]].filter(Boolean).reduce((sum, w) => sum + SMALL[w as string], 0) * 1000)
  }
  return found
}

/** Whether the Admin's words name this person: first or last name, allowing one typo in longer names (see wordNames). */
export function nameSaid(text: string, person: { firstName: string; lastName: string }): boolean {
  const tokens = tokensOf(text)
  const parts = norm(`${person.firstName} ${person.lastName}`).split(/\s+/).filter((p) => p.length > 1)
  return parts.some((part) => tokens.some((_, i) => wordNames(tokens, i, part)))
}

/**
 * Change verbs a slip of the thumb can still be read as: "kend" is lend, "mrak"
 * is mark, "delte" is delete. One wrong, missing or swapped letter, and only on
 * words of four letters or more, so short words do not collide ("and" is not "add").
 */
export const CHANGE_VERBS = ['lend', 'mark', 'paid', 'delete', 'remove', 'restore', 'record', 'deposit', 'withdraw', 'rename', 'extend', 'convert', 'label', 'borrow', 'update', 'change', 'create', 'attach', 'undo', 'fund']

export function looksLikeChangeVerb(word: string): boolean {
  const w = word.toLowerCase()
  return w.length >= 4 && CHANGE_VERBS.some((v) => Math.abs(v.length - w.length) <= 1 && distance(w, v) <= 1)
}

/** The change verb a slipped word was meant to be ("kend" → "lend"), or the word unchanged. */
export function fixChangeVerb(word: string): string {
  const w = word.toLowerCase()
  if (w.length < 4 || CHANGE_VERBS.includes(w)) return word
  return CHANGE_VERBS.find((v) => Math.abs(v.length - w.length) <= 1 && distance(w, v) <= 1) ?? word
}

// ---------------------------------------------------------------- is it really a typo?

/**
 * Everyday words, English and Tagalog. One wrong letter in a name is a typo,
 * but one wrong letter in a REAL word is just that word: "how many are
 * pending" is not "how Mary are pending". These never silently become a
 * near-miss of a name; in a spot where a name belongs ("lend money to Many")
 * they get a "did you mean" instead.
 */
export const EVERYDAY = new Set([
  // English
  'the', 'and', 'are', 'was', 'were', 'has', 'have', 'had', 'did', 'does', 'done', 'can', 'will', 'would', 'should', 'could',
  'how', 'many', 'much', 'more', 'most', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'that', 'this',
  'these', 'those', 'there', 'their', 'they', 'them', 'then', 'than', 'with', 'without', 'into', 'onto', 'over', 'under',
  'about', 'after', 'before', 'still', 'also', 'only', 'just', 'even', 'ever', 'never', 'any', 'some', 'every', 'each',
  'all', 'both', 'none', 'many', 'few', 'last', 'next', 'first', 'same', 'other', 'another', 'show', 'list', 'tell', 'give',
  'make', 'made', 'take', 'took', 'send', 'sent', 'want', 'need', 'left', 'owe', 'owes', 'owed', 'owing', 'paid', 'pays',
  'pay', 'lent', 'lend', 'loan', 'loans', 'money', 'week', 'weeks', 'month', 'year', 'days', 'date', 'due', 'late',
  'total', 'pending', 'request', 'requests', 'waiting', 'unpaid', 'interest', 'capital', 'cash', 'fund', 'funds', 'pot',
  'pots', 'lender', 'lenders', 'borrower', 'borrowers', 'people', 'person', 'name', 'names', 'note', 'notes', 'proof',
  'good', 'okay', 'bad', 'new', 'old', 'open', 'close', 'closed', 'here', 'mine', 'your', 'yours', 'ours', 'from',
  'for', 'not', 'but', 'yet', 'now', 'today', 'yesterday', 'tomorrow', 'may', 'might', 'must', 'shall', 'been', 'being',
  'mean', 'meant', 'many', 'man', 'men', 'any', 'one', 'two', 'three', 'four', 'five', 'six', 'ten', 'per', 'out', 'off',
  'back', 'again', 'yes', 'please', 'thanks', 'thank', 'look', 'find', 'check', 'see', 'mark', 'hope', 'joy', 'grace',
  'faith', 'will', 'rose', 'june', 'april', 'august', 'ray', 'sunny', 'dawn', 'rich', 'bill', 'sue', 'pat', 'art',
  // Tagalog
  'ang', 'mga', 'ng', 'sa', 'na', 'ay', 'at', 'ba', 'po', 'ko', 'mo', 'niya', 'nila', 'namin', 'natin', 'kami', 'tayo',
  'sila', 'siya', 'ako', 'ikaw', 'ka', 'may', 'meron', 'wala', 'walang', 'sino', 'ano', 'ilan', 'ilang', 'magkano',
  'kailan', 'saan', 'bakit', 'paano', 'pa', 'lang', 'din', 'rin', 'naman', 'kasi', 'pero', 'kung', 'utang', 'bayad',
  'bayaran', 'nagbayad', 'hindi', 'oo', 'yung', 'iyon', 'ito', 'dito', 'doon', 'lahat', 'pera', 'linggo', 'buwan',
])

/** Words a name comes straight after: "to Rico", "from Maria", "kay Rico", "si Bea", "lend Bea", "mark Mark". */
const NAME_BEFORE = new Set([
  'to', 'from', 'for', 'by', 'with', 'kay', 'ni', 'si', 'para', 'galing', 'nina', 'sina', 'kina',
  'lend', 'paid', 'pay', 'mark', 'delete', 'remove', 'restore', 'rename', 'extend', 'convert', 'label', 'fund', 'funded',
  'borrower', 'lender', 'does', 'did', 'has', 'is', 'about',
])

/** What a change verb is done TO when it is not a person: "lend money", "mark week 2", "delete note". */
const THINGS = new Set(['money', 'cash', 'loan', 'loans', 'week', 'weeks', 'interest', 'capital', 'pot', 'note', 'notes', 'proof', 'request', 'requests', 'payment', 'pera', 'utang', 'bayad', 'the', 'all', 'it', 'this', 'that'])

export type Token = { word: string; capital: boolean; first: boolean; possessive: boolean }

/** The typed words, lower case and accent-free, remembering a capital letter and a trailing "'s". */
export function tokensOf(text: string): Token[] {
  const raw = text.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z']+/).filter((w) => /[A-Za-z]/.test(w))
  return raw.map((w, i) => {
    const possessive = /'s$/i.test(w)
    const word = w.replace(/'s$/i, '').replace(/'/g, '').toLowerCase()
    return { word, capital: /^[A-Z]/.test(w), first: i === 0, possessive }
  }).filter((t) => t.word.length > 0)
}

/**
 * Whether a word sits where a name belongs: right after "to", "from", "kay",
 * "si", a change verb and the like; written with a capital mid-sentence; or
 * owning something ("Many's loan"). The first word's capital proves nothing:
 * phones capitalise it on their own.
 */
export function inNameSpot(tokens: Token[], i: number): boolean {
  const t = tokens[i]
  if (!t) return false
  if (t.possessive || (t.capital && !t.first)) return true
  if (THINGS.has(t.word)) return false
  const before = tokens[i - 1]?.word
  return !!before && (NAME_BEFORE.has(before) || looksLikeChangeVerb(before))
}

/**
 * Whether typed word i names this part of a person's name.
 *
 * - The exact word counts, unless it is an everyday word in a spot no name
 *   would be ("how MANY", "MAY utang ba"): a borrower called Joy is found by
 *   "how much does Joy owe", but "May" in "may utang ba si Rico" is Tagalog.
 * - One wrong letter counts only for a word that is not a real word: "Ricco"
 *   is Rico, "many" is never Mary. A real word in a name spot ("lend to Many")
 *   finds nobody here, so the caller asks "did you mean Mary?" instead of
 *   guessing.
 * - Names under four letters allow no typo at all ("Al", "Jo", "Bea").
 */
export function wordNames(tokens: Token[], i: number, part: string): boolean {
  const w = tokens[i]?.word
  if (!w) return false
  if (w === part) return !EVERYDAY.has(w) || inNameSpot(tokens, i)
  if (part.length < 4 || w.length < 3 || distance(w, part) > 1) return false
  return !EVERYDAY.has(w)
}

/** The words worth a "did you mean": not everyday words, unless they sit where a name belongs. */
export function maybeNames(text: string): string[] {
  const tokens = tokensOf(text)
  return tokens.filter((t, i) => t.word.length >= 3 && (!EVERYDAY.has(t.word) || inNameSpot(tokens, i))).map((t) => t.word)
}
