'use client'

import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { MAX_REMIND_WEEKS } from '@/lib/loan-state.ts'

const PRESETS = [1, 2, 3, 4]

/**
 * "Remind me every N weeks" — the same switch on New loan, Edit loan and a
 * pending request.
 *
 * Posts one field, `remindEveryWeeks`: the number of weeks, or blank when the
 * switch is off. The rule it drives is storedLoanStateWithReminder in
 * lib/loan-state.ts; the server re-reads and checks the number either way.
 */
export function RemindEvery({ initial }: { initial: number | null }) {
  const [on, setOn] = useState(initial !== null)
  const [preset, setPreset] = useState<number | 'custom'>(
    initial === null ? 1 : PRESETS.includes(initial) ? initial : 'custom',
  )
  const [custom, setCustom] = useState(initial !== null && !PRESETS.includes(initial) ? String(initial) : '')
  const value = !on ? '' : preset === 'custom' ? custom : String(preset)

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
        <span className="min-w-0">
          <span className="font-medium">Remind me</span>
          <span className="text-muted-foreground block text-xs">
            Shows this loan as Due soon every few weeks from its start, until it is due.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="bg-input peer-checked:bg-brand-strong peer-focus-visible:ring-ring/50 relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-3 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4"
        />
      </label>
      <input type="hidden" name="remindEveryWeeks" value={value} />

      {on ? (
        <div className="space-y-2">
          <div role="radiogroup" aria-label="Remind me every" className="flex flex-wrap gap-2">
            {[...PRESETS, 'custom' as const].map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={preset === option}
                onClick={() => setPreset(option)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  preset === option ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground'
                }`}
              >
                {option === 'custom' ? 'Custom' : option === 1 ? 'Every week' : `${option} weeks`}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="relative max-w-48">
              <Input
                aria-label="Remind me every how many weeks"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_REMIND_WEEKS}
                step={1}
                placeholder="6"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                className="pr-16"
                required
              />
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm" aria-hidden>
                weeks
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
