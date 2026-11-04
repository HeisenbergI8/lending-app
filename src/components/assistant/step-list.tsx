'use client'

import { useState } from 'react'
import { Check, ChevronDown, Loader2, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Step } from '@/lib/assistant-steps'

/**
 * What Dex-E looked at, in plain words (see lib/assistant-steps.ts), as a
 * short timeline in the app's blue.
 *
 * While it works the steps show one by one under "Thinking", each with a
 * spinner that turns into a tick. Once the answer is in, the whole thinking
 * stays above it, never removed: how long it took, every lookup, and the
 * last step of writing the answer. It starts folded to one line, "Thought for
 * 11 seconds", and opens with a tap, so the answer stays the first thing read.
 * The same line twice ("Looking for Angel" asked again) shows once.
 */

function unique(steps: Step[]): Step[] {
  const seen = new Set<string>()
  return steps.filter((s) => (seen.has(s.text) ? false : (seen.add(s.text), true)))
}

function StepRows({ steps, live }: { steps: Step[]; live?: boolean }) {
  const rows = unique(steps)
  return (
    <ol className="flex flex-col">
      {rows.map((s, i) => (
        <li key={s.id} className={cn('relative flex items-start gap-2.5 pb-2 text-[13px] leading-[18px] last:pb-0', live && 'animate-ask-rise')}>
          {/* The thread joining one step to the next. */}
          {i < rows.length - 1 && <span aria-hidden className="bg-brand-line absolute top-[18px] bottom-0 left-[8.5px] w-px" />}
          <span
            aria-hidden
            className={cn(
              'relative flex size-[18px] shrink-0 items-center justify-center rounded-full',
              s.state === 'done' && 'bg-brand text-brand-foreground',
              s.state === 'doing' && 'bg-brand-bg text-brand',
              s.state === 'missed' && 'bg-brand-bg text-brand/60',
            )}
          >
            {s.state === 'doing' ? (
              <Loader2 className="size-3 animate-spin" strokeWidth={2.5} />
            ) : s.state === 'done' ? (
              <Check className="size-3" strokeWidth={3} />
            ) : (
              <Minus className="size-3" strokeWidth={3} />
            )}
          </span>
          <span className={cn(s.state === 'doing' ? 'text-brand font-medium' : 'text-muted-foreground')}>
            {s.text}
            {s.state === 'doing' && '…'}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** A soft blue card, the same while working and after, so the steps do not jump when the answer lands. */
const BOX = 'border-brand-line bg-brand-bg w-fit max-w-full rounded-2xl border px-3 py-2.5'

/** Shown while no lookup runs (the AI is deciding the next one, or writing), so the list never looks stuck. */
export const WRITING_STEP = 'Thinking it through'

/** The steps as they happen, under the thinking face. */
export function LiveSteps({ steps }: { steps: Step[] }) {
  const writing = steps.every((s) => s.state !== 'doing')
  return (
    <div role="status" aria-live="polite" className={BOX}>
      <StepRows steps={writing ? [...steps, { id: -1, text: WRITING_STEP, state: 'doing' }] : steps} live />
    </div>
  )
}

/** "Thought for 6 seconds", "Thought for 1 minute 5 seconds". */
export function thoughtFor(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  return `Thought for ${min > 0 ? `${part(min, 'minute')}${sec > 0 ? ` ${part(sec, 'second')}` : ''}` : part(sec, 'second')}`
}

/** The whole thinking, kept above the answer for good; folded until tapped. */
export function DoneSteps({ steps, thoughtMs, failed, quick }: { steps: Step[]; thoughtMs: number; failed?: boolean; quick?: boolean }) {
  const [open, setOpen] = useState(false)
  const last: Step = failed ? { id: -1, text: 'Could not finish the answer', state: 'missed' } : { id: -1, text: 'Wrote the answer', state: 'done' }
  const all = unique([...steps, last])
  // Answered by the server from the app's own numbers: no AI, so no thinking time to show.
  const title = quick ? 'Instant answer' : thoughtFor(thoughtMs)
  return (
    <div aria-label="What Dex-E checked" className={cn(BOX, 'py-0')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${title}, ${all.length} ${all.length === 1 ? 'step' : 'steps'}. ${open ? 'Hide' : 'Show'} the thinking`}
        className="text-brand focus-visible:ring-brand/40 flex w-full cursor-pointer items-center gap-1.5 rounded-full py-2 text-xs font-medium outline-none focus-visible:ring-2"
      >
        {title}
        <span className="text-brand/60 font-normal">· {all.length} {all.length === 1 ? 'step' : 'steps'}</span>
        <ChevronDown aria-hidden className={cn('ml-auto size-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="animate-ask-rise pb-2.5">
          <StepRows steps={all} />
        </div>
      )}
    </div>
  )
}
