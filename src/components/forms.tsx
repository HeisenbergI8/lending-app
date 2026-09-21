'use client'

import { useActionState, useCallback, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { ChevronDown, Plus } from 'lucide-react'

import { type FormState, NO_ERROR } from '@/lib/form-state.ts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The two ways this app writes anything.
 *
 * Both sit on server actions rather than fetch(): the form works before the
 * JavaScript arrives, and the browser's own validation and reset behaviour come
 * free. Both also disable their button while the action runs — without that a
 * double-tap on a phone records the deposit twice, which is the kind of bug that
 * shows up as a lender being paid twice and nobody knowing why.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>

export function SubmitButton({
  children,
  pendingLabel,
  variant,
  size,
  className,
}: {
  children: React.ReactNode
  pendingLabel?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
}) {
  // useFormStatus reads the enclosing form, so this needs no prop threading and
  // cannot get out of step with the form it belongs to.
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  )
}

/**
 * A form that is one button — archive, restore, set a label.
 *
 * The values it carries are hidden fields rather than a bound closure, so the
 * same component serves every one-shot action and the server still re-checks
 * everything it is handed. A posted id is a request, not a permission.
 */
export function ActionForm({
  action,
  values,
  children,
  className,
  variant,
  size,
  pendingLabel,
}: {
  action: Action
  values: Record<string, string>
  children: React.ReactNode
  className?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  pendingLabel?: string
}) {
  const [state, formAction] = useActionState(action, NO_ERROR)

  return (
    <form action={formAction} className={cn('inline-flex flex-col items-end gap-1', className)}>
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
      {state.error ? <p className="text-status-critical text-xs">{state.error}</p> : null}
    </form>
  )
}

/**
 * A form that stays folded away until it is wanted.
 *
 * Phone-first: "Add lender" is one line at rest, and the fields appear in place
 * when tapped. A dialog would cover the list the admin is looking at, and on a
 * small screen it fights the keyboard for the same space.
 *
 * On success the panel closes and the fields clear, so a second entry starts
 * from empty rather than from the last one — the difference between adding two
 * lenders and accidentally adding the same one twice.
 */
export function DisclosureForm({
  action,
  title,
  description,
  submitLabel,
  openLabel,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  action: Action
  title: string
  description?: string
  submitLabel: string
  openLabel: string
  children: React.ReactNode
  /** Omit to let the panel own its own open state; pass it to drive it from outside. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const panelId = useId()

  const open = controlledOpen ?? uncontrolledOpen

  // One place decides how the panel opens and closes, whether the caller is
  // driving it or not. Two branches at every call site is how a panel ends up
  // closed to its parent and open to itself.
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  /**
   * Closing happens HERE, in the submit, rather than in an effect watching the
   * returned state. The panel closes because the admin saved something — that is
   * a cause, and putting it in the action says so. An effect would have to infer
   * it from the state changing, which needs a marker on every success just to
   * tell "that worked" from "nothing has happened yet".
   */
  const submit = useCallback(
    async (previous: FormState, form: FormData): Promise<FormState> => {
      const result = await action(previous, form)
      if (result.error === null) {
        formRef.current?.reset()
        setOpen(false)
      }
      return result
    },
    [action, setOpen],
  )

  const [state, formAction] = useActionState(submit, NO_ERROR)

  if (!open) {
    return (
      <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={panelId}>
        <Plus className="size-4" aria-hidden />
        {openLabel}
      </Button>
    )
  }

  return (
    <div id={panelId} className="bg-card animate-in fade-in slide-in-from-top-1 rounded-xl border p-4 duration-200">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-expanded aria-controls={panelId}>
          <ChevronDown className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <form ref={formRef} action={formAction} className="space-y-3">
        {children}

        {state.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <SubmitButton pendingLabel="Saving…" className="w-full sm:w-auto">
          {submitLabel}
        </SubmitButton>
      </form>
    </div>
  )
}
