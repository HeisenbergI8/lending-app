'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A password box with an eye on it.
 *
 * The eye sits INSIDE the field rather than beside it. Beside it, the control
 * takes width from the input on a phone and reads as a second thing to fill in;
 * inside, it is plainly part of the box it acts on. The field keeps padding for
 * it at all times, so nothing shifts when it appears.
 *
 * Each field reveals ITSELF and nothing else. One switch over a whole form
 * would put the new password on screen while the admin is still reading the
 * current one back, which is the opposite of what the eye is for.
 *
 * Nothing is remembered between renders or fields: a revealed box goes back to
 * dots when the form closes, so a dialog reopened later never starts by showing
 * a password.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="relative">
      <Input {...props} type={revealed ? 'text' : 'password'} className={cn('pr-11', className)} />
      <button
        type="button"
        onClick={() => setRevealed((shown) => !shown)}
        // aria-pressed rather than a changing label: the button's job is
        // constant, and a screen reader is told its state instead of being
        // handed a new name each time it is used.
        aria-pressed={revealed}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-lg focus-visible:ring-2 focus-visible:outline-none"
      >
        {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
