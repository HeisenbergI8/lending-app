'use client'

import { useActionState, useCallback, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { useRouter } from 'next/navigation'

import { Plus } from 'lucide-react'

import { type FormState, NO_ERROR } from '@/lib/form-state.ts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
 * What an action asks before it runs.
 *
 * The copy lives at the call site rather than being generated from the action
 * name, because the only useful thing a confirmation can say is what happens
 * afterwards, and that differs every time.
 */
export type Confirm = {
  title: string
  body: string
  action: string
}

/**
 * A button that asks first.
 *
 * It is type="button", so nothing is posted by pressing it; the dialog's own
 * button asks the form to submit. useFormStatus still works here because this
 * sits inside the form, so the trigger goes to its pending label once the
 * action is away.
 */
function ConfirmButton({
  children,
  confirm,
  onConfirm,
  pendingLabel,
  variant,
  size,
  className,
}: {
  children: React.ReactNode
  confirm: Confirm
  onConfirm: () => void
  pendingLabel?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} size={size} disabled={pending} className={className}>
          {pending ? (pendingLabel ?? children) : children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
        <AlertDialogDescription>{confirm.body}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {confirm.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * A form that is one button — delete, restore, set a label.
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
  confirm,
  buttonClassName,
}: {
  action: Action
  values: Record<string, string>
  children: React.ReactNode
  /** On the <form>. `buttonClassName` is the one that reaches the button. */
  className?: string
  buttonClassName?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  pendingLabel?: string
  /**
   * Ask before running. Anything that destroys or resurrects a record gets one
   * of these; a rating that is one tap to undo does not, and a dialog in front
   * of it would only train the admin to dismiss dialogs without reading them.
   */
  confirm?: Confirm
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  /**
   * Ask the router for the screen again the moment the action succeeds.
   *
   * The action already revalidates on the server, and that is what makes the
   * data correct. This is the other half of the same promise: it tells the
   * router to go and fetch the fresh tree now rather than on the next
   * navigation, so a row that was just deleted leaves the list under the
   * admin's thumb instead of after a manual reload.
   */
  const submit = useCallback(
    async (previous: FormState, form: FormData): Promise<FormState> => {
      const result = await action(previous, form)
      if (result.error === null) router.refresh()
      return result
    },
    [action, router],
  )

  const [state, formAction] = useActionState(submit, NO_ERROR)

  return (
    <form
      ref={formRef}
      action={formAction}
      className={cn('inline-flex flex-col items-end gap-1', className)}
    >
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {confirm ? (
        <ConfirmButton
          confirm={confirm}
          onConfirm={() => formRef.current?.requestSubmit()}
          variant={variant}
          size={size}
          pendingLabel={pendingLabel}
          className={buttonClassName}
        >
          {children}
        </ConfirmButton>
      ) : (
        <SubmitButton
          variant={variant}
          size={size}
          pendingLabel={pendingLabel}
          className={buttonClassName}
        >
          {children}
        </SubmitButton>
      )}
      {state.error ? <p className="text-status-critical text-xs">{state.error}</p> : null}
    </form>
  )
}

/**
 * A form in a modal.
 *
 * It used to unfold in place, which was phone-first and right for a phone, but
 * on a laptop it put the form wherever its trigger happened to sit: pinned in a
 * corner above the page title, or shoving the whole screen down to make room.
 * The middle of the screen is the one place that works on every page, and the
 * dimmed backdrop says the form is the only thing to deal with right now.
 *
 * On a phone the overlay centres it with a margin and scrolls, so a form taller
 * than the screen is still reachable with the keyboard up.
 *
 * On success it closes and the fields clear, so a second entry starts from
 * empty rather than from the last one — the difference between adding two
 * lenders and accidentally adding the same one twice.
 */
export function FormDialog({
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
  /** Omit when the caller supplies its own trigger and drives `open` itself. */
  openLabel?: string
  children: React.ReactNode
  /** Omit to let the dialog own its own open state; pass it to drive it from outside. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  const open = controlledOpen ?? uncontrolledOpen

  // One place decides how it opens and closes, whether the caller is driving it
  // or not. Two branches at every call site is how a dialog ends up closed to
  // its parent and open to itself.
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  /**
   * Closing happens HERE, in the submit, rather than in an effect watching the
   * returned state. It closes because the admin saved something — that is a
   * cause, and putting it in the action says so. An effect would have to infer
   * it from the state changing, which needs a marker on every success just to
   * tell "that worked" from "nothing has happened yet".
   */
  const submit = useCallback(
    async (previous: FormState, form: FormData): Promise<FormState> => {
      const result = await action(previous, form)
      if (result.error === null) {
        formRef.current?.reset()
        setOpen(false)
        // Same reason as ActionForm: the new lender belongs in the list behind
        // this dialog straight away, not after the next navigation.
        router.refresh()
      }
      return result
    },
    [action, router, setOpen],
  )

  const [state, formAction] = useActionState(submit, NO_ERROR)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {openLabel ? (
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full sm:w-auto">
            <Plus className="size-4" aria-hidden />
            {openLabel}
          </Button>
        </DialogTrigger>
      ) : null}

      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}

        <form ref={formRef} action={formAction} className="mt-4 space-y-3">
          {children}

          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          {/* Reversed on a phone, so Save is the one under the thumb and Cancel
              is the one that takes a reach. */}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="ghost" className="w-full sm:w-auto">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton pendingLabel="Saving…" className="w-full sm:w-auto">
              {submitLabel}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
