import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * An answer laid out to be scanned on a phone first:
 *
 *   ₱95,000.00                       ← the figure asked for, large (a "**₱…**" first line)
 *   out on loan right now            ← what it is, small and grey
 *   ┌───────────────────────────┐
 *   │ Dan Aquino      ₱15,360.00 │   ← "- Label: value" rows, value on the right
 *   │ 42 days late                │   ← "| detail" under the label, small and grey
 *   └───────────────────────────┘
 *
 * **Bold** elsewhere marks a key word. Anything else stays a plain paragraph,
 * so an answer written without this shape still reads fine. Works on a
 * half-typed answer too: the text is laid out again as it grows.
 */

const BULLET = /^\s*[-•*]\s+(.*)$/
/** "Due: November 26, 2026" → label "Due". Short labels only, so a sentence with a colon stays a sentence. */
const LABELLED = /^([^:]{1,32}):\s+(.+)$/
/** A first line that leads with a figure or a date: "**₱95,000.00** out on loan right now.", "**7 borrowers** in all.", "**November 08, 2026**: …" */
const HERO = /^\*\*((?:₱|\d|(?:January|February|March|April|May|June|July|August|September|October|November|December)\b)[^*]{0,24})\*\*[,:]?\s*(.*)$/

/** **bold** parts in bold. An unclosed ** (still typing) is left out, not shown. */
function inline(text: string): ReactNode {
  const parts = text.split('**')
  return parts.map((part, i) =>
    i % 2 === 1 && !(parts.length % 2 === 0 && i === parts.length - 1) ? (
      <strong key={i} className="text-foreground font-semibold">
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

type Block = { kind: 'text'; text: string } | { kind: 'rows'; rows: string[] }

function blocks(text: string): Block[] {
  const out: Block[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const bullet = BULLET.exec(line)
    const last = out.at(-1)
    if (bullet) {
      if (last?.kind === 'rows') last.rows.push(bullet[1])
      else out.push({ kind: 'rows', rows: [bullet[1]] })
    } else out.push({ kind: 'text', text: line })
  }
  return out
}

/** A row's parts: "Dan Aquino: ₱15,360.00 | 42 days late" → label, value, detail. */
function parts(text: string): { label: string; value: string; detail: string | null } | null {
  const labelled = LABELLED.exec(text)
  if (!labelled) return null
  const [value, ...rest] = labelled[2].split(' | ')
  return { label: labelled[1], value, detail: rest.length > 0 ? rest.join(' | ') : null }
}

/**
 * A list of people (rows with a detail line) leads with the name; a list of
 * facts ("Collected", "Due") leads with the value, as on a change card.
 */
function Row({ text, people }: { text: string; people: boolean }) {
  const p = parts(text)
  if (!p) return <div className="px-3 py-2.5 text-[13px] sm:px-3.5 sm:text-sm">{inline(text)}</div>
  // A long value goes under its label, so it never squeezes into a narrow right column.
  if (p.value.length > 28) {
    return (
      <div className="flex flex-col gap-0.5 px-3 py-2.5 text-[13px] sm:px-3.5 sm:text-sm">
        <dt className="text-muted-foreground text-xs">{inline(p.label)}</dt>
        <dd className="font-medium tabular-nums">{inline(p.value)}</dd>
        {p.detail && <dd className="text-muted-foreground text-xs">{inline(p.detail)}</dd>}
      </div>
    )
  }
  return (
    // One line on a phone too: tighter spacing and 13px, still easy to read. Only a phone too
    // narrow even for that moves the value under its label; nothing breaks mid-phrase.
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px] sm:gap-5 sm:px-3.5 sm:text-sm">
      <div className="flex min-w-0 flex-col">
        <dt className={cn('truncate', people ? 'text-foreground font-medium' : 'text-muted-foreground')}>{inline(p.label)}</dt>
        {p.detail && <span className="text-muted-foreground text-xs leading-snug">{inline(p.detail)}</span>}
      </div>
      <dd className="shrink-0 text-right font-semibold whitespace-nowrap tabular-nums">{inline(p.value)}</dd>
    </div>
  )
}

/** The figure asked for, large, with what it is under it. */
function Hero({ figure, rest, caret }: { figure: string; rest: string; caret: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-foreground text-[26px] leading-tight font-semibold tracking-tight tabular-nums">{figure}</p>
      {rest && (
        <p className="text-muted-foreground text-sm leading-snug">
          {inline(rest.charAt(0).toUpperCase() + rest.slice(1))}
          {caret}
        </p>
      )}
    </div>
  )
}

export function AnswerText({ text, failed, caret }: { text: string; failed?: boolean; caret?: ReactNode }) {
  const all = blocks(text)
  return (
    <div className={cn('flex flex-col gap-3 text-sm leading-relaxed', failed && 'text-muted-foreground')}>
      {all.map((b, i) => {
        const last = i === all.length - 1
        if (b.kind === 'rows') {
          const people = b.rows.some((r) => parts(r)?.detail)
          return (
            <dl key={i} className="border-border divide-border/60 bg-card divide-y overflow-hidden rounded-2xl border">
              {b.rows.map((row, j) => (
                <Row key={j} text={row} people={people} />
              ))}
            </dl>
          )
        }
        const hero = i === 0 && !failed ? HERO.exec(b.text) : null
        if (hero) return <Hero key={i} figure={hero[1]} rest={hero[2]} caret={last ? caret : null} />
        return (
          <p key={i} className={cn(i === 0 && !failed && 'text-[15px] leading-snug font-medium')}>
            {inline(b.text)}
            {last && caret}
          </p>
        )
      })}
      {all.at(-1)?.kind !== 'text' && caret}
    </div>
  )
}
