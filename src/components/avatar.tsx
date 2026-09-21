import { cn } from '@/lib/utils'

/**
 * A person, as their initials in a coloured circle.
 *
 * WHY A COLOUR AT ALL: a list of names in identical grey rows is read word by
 * word. Give each person a stable colour and the eye finds "the teal one" on the
 * way back to a row it saw a moment ago, without re-reading anything.
 *
 * The colour is DERIVED FROM THE NAME, not stored and not random, so the same
 * person is the same colour on every screen and across reloads. Storing it would
 * be a second source of truth about a person for no gain.
 *
 * It carries NO meaning — it is not a rating, not a status, not a risk band.
 * That is why it draws from the decorative chip ramp rather than the four
 * reserved status colours: a red avatar must never be mistaken for a red badge.
 */

const TINTS = [
  'text-chip-indigo bg-chip-indigo/12',
  'text-chip-sky bg-chip-sky/12',
  'text-chip-mint bg-chip-mint/12',
  'text-chip-violet bg-chip-violet/12',
  'text-chip-amber bg-chip-amber/12',
] as const

/** A small stable hash. Same name in, same tint out, on the server and in the browser. */
function tintFor(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0
  }
  return TINTS[hash % TINTS.length]
}

/** "Angel Dela Cruz" → "AD". First and last word, which is what people scan for. */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function Avatar({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        tintFor(name),
        className,
      )}
      // The name is always in the row beside this, so the circle is decoration
      // to a screen reader and announcing "A D" again would just be noise.
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  )
}
