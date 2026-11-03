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
