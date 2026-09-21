'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { Cannabis } from 'lucide-react'

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

function SubmitButton() {
  // useFormStatus reads the enclosing form's state, so the button disables itself
  // while the action runs. Without it a double-click creates two sessions.
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="mt-1 h-11 w-full rounded-xl" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState)

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
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <SubmitButton />
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
