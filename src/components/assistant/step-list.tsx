'use client'

import { Check, Loader2, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Step } from '@/lib/assistant-steps'

/**
 * What Dex-E looked at, in plain words (see lib/assistant-steps.ts), as a
 * short timeline in the app's blue.
 *
 * While it works the steps show one by one under "Thinking", each with a
 * spinner that turns into a tick. Once the answer is in, the same steps stay
 * above it, so the Admin can always see how it got there.
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
  if (steps.length === 0) return null
  const writing = steps.every((s) => s.state !== 'doing')
  return (
    <div role="status" aria-live="polite" className={BOX}>
      <StepRows steps={writing ? [...steps, { id: -1, text: WRITING_STEP, state: 'doing' }] : steps} live />
    </div>
  )
}

/** The finished steps, kept above the answer. */
export function DoneSteps({ steps }: { steps: Step[] }) {
  if (unique(steps).length === 0) return null
  return (
    <div aria-label="What Dex-E checked" className={BOX}>
      <StepRows steps={steps} />
    </div>
  )
}
