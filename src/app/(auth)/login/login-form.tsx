'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

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
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState)

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Lending App</CardTitle>
        <CardDescription>Sign in to manage lenders, borrowers and loans.</CardDescription>
      </CardHeader>
      <CardContent>
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

        <p className="text-muted-foreground mt-6 text-center text-sm">
          Demo account: <span className="font-medium">demo</span> /{' '}
          <span className="font-medium">demo1234</span>
        </p>
      </CardContent>
    </Card>
  )
}
