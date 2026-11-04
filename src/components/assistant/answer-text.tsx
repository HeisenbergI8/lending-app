import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * An answer laid out so it can be scanned: the first line is the answer
 * itself, and "- Label: value" lines become rows like the ones on a change
 * card (label on the left, value on the right). **Bold** marks the key figure.
 * Anything else stays a plain paragraph, so an answer written without this
 * shape still reads fine.
 *
 * Works on a half-typed answer too: the text is laid out again as it grows.
 */

const BULLET = /^\s*[-•*]\s+(.*)$/
/** "Due: November 26, 2026" → label "Due". Short labels only, so a sentence with a colon stays a sentence. */
const LABELLED = /^([^:]{1,32}):\s+(.+)$/

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

function Row({ text }: { text: string }) {
  const labelled = LABELLED.exec(text)
  if (!labelled) return <div className="px-3.5 py-2 text-sm">{inline(text)}</div>
  const [, label, value] = labelled
  // A long value goes under its label, so it never squeezes into a narrow right column.
  return value.length > 28 ? (
    <div className="flex flex-col gap-0.5 px-3.5 py-2 text-sm">
      <dt className="text-muted-foreground text-xs">{inline(label)}</dt>
      <dd className="font-medium tabular-nums">{inline(value)}</dd>
    </div>
  ) : (
    // Label and value stay whole: on a narrow phone the value moves under the label instead of breaking mid-phrase.
    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-0.5 px-3.5 py-2 text-sm">
      <dt className="text-muted-foreground whitespace-nowrap">{inline(label)}</dt>
      <dd className="ml-auto text-right font-medium whitespace-nowrap tabular-nums">{inline(value)}</dd>
    </div>
  )
}

export function AnswerText({ text, failed, caret }: { text: string; failed?: boolean; caret?: ReactNode }) {
  const all = blocks(text)
  return (
    <div className={cn('flex flex-col gap-2.5 text-sm leading-relaxed', failed && 'text-muted-foreground')}>
      {all.map((b, i) =>
        b.kind === 'text' ? (
          <p key={i} className={cn(i === 0 && !failed && 'text-[15px] font-medium')}>
            {inline(b.text)}
            {i === all.length - 1 && caret}
          </p>
        ) : (
          <dl key={i} className="border-border divide-border/60 divide-y overflow-hidden rounded-2xl border">
            {b.rows.map((row, j) => (
              <Row key={j} text={row} />
            ))}
          </dl>
        ),
      )}
      {all.at(-1)?.kind !== 'text' && caret}
    </div>
  )
}
