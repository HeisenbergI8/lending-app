'use client'

import { useActionState, useRef } from 'react'
import { MessageSquarePlus } from 'lucide-react'

import { SubmitButton } from '@/components/forms.tsx'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NO_ERROR, type FormState } from '@/lib/form-state.ts'
import { withSound } from '@/lib/sound.ts'
import { addLoanNote } from '@/server/loans/actions.ts'

/**
 * A remark the Admin writes on a loan.
 *
 * THE BOX IS EMPTIED AFTER SAVING, and that costs this form its
 * no-JavaScript fallback: Next can only post a form straight to the server when
 * the function handed to useActionState IS the server action, and this one
 * wraps it. Worth it here for one reason — the note that was just saved is
 * rendered directly below this box, and a box still holding the same words
 * beside a note that already exists reads as "that did not save". The next tap
 * records it twice.
 *
 * Nothing is validated beyond "it says something": a note holds no figure and
 * no screen adds one up.
 */
export function NoteForm({ loanId }: { loanId: string }) {
  const formRef = useRef<HTMLFormElement>(null)

  // Clearing happens in the submit rather than in an effect watching the
  // result: the box empties BECAUSE something was saved, which is a cause.
  const [state, formAction] = useActionState(async (previous: FormState, form: FormData) => {
    const result = await withSound(addLoanNote, 'create')(previous, form)
    if (result.error === null) formRef.current?.reset()
    return result
  }, NO_ERROR)

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="loanId" value={loanId} />

      <Label htmlFor="note-body" className="sr-only">
        Add a note
      </Label>
      <Textarea
        id="note-body"
        name="body"
        maxLength={2000}
        required
        placeholder="Chased on Viber, says Friday."
      />

      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton variant="outline" pendingLabel="Saving…" className="w-full sm:w-auto">
        <MessageSquarePlus className="size-4" aria-hidden />
        Add note
      </SubmitButton>
    </form>
  )
}
