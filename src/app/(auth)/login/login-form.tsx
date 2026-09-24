'use client'

import { useActionState, useEffect, useState, useSyncExternalStore } from 'react'
import { useFormStatus } from 'react-dom'

import { Cannabis, LoaderCircle } from 'lucide-react'

import { formatCountdown } from '@/lib/countdown.ts'
import { PasswordInput } from '@/components/password-input.tsx'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login, type LoginState } from '@/server/auth/actions.ts'

const initialState: LoginState = { error: null }

function SubmitButton({ disabled }: { disabled: boolean }) {
  // useFormStatus reads the enclosing form's state, so the button disables itself
  // while the action runs. Without it a double-click creates two sessions.
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      className="mt-1 h-11 w-full rounded-xl"
      disabled={pending || disabled}
    >
      {pending ? (
        <>
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Signing in…
        </>
      ) : (
        'Sign in'
      )}
    </Button>
  )
}

/**
 * The lockout, ticking.
 *
 * The rate limiter already refused in a sentence — "try again in about 15
 * minutes" — and a rounded sentence is the wrong thing to stare at. It does not
 * change for a whole minute, so the admin reloads, tries again, and adds another
 * failed attempt to the pile that is keeping her out.
 *
 * A clock that moves answers the only question she has. It also DISABLES the
 * button while it runs, because every attempt made during a lockout is another
 * row in the window the lockout is measured over.
 *
 * Returns null the moment it reaches zero, so the form comes back by itself
 * rather than needing a reload.
 */
function Lockout({ until, onDone }: { until: number; onDone: () => void }) {
  const [remaining, setRemaining] = useState(() => until - Date.now())

  useEffect(() => {
    // Recomputed from the target each tick rather than decremented. A counter
    // that subtracts a second per interval drifts, and drifts badly when the
    // phone sleeps and the timer stops firing altogether.
    const timer = setInterval(() => {
      const left = until - Date.now()
      setRemaining(left)
      if (left <= 0) onDone()
    }, 1000)

    return () => clearInterval(timer)
  }, [until, onDone])

  if (remaining <= 0) return null

  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>
        Too many failed attempts. Admin can try again in{' '}
        <span className="font-mono font-semibold tabular-nums" aria-live="off">
          {formatCountdown(remaining)}
        </span>
        .
      </AlertDescription>
    </Alert>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState)

  /**
   * The lockout, DERIVED rather than copied into state by an effect.
   *
   * `state` is owned by useActionState and only changes when the action runs
   * again — which is precisely what the lockout is stopping — so something has
   * to be able to clear it when the clock runs out. That something is the one
   * fact the render cannot work out for itself: which refusal has already
   * finished counting. Mirroring state.retryAt into its own useState instead
   * means two sources for one truth, and a render in between where they
   * disagree.
   *
   * WHAT IS REMEMBERED IS THE ANSWER, NOT ITS DEADLINE. useActionState hands
   * back a fresh object per run, so two refusals are never the same object even
   * when they carry the same instant — which they can, since retryAt is anchored
   * to the oldest failed attempt in the window and that attempt does not move
   * while the window holds. Comparing the numbers would then leave the second
   * lockout invisible and the button live, with only the server to say no.
   *
   * `!= null` rather than a truthiness check, so an epoch of 0 is a deadline
   * like any other rather than silently "not locked".
   */
  const [countedOut, setCountedOut] = useState<LoginState | null>(null)
  const lockedUntil = state.retryAt != null && countedOut !== state ? state.retryAt : null

  /**
   * Is there JavaScript running this form yet?
   *
   * The clock is the whole point of the countdown, and a clock needs something
   * to wind it. Rendered on the server it prints one correct number and then
   * stops for ever — which is worse than the rounded sentence it replaced,
   * because a frozen "9:45" looks live and is not. Without this flag the
   * ticking branch always won and the plain sentence was dead code, exactly on
   * the one path that cannot tick.
   *
   * useSyncExternalStore rather than a mount flag set in an effect: the server
   * snapshot is false and the client snapshot is true, which is the supported
   * way to render differently before and after hydration without React calling
   * it a mismatch.
   */
  const ticking = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const locked = lockedUntil !== null

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 shadow-float ring-border/70 w-full max-w-sm rounded-2xl ring-1 duration-300">
      {/* The mark is centred and given room, because on this one screen it is
          the whole of the branding: there is no sidebar and no top bar yet. */}
      <CardHeader className="text-center">
        <div className="bg-brand text-brand-foreground shadow-float ring-brand-line mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl ring-4">
          <Cannabis className="size-7" aria-hidden />
        </div>
        <CardTitle className="text-2xl tracking-tight">Consignment Kush</CardTitle>
        <CardDescription>
          Sign in to manage lenders, borrowers and loans.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-2">
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </div>

          {/* Checked by default. The admin runs this on her own phone and signs
              in from it every day; the safe-by-default argument belongs to a
              shared machine, and this is not one. Unchecking it makes the cookie
              last only as long as the browser is open. */}
          <div className="flex items-start gap-2.5">
            <input
              id="remember"
              name="remember"
              type="checkbox"
              defaultChecked
              className="accent-brand mt-0.5 size-4 shrink-0 cursor-pointer"
            />
            <div className="min-w-0">
              <Label htmlFor="remember" className="cursor-pointer font-medium">
                Keep Admin signed in
              </Label>
              <p className="text-muted-foreground text-xs">
                For 30 days on this device. Turn it off on a shared computer.
              </p>
            </div>
          </div>

          {/* The lockout replaces the error rather than sitting under it: while
              it is running, "incorrect password" is not the thing to act on.
              With no JavaScript it falls through to state.error, which is the
              rate limiter's own rounded sentence — honest about being an
              estimate, where a frozen clock would not be. */}
          {locked && ticking ? (
            <Lockout until={lockedUntil} onDone={() => setCountedOut(state)} />
          ) : state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <SubmitButton disabled={locked} />
        </form>

        {/* A labelled divider rather than another card: the demo hint is an
            aside to the form above it, not a second thing to sign in with. */}
        <div className="mt-7 flex items-center gap-3">
          <span className="bg-border h-px flex-1" aria-hidden />
          <span className="text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase">
            Or try it with sample data
          </span>
          <span className="bg-border h-px flex-1" aria-hidden />
        </div>

        <div className="bg-brand-bg ring-brand-line mt-3 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 ring-1">
          <span className="text-muted-foreground text-xs">Username and password</span>
          <span className="bg-card ring-border/70 rounded-md px-2 py-0.5 font-mono text-sm ring-1">
            demo / demo1234
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
