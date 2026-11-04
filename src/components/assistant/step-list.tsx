'use client'

import { useState } from 'react'
import { Check, ChevronDown, Loader2, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Step } from '@/lib/assistant-steps'

/**
 * What Dex-E looked at, in plain words (see lib/assistant-steps.ts).
 *
 * While it works the steps show one by one under "Thinking", each with a
 * spinner that turns into a tick. Once the answer is in they fold into one
 * quiet line above it, "How I got this · 3 steps", which opens the same list.
 * The same line twice ("Looking for Angel" asked again) shows once.
 */

function unique(steps: Step[]): Step[] {
  const seen = new Set<string>()
  return steps.filter((s) => (seen.has(s.text) ? false : (seen.add(s.text), true)))
}

function StepRows({ steps, live }: { steps: Step[]; live?: boolean }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {unique(steps).map((s) => (
        <li key={s.id} className={cn('flex items-start gap-2 text-[13px] leading-snug', live && 'animate-ask-rise')}>
          <span
            aria-hidden
            className={cn(
              'mt-px flex size-4 shrink-0 items-center justify-center rounded-full',
              s.state === 'done' && 'bg-[color-mix(in_oklab,var(--status-good)_16%,transparent)] text-[var(--status-good)]',
              s.state === 'missed' && 'bg-muted text-muted-foreground',
              s.state === 'doing' && 'text-brand',
            )}
          >
            {s.state === 'doing' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : s.state === 'done' ? (
              <Check className="size-3" strokeWidth={3} />
            ) : (
              <Minus className="size-3" strokeWidth={3} />
            )}
          </span>
          <span className={cn(s.state === 'doing' ? 'text-foreground' : 'text-muted-foreground')}>
            {s.text}
            {s.state === 'doing' && '…'}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Shown while no lookup runs (the AI is deciding the next one, or writing), so the list never looks stuck. */
export const WRITING_STEP = 'Thinking it through'

/** The steps as they happen, under the thinking face. */
export function LiveSteps({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null
  const writing = steps.every((s) => s.state !== 'doing')
  return (
    <div role="status" aria-live="polite" className="pl-1">
      <StepRows steps={writing ? [...steps, { id: -1, text: WRITING_STEP, state: 'doing' }] : steps} live />
    </div>
  )
}

/** The finished steps, folded into one line above the answer. */
export function DoneSteps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false)
  const shown = unique(steps)
  if (shown.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-brand/40 flex w-fit cursor-pointer items-center gap-1.5 rounded-full text-xs outline-none focus-visible:ring-2"
      >
        <span className="flex size-4 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--status-good)_16%,transparent)] text-[var(--status-good)]">
          <Check className="size-3" strokeWidth={3} />
        </span>
        How I got this · {shown.length} {shown.length === 1 ? 'step' : 'steps'}
        <ChevronDown aria-hidden className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-border/70 animate-ask-rise border-l-2 pl-3">
          <StepRows steps={shown} />
        </div>
      )}
    </div>
  )
}
