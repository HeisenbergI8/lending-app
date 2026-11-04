/**
 * Small slips in an AI answer, fixed before the Admin reads it. Seen on the
 * testing link (2026-11-04): "...due on borrowers.John Ross Rivera is the
 * nearest due on borrowers." The same sentence twice, glued with no space.
 *
 * - A missing space after a full stop, question mark or exclamation mark.
 * - A sentence or line said twice in a row, or a whole answer said twice.
 *
 * Pure, so each fix is tested on its own.
 */

/** "borrowers.John" → "borrowers. John". Only before a capital letter, so ₱1.50 and e.g. stay as they are. */
export function spaceAfterStops(text: string): string {
  return text.replace(/([a-z0-9)])([.!?])([A-Z])/g, '$1$2 $3')
}

/** Sentences of one line, split only where a stop is followed by a space, so ₱57,600.00 stays whole. */
function sentences(line: string): string[] {
  return line.trim().split(/(?<=[.!?])\s+/).filter(Boolean)
}

/** The same sentence twice in a row on a line, and the same line twice in a row, said once. */
export function withoutRepeats(text: string): string {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const kept: string[] = []
    for (const s of sentences(raw)) if (s !== kept.at(-1)) kept.push(s)
    const line = raw.trim() ? kept.join(' ') : ''
    if (line && line === lines.filter(Boolean).at(-1)) continue
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function tidyAnswer(text: string): string {
  return withoutRepeats(spaceAfterStops(text))
}
